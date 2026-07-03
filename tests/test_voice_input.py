import io
import unittest
import wave

import app as app_module


def silent_wav_bytes(duration_seconds=1.0, sample_rate=16000):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * int(duration_seconds * sample_rate))
    buffer.seek(0)
    return buffer.getvalue()


class VoiceInputTests(unittest.TestCase):
    def test_settings_include_and_save_voice_preferences(self):
        with app_module.app.test_client() as client:
            defaults = client.get("/api/settings")
            self.assertEqual(defaults.status_code, 200)
            self.assertEqual(defaults.json["voice"]["correction_strength"], "balanced")
            self.assertEqual(defaults.json["voice"]["correction_backend"], "auto")
            self.assertFalse(defaults.json["voice"]["auto_send"])

            updated = client.post(
                "/api/settings",
                json={"voice": {"correction_strength": "high", "correction_backend": "online", "auto_send": True}},
            )
            self.assertEqual(updated.status_code, 200)
            self.assertEqual(updated.json["voice"]["correction_strength"], "high")
            self.assertEqual(updated.json["voice"]["correction_backend"], "online")
            self.assertTrue(updated.json["voice"]["auto_send"])

    def test_invalid_voice_correction_strength_is_rejected(self):
        with app_module.app.test_client() as client:
            response = client.post(
                "/api/settings",
                json={"voice": {"correction_strength": "maximum"}},
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn("Invalid voice correction strength", response.json["error"])

    def test_invalid_voice_correction_backend_is_rejected(self):
        with app_module.app.test_client() as client:
            response = client.post(
                "/api/settings",
                json={"voice": {"correction_backend": "cloudiest"}},
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn("Invalid voice correction backend", response.json["error"])

    def test_voice_refine_returns_raw_text_when_no_model_is_available(self):
        with app_module.app.test_client() as client:
            with client.session_transaction() as session:
                session["lang"] = "en"
                session["settings_language"] = "en"
                session["llm_mode"] = "local"

            response = client.post(
                "/api/voice/refine",
                json={"text": "四处   看看", "correction_strength": "balanced"},
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json["text"], "（四处看看）")
            self.assertEqual(response.json["source"], "deterministic")
            self.assertTrue(response.json["corrected"])

    def test_voice_refine_uses_llm_client_when_available(self):
        class FakeVoiceClient:
            def __init__(self):
                self.messages = None

            def generate_voice_correction(self, messages):
                self.messages = messages
                return "(look around)", True

        fake_client = FakeVoiceClient()
        original_factory = app_module._voice_llm_client_for_current_mode
        app_module._voice_llm_client_for_current_mode = lambda: (fake_client, False)
        try:
            with app_module.app.test_client() as client:
                with client.session_transaction() as session:
                    session["lang"] = "en"
                    session["settings_language"] = "en"

                response = client.post(
                    "/api/voice/refine",
                    json={"text": "look around", "correction_strength": "high"},
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json["text"], "(look around)")
                self.assertEqual(response.json["source"], "llm")
                self.assertTrue(response.json["corrected"])
                prompt_text = "\n".join(message["content"] for message in fake_client.messages)
                self.assertIn("Current world", prompt_text)
                self.assertIn("Input convention", prompt_text)
        finally:
            app_module._voice_llm_client_for_current_mode = original_factory

    def test_voice_refine_reconciles_traditional_and_wrong_game_terms(self):
        class FakeVoiceClient:
            def generate_voice_correction(self, messages):
                self.messages = messages
                return "選擇海洛敵", True

        game_state = app_module.GameState()
        game_state.current_world = "great_wave"
        fake_client = FakeVoiceClient()
        original_factory = app_module._voice_llm_client_for_current_mode
        app_module._voice_llm_client_for_current_mode = lambda: (fake_client, False)
        try:
            with app_module.app.test_request_context("/api/voice/refine"):
                app_module.g.lang = "zh"
                app_module.session["settings_language"] = "zh"
                corrected, changed, source = app_module._refine_voice_text("尋找海洛底", "high", game_state)
                self.assertEqual(corrected, "（寻找海螺笛）")
                self.assertTrue(changed)
                self.assertEqual(source, "llm")
        finally:
            app_module._voice_llm_client_for_current_mode = original_factory

    def test_voice_refine_corrects_english_terms_and_wraps_find_actions(self):
        game_state = app_module.GameState()
        game_state.current_world = "great_wave"
        with app_module.app.test_request_context("/api/voice/refine"):
            app_module.g.lang = "en"
            app_module.session["llm_mode"] = "local"
            corrected, changed, source = app_module._refine_voice_text("find show flute", "low", game_state)
            self.assertEqual(corrected, "(find shell flute)")
            self.assertTrue(changed)
            self.assertEqual(source, "deterministic")

    def test_voice_refine_corrects_world_aliases_and_wraps_move_actions(self):
        game_state = app_module.GameState()
        game_state.current_world = "museum"
        with app_module.app.test_request_context("/api/voice/refine"):
            app_module.g.lang = "zh"
            app_module.session["llm_mode"] = "local"
            corrected, changed, source = app_module._refine_voice_text("进入新月夜", "high", game_state)
            self.assertEqual(corrected, "（进入星月夜）")
            self.assertTrue(changed)
            self.assertEqual(source, "deterministic")

    def test_voice_refine_repairs_zh_phonetic_world_aliases(self):
        game_state = app_module.GameState()
        game_state.current_world = "museum"
        with app_module.app.test_request_context("/api/voice/refine"):
            app_module.g.lang = "zh"
            app_module.session["llm_mode"] = "local"
            corrected, changed, source = app_module._refine_voice_text("前往新越义", "high", game_state)
            self.assertEqual(corrected, "（前往星月夜）")
            self.assertTrue(changed)
            self.assertEqual(source, "deterministic")

    def test_voice_refine_repairs_pickup_action_homophones(self):
        game_state = app_module.GameState()
        game_state.current_world = "great_wave"
        with app_module.app.test_request_context("/api/voice/refine"):
            app_module.g.lang = "zh"
            app_module.session["llm_mode"] = "local"
            corrected, changed, source = app_module._refine_voice_text("前期海螺笛", "high", game_state)
            self.assertEqual(corrected, "（拾取海螺笛）")
            self.assertTrue(changed)
            self.assertEqual(source, "deterministic")

    def test_voice_refine_forces_simplified_chinese_output(self):
        game_state = app_module.GameState()
        game_state.current_world = "museum"
        with app_module.app.test_request_context("/api/voice/refine"):
            app_module.g.lang = "zh"
            app_module.session["llm_mode"] = "local"
            corrected, _changed, _source = app_module._refine_voice_text("選擇神奈川沖浪裡", "high", game_state)
            self.assertEqual(corrected, "（选择神奈川冲浪里）")
            self.assertNotIn("選", corrected)
            self.assertNotIn("裡", corrected)

    def test_voice_refine_keeps_help_question_as_dialogue_and_repairs_color(self):
        game_state = app_module.GameState()
        game_state.current_world = "impression_sunrise"
        with app_module.app.test_request_context("/api/voice/refine"):
            app_module.g.lang = "zh"
            app_module.session["llm_mode"] = "local"
            corrected, changed, source = app_module._refine_voice_text("我需要做些什么才能找到这些演算的", "high", game_state)
            self.assertEqual(corrected, "我需要做些什么才能找到这些颜色的")
            self.assertTrue(changed)
            self.assertEqual(source, "deterministic")
            self.assertFalse(corrected.startswith("（"))
            self.assertNotIn("演算", corrected)

    def test_voice_refine_corrects_npc_and_artist_terms_without_action_wrapping(self):
        game_state = app_module.GameState()
        game_state.current_world = "impression_sunrise"
        with app_module.app.test_request_context("/api/voice/refine"):
            app_module.g.lang = "zh"
            app_module.session["llm_mode"] = "local"
            corrected, changed, source = app_module._refine_voice_text("问克洛德莫奈恩皮西颜色在哪里", "high", game_state)
            self.assertEqual(corrected, "问克劳德·莫奈NPC颜色在哪里")
            self.assertTrue(changed)
            self.assertEqual(source, "deterministic")
            self.assertFalse(corrected.startswith("（"))

    def test_voice_refine_repairs_great_wave_artist_and_beach_terms(self):
        game_state = app_module.GameState()
        game_state.current_world = "great_wave"
        with app_module.app.test_request_context("/api/voice/refine"):
            app_module.g.lang = "zh"
            app_module.session["llm_mode"] = "local"
            corrected, changed, source = app_module._refine_voice_text("前往各式北战所说的旁边的沙灿", "high", game_state, "local")
            self.assertEqual(corrected, "（前往葛饰北斋所说的旁边的沙滩）")
            self.assertTrue(changed)
            self.assertEqual(source, "deterministic")

    def test_voice_online_refine_uses_high_strength_prompt_and_api_source(self):
        class FakeVoiceClient:
            def __init__(self):
                self.messages = None

            def generate_voice_correction(self, messages):
                self.messages = messages
                return "（前往葛饰北斋所说的沙滩）", True

        game_state = app_module.GameState()
        game_state.current_world = "great_wave"
        fake_client = FakeVoiceClient()
        original_client = app_module._voice_online_llm_client_for_correction
        original_quota = app_module._run_with_experience_quota
        app_module._voice_online_llm_client_for_correction = lambda: fake_client
        app_module._run_with_experience_quota = lambda fn: fn()
        try:
            with app_module.app.test_request_context("/api/voice/refine"):
                app_module.g.lang = "zh"
                corrected, changed, source = app_module._refine_voice_text("前往各式北战所说的旁边的沙灿", "high", game_state, "online")
                self.assertEqual(corrected, "（前往葛饰北斋所说的沙滩）")
                self.assertTrue(changed)
                self.assertEqual(source, "online")
                prompt_text = "\n".join(message["content"] for message in fake_client.messages)
                self.assertIn("在线语音转写总修正器", prompt_text)
                self.assertIn("沙灿", prompt_text)
                self.assertIn("葛饰北斋", prompt_text)
        finally:
            app_module._voice_online_llm_client_for_correction = original_client
            app_module._run_with_experience_quota = original_quota

    def test_voice_refine_simplifies_llm_traditional_output(self):
        class FakeVoiceClient:
            def generate_voice_correction(self, messages):
                return "我需要做些什麼才能找到顏色", True

        game_state = app_module.GameState()
        game_state.current_world = "impression_sunrise"
        original_factory = app_module._voice_llm_client_for_current_mode
        app_module._voice_llm_client_for_current_mode = lambda: (FakeVoiceClient(), False)
        try:
            with app_module.app.test_request_context("/api/voice/refine"):
                app_module.g.lang = "zh"
                corrected, changed, source = app_module._refine_voice_text("我需要做些什么才能找到颜色", "high", game_state)
                self.assertEqual(corrected, "我需要做些什么才能找到颜色")
                self.assertFalse(changed)
                self.assertEqual(source, "llm")
                self.assertNotIn("什麼", corrected)
                self.assertNotIn("顏", corrected)
        finally:
            app_module._voice_llm_client_for_current_mode = original_factory

    def test_keyword_fallback_recognizes_known_item_search_actions(self):
        game_state = app_module.GameState()
        game_state.current_world = "great_wave"
        with app_module.app.test_request_context("/"):
            app_module.g.lang = "zh"
            self.assertEqual(app_module._classify_keyword_fallback("寻找海螺笛", game_state), "use_item")
            app_module.g.lang = "en"
            self.assertEqual(app_module._classify_keyword_fallback("find shell flute", game_state), "use_item")

    def test_keyword_fallback_recognizes_broad_voice_aliases(self):
        with app_module.app.test_request_context("/"):
            app_module.g.lang = "zh"
            game_state = app_module.GameState()
            game_state.current_world = "museum"
            museum = app_module.get_world("museum")
            self.assertEqual(app_module._normalize_game_command("进入新月夜", game_state), "进入星月夜")
            self.assertEqual(app_module._classify_keyword_fallback("进入新月夜", game_state), "move")
            self.assertEqual(app_module._classify_keyword_fallback("选择星月夜", game_state), "move")
            self.assertEqual(
                app_module._extract_move_target_from_command("进入新月夜", museum, require_move_verb=True),
                "starry_night",
            )
            self.assertEqual(
                app_module._extract_move_target_from_command("选择星月夜", museum, require_move_verb=True),
                "starry_night",
            )
            self.assertEqual(
                app_module._extract_move_target_from_command("进入神奈川", museum, require_move_verb=True),
                "great_wave",
            )
            self.assertEqual(
                app_module._extract_move_target_from_command("进入日出", museum, require_move_verb=True),
                "impression_sunrise",
            )

            game_state.current_world = "starry_night"
            self.assertEqual(app_module._classify_keyword_fallback("选择博物馆", game_state), "move")
            self.assertEqual(app_module._classify_keyword_fallback("找灯", game_state), "use_item")
            game_state.current_world = "impression_sunrise"
            self.assertEqual(app_module._classify_keyword_fallback("找镜", game_state), "use_item")

    def test_story_engine_move_aliases_match_keyword_targets(self):
        with app_module.app.test_request_context("/"):
            app_module.g.lang = "zh"
            game_state = app_module.GameState()
            game_state._first_turn = False
            result = game_state.process("move", "进入神奈川")
            self.assertEqual(game_state.current_world, "great_wave")
            self.assertEqual(result["location_id"], "great_wave")

    def test_voice_warmup_endpoint_uses_local_stt_warmup(self):
        original_start = app_module._start_voice_warmup_background
        original_status = app_module._voice_stt_status_payload
        app_module._start_voice_warmup_background = lambda: True
        app_module._voice_stt_status_payload = lambda: {
            "voice_stt_ready": False,
            "voice_stt_loading": True,
            "voice_stt_error": None,
            "voice_model": "test-model",
            "voice_source": "test-stt",
        }
        try:
            with app_module.app.test_client() as client:
                response = client.post("/api/voice/warmup")
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json["voice_stt_ready"])
                self.assertTrue(response.json["voice_stt_loading"])
                self.assertTrue(response.json["voice_warmup_started"])
                self.assertEqual(response.json["voice_source"], "test-stt")
                self.assertEqual(response.json["voice_model"], "test-model")
        finally:
            app_module._start_voice_warmup_background = original_start
            app_module._voice_stt_status_payload = original_status

    def test_voice_runtime_check_endpoint_is_non_blocking(self):
        original_check = app_module._check_voice_runtime
        app_module._check_voice_runtime = lambda: {
            "ok": False,
            "voice_runtime_checked": True,
            "voice_runtime_ok": False,
            "voice_runtime_error": "missing test dependency",
            "voice_stt_ready": False,
        }
        try:
            with app_module.app.test_client() as client:
                response = client.get("/api/voice/runtime-check")
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json["voice_runtime_ok"])
                self.assertEqual(response.json["voice_runtime_error"], "missing test dependency")
        finally:
            app_module._check_voice_runtime = original_check

    def test_voice_transcribe_requires_audio(self):
        with app_module.app.test_client() as client:
            response = client.post("/api/voice/transcribe", data={}, content_type="multipart/form-data")
            self.assertEqual(response.status_code, 400)
            self.assertIn("Missing voice audio", response.json["error"])
            self.assertEqual(response.json["code"], "voice_transcribe")

    def test_voice_transcribe_rejects_silent_audio_before_model(self):
        with app_module.app.test_client() as client:
            response = client.post(
                "/api/voice/transcribe",
                data={
                    "audio": (io.BytesIO(silent_wav_bytes()), "voice-input.wav"),
                    "correction_strength": "balanced",
                    "language": "en-US",
                },
                content_type="multipart/form-data",
            )
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json["code"], "voice_empty")
            self.assertIn("No speech", response.json["error"])

    def test_voice_transcribe_refines_backend_transcript(self):
        class FakeVoiceClient:
            def generate_voice_correction(self, messages):
                self.messages = messages
                return "(look around)", True

        fake_client = FakeVoiceClient()
        original_transcribe = app_module._transcribe_voice_audio
        original_factory = app_module._voice_llm_client_for_current_mode
        app_module._transcribe_voice_audio = lambda audio_bytes, lang: (
            "look around",
            {"source": "test-stt", "sample_rate": 16000, "language": "en"},
        )
        app_module._voice_llm_client_for_current_mode = lambda: (fake_client, False)
        try:
            with app_module.app.test_client() as client:
                with client.session_transaction() as session:
                    session["lang"] = "en"
                    session["settings_language"] = "en"

                response = client.post(
                    "/api/voice/transcribe",
                    data={
                        "audio": (io.BytesIO(b"fake wav bytes"), "voice-input.wav"),
                        "correction_strength": "balanced",
                        "language": "en-US",
                    },
                    content_type="multipart/form-data",
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json["raw_text"], "look around")
                self.assertEqual(response.json["text"], "(look around)")
                self.assertEqual(response.json["source"], "llm")
                self.assertEqual(response.json["transcription_source"], "test-stt")
        finally:
            app_module._transcribe_voice_audio = original_transcribe
            app_module._voice_llm_client_for_current_mode = original_factory

    def test_voice_transcribe_rejects_unusable_hallucinated_transcript(self):
        original_transcribe = app_module._transcribe_voice_audio
        original_factory = app_module._voice_llm_client_for_current_mode
        app_module._transcribe_voice_audio = lambda audio_bytes, lang: (
            "谢谢观看",
            {
                "source": "test-stt",
                "sample_rate": 16000,
                "language": "zh",
                "activity": {"voiced_seconds": 1.0},
            },
        )
        app_module._voice_llm_client_for_current_mode = lambda: (None, False)
        try:
            with app_module.app.test_client() as client:
                with client.session_transaction() as session:
                    session["lang"] = "zh"
                    session["settings_language"] = "zh"

                response = client.post(
                    "/api/voice/transcribe",
                    data={
                        "audio": (io.BytesIO(b"fake wav bytes"), "voice-input.wav"),
                        "correction_strength": "high",
                        "language": "zh-CN",
                    },
                    content_type="multipart/form-data",
                )
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json["code"], "voice_unusable")
                self.assertNotIn("text", response.json)
        finally:
            app_module._transcribe_voice_audio = original_transcribe
            app_module._voice_llm_client_for_current_mode = original_factory

    def test_voice_transcribe_rejects_repeated_noise_transcript(self):
        original_transcribe = app_module._transcribe_voice_audio
        original_factory = app_module._voice_llm_client_for_current_mode
        repeated_noise = "小伙伴们" * 24
        app_module._transcribe_voice_audio = lambda audio_bytes, lang: (
            repeated_noise,
            {
                "source": "test-stt",
                "sample_rate": 16000,
                "language": "zh",
                "activity": {"voiced_seconds": 2.0, "dynamic_ratio": 1.0},
            },
        )
        app_module._voice_llm_client_for_current_mode = lambda: (None, False)
        try:
            with app_module.app.test_client() as client:
                with client.session_transaction() as session:
                    session["lang"] = "zh"
                    session["settings_language"] = "zh"

                response = client.post(
                    "/api/voice/transcribe",
                    data={
                        "audio": (io.BytesIO(b"fake wav bytes"), "voice-input.wav"),
                        "correction_strength": "high",
                        "language": "zh-CN",
                    },
                    content_type="multipart/form-data",
                )
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json["code"], "voice_unusable")
                self.assertNotIn("text", response.json)
        finally:
            app_module._transcribe_voice_audio = original_transcribe
            app_module._voice_llm_client_for_current_mode = original_factory

    def test_voice_activity_rejects_flat_tone_noise(self):
        try:
            import numpy as np
            from ai import stt
        except Exception as exc:
            self.skipTest(f"voice activity dependencies unavailable: {exc}")

        sample_rate = 16000
        duration = 2.0
        positions = np.arange(int(sample_rate * duration), dtype=np.float32) / sample_rate
        samples = (np.sin(2 * np.pi * 440 * positions) * 0.02).astype(np.float32)
        activity = stt._voice_activity(samples, sample_rate)
        self.assertFalse(activity["has_speech"])
        self.assertEqual(activity["reason"], "noise")


if __name__ == "__main__":
    unittest.main()
