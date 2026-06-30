import unittest

from flask import g

from ai.dm_prompt import build_dm_prompt
from app import app
from engine.story_engine import GameState


class ChineseGreatWaveTermTests(unittest.TestCase):
    def setUp(self):
        self.ctx = app.app_context()
        self.ctx.push()
        g.lang = "zh"

    def tearDown(self):
        self.ctx.pop()

    def test_dm_title_mistranslation_is_normalized_without_rewriting_wave_description(self):
        gs = GameState()
        gs.current_world = "great_wave"
        gs.visited_worlds.add("great_wave")
        gs._first_turn = False

        response = gs.process_dm_response({
            "intent": "explore",
            "scene": "你走进《巨浪》画作。一道巨浪如爪状升起。巨浪画作似乎正在呼吸。",
            "npc_reply": "巨浪——我最好的作品——已经失去平衡。",
            "npc_name": "葛饰北斋",
            "mood": "neutral",
            "move_target": None,
            "player_command": "（四处看看）",
        })

        combined = response["scene"] + " " + response["npc_reply"]
        self.assertIn("《神奈川冲浪里》画作", combined)
        self.assertIn("一道巨浪如爪状升起", combined)
        self.assertIn("《神奈川冲浪里》中的海浪", combined)
        self.assertNotIn("《巨浪》", combined)
        self.assertNotIn("巨浪画作", combined)

    def test_zh_dm_prompt_uses_localized_exit_names(self):
        gs = GameState()
        messages = build_dm_prompt("进入神奈川冲浪里", gs, gs.memory, force_no_talk=True)
        prompt_text = "\n".join(message["content"] for message in messages)

        self.assertIn("神奈川冲浪里 (id: great_wave)", prompt_text)
        self.assertNotIn("Great Wave (id: great_wave)", prompt_text)


if __name__ == "__main__":
    unittest.main()
