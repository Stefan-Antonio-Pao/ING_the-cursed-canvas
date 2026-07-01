"""LLM layer for The Cursed Canvas.

Provides two backends:
- GameLLM: local Phi-3-mini via transformers (offline, requires warmup)
- DeepSeekClient: DeepSeek API via openai SDK (online, instant)

Both backends expose the same public methods: generate_dialogue,
generate_scene, and generate_dm_turn.
"""

import logging
import os
import re
import threading
import time
from contextlib import contextmanager
import contextvars
import json
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)
_deepseek_usage_callback = contextvars.ContextVar("deepseek_usage_callback", default=None)

# Tunable knobs (plan: 10s generation timeout, one retry, then fallback)
GENERATION_TIMEOUT = 10
MAX_RETRIES = 1
DIALOGUE_MAX_TOKENS = 150
SCENE_MAX_TOKENS = 120
DM_MAX_TOKENS = 1100
DM_COMPLETION_RETRIES = 2

DEFAULT_MODEL = "microsoft/Phi-3-mini-4k-instruct"
_LOCAL_MODEL_DEPS = None

SCENE_SYSTEM = (
    "You are the narrator of a text-adventure game set inside famous paintings. "
    "Describe the scene vividly in two or three sentences. Use second person ('you'). "
    "Do NOT list inventory, items, or exits. Focus only on atmosphere and what the "
    "player sees, hears, and feels."
)

ZH_LANGUAGE_GUARD = (
    "必须只使用简体中文回复。不要输出英文叙事短语；不要混用英文和中文。"
)

ENGLISH_LEAK_RE = re.compile(
    r"\b("
    r"you|your|you're|you've|the|there|this|that|try|look|talk|speak|"
    r"player|inventory|quest|item|painting|museum|world|scene|npc|"
    r"hello|traveler|where|what|how|why|is|are|can|cannot|can't"
    r")\b",
    re.IGNORECASE,
)


def _contains_cjk(text):
    return bool(re.search(r"[\u3400-\u9fff]", text or ""))


def _has_english_leak(text):
    return bool(ENGLISH_LEAK_RE.search(text or ""))


def _with_language_guard(messages, lang):
    if lang != "zh" or not messages:
        return messages
    guarded = list(messages)
    first = dict(guarded[0])
    first["content"] = f"{first.get('content', '')}\n\n{ZH_LANGUAGE_GUARD}"
    guarded[0] = first
    return guarded


def _load_local_model_deps():
    """Import heavy local-model dependencies only when local mode is used.

    On Windows, importing torch can fail with DLL initialization errors on
    machines missing compatible runtime dependencies. Keeping this lazy lets
    the desktop app still start in API mode and report local-model failures.
    """
    global _LOCAL_MODEL_DEPS
    if _LOCAL_MODEL_DEPS is None:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, StoppingCriteria, StoppingCriteriaList

        _LOCAL_MODEL_DEPS = {
            "torch": torch,
            "AutoModelForCausalLM": AutoModelForCausalLM,
            "AutoTokenizer": AutoTokenizer,
            "StoppingCriteria": StoppingCriteria,
            "StoppingCriteriaList": StoppingCriteriaList,
        }
    return _LOCAL_MODEL_DEPS


def check_local_runtime():
    """Return a non-throwing runtime probe for the optional local model stack."""
    try:
        deps = _load_local_model_deps()
        torch = deps["torch"]
        return {
            "ok": True,
            "torch_version": getattr(torch, "__version__", "unknown"),
            "cuda_available": bool(torch.cuda.is_available()),
            "mps_available": bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "error_type": exc.__class__.__name__,
        }


class GameLLM:
    """Single LLM wrapping Phi-3-mini for both dialogue and narration."""

    def __init__(self, model_name=DEFAULT_MODEL):
        logger.info(f"Loading {model_name} ...")
        deps = _load_local_model_deps()
        self.torch = deps["torch"]
        self.AutoModelForCausalLM = deps["AutoModelForCausalLM"]
        self.AutoTokenizer = deps["AutoTokenizer"]
        self.StoppingCriteria = deps["StoppingCriteria"]
        self.StoppingCriteriaList = deps["StoppingCriteriaList"]
        self.device = self._pick_device()
        self.tokenizer = self.AutoTokenizer.from_pretrained(model_name)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        quant_cfg = self._maybe_quant_config()
        load_kwargs = {"torch_dtype": self.torch.float16} if self.device != "cpu" else {}
        if quant_cfg is not None:
            load_kwargs = {"quantization_config": quant_cfg, "device_map": "auto"}

        self.model = self.AutoModelForCausalLM.from_pretrained(model_name, **load_kwargs)
        if quant_cfg is None:
            self.model = self.model.to(self.device)
        self.model.eval()
        # Serialize generation so concurrent Flask requests don't collide.
        self._lock = threading.Lock()
        logger.info(f"{model_name} loaded on {self.device}.")

    @staticmethod
    def _pick_device():
        torch = _load_local_model_deps()["torch"]
        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    @staticmethod
    def _maybe_quant_config():
        """4-bit NF4 quantization via bitsandbytes (CUDA only).

        On CPU/MPS we fall back to full precision; bitsandbytes 4-bit inference
        is a CUDA feature. The game stays fully playable either way.
        """
        torch = _load_local_model_deps()["torch"]
        if not torch.cuda.is_available():
            return None
        try:
            from transformers import BitsAndBytesConfig

            return BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.float16,
            )
        except Exception as e:  # bitsandbytes missing or broken
            logger.info(f"4-bit quant unavailable ({e}); using full precision.")
            return None

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def generate_dialogue(self, system_prompt, npc_name, history, player_text, lang=None):
        """Generate an in-character NPC reply.

        Returns (response_text, success_flag). On timeout/failure/low quality,
        returns (None, False) so the caller can fall back to the static matcher.
        """
        if lang is None:
            lang = "zh" if _contains_cjk(system_prompt) or _contains_cjk(player_text) else "en"
        messages = [{"role": "system", "content": system_prompt}]
        # history: list of (speaker, text) -- speaker == "Player" is the user.
        for speaker, text in (history or [])[-8:]:
            role = "user" if speaker in ("Player", "player") else "assistant"
            messages.append({"role": role, "content": text})
        messages.append({"role": "user", "content": player_text})
        messages = _with_language_guard(messages, lang)

        for attempt in range(MAX_RETRIES + 1):
            reply = self._run(messages, DIALOGUE_MAX_TOKENS)
            if reply and self._quality_ok(reply, player_text, lang=lang):
                return reply, True
            if reply:
                logger.info(f"Dialogue rejected by quality gate (attempt {attempt + 1}).")
        return None, False

    def generate_scene(self, world_name, world_description, player_action, lang=None):
        """Generate a short atmospheric narration for an explore action.

        Returns the scene text, or None on timeout/failure.
        """
        if lang is None:
            lang = "zh" if _contains_cjk(world_name) or _contains_cjk(world_description) or _contains_cjk(player_action) else "en"
        system_prompt = SCENE_SYSTEM + ("\n\n" + ZH_LANGUAGE_GUARD if lang == "zh" else "")
        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    f"World: {world_name}\n"
                    f"Setting: {world_description}\n"
                    f'The player tries: "{player_action}"\n\n'
                    "Describe what the player experiences right now."
                ),
            },
        ]
        for attempt in range(MAX_RETRIES + 1):
            scene = self._run(messages, SCENE_MAX_TOKENS)
            if scene and self._quality_ok(scene, player_action, lang=lang):
                return scene
        return None

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #
    def _run(self, messages, max_new_tokens, trim=True):
        """Run one generation pass with the time-based stopping criteria."""
        try:
            prompt = self.tokenizer.apply_chat_template(
                messages, add_generation_prompt=True, tokenize=False
            )
            with self._lock:
                inputs = self.tokenizer(prompt, return_tensors="pt").to(self.device)
                input_len = inputs["input_ids"].shape[1]
                stopping = self._timeout_stopping_criteria(GENERATION_TIMEOUT)
                outputs = self.model.generate(
                    **inputs,
                    max_new_tokens=max_new_tokens,
                    do_sample=True,
                    temperature=0.7,
                    top_p=0.9,
                    repetition_penalty=1.1,
                    pad_token_id=self.tokenizer.pad_token_id,
                    eos_token_id=self.tokenizer.eos_token_id,
                    stopping_criteria=stopping,
                )
            new_tokens = outputs[0][input_len:]
            text = self.tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
            return self._trim(text) if trim else text
        except Exception as e:
            logger.warning(f"LLM generation failed: {e}")
            return None

    def _timeout_stopping_criteria(self, timeout):
        """Stop generation once a wall-clock deadline is reached."""
        stopping_base = self.StoppingCriteria

        class TimeoutCriteria(stopping_base):
            def __init__(self, timeout_seconds):
                self.deadline = time.time() + timeout_seconds

            def __call__(self, input_ids, scores, **kwargs):
                return time.time() > self.deadline

        return self.StoppingCriteriaList([TimeoutCriteria(timeout)])

    @staticmethod
    def _trim(text):
        """Cut to the last sentence-ending punctuation for clean output."""
        if not text:
            return text
        last = max(text.rfind("."), text.rfind("!"), text.rfind("?"))
        if last > 20:
            return text[: last + 1].strip()
        return text

    @staticmethod
    def _quality_ok(text, player_text, lang=None):
        """Reject empty, too-short, player-echo, or repetitive gibberish."""
        if not text or len(text) < 15:
            return False
        if lang == "zh":
            return _contains_cjk(text) and not _has_english_leak(text)
        low = text.lower()
        if player_text and player_text[:20].lower() in low:
            return False
        # Repetition gibberish: a 5-char slice reused many times.
        if len(text) > 20 and text.count(text[:5]) > 4:
            return False
        # Non-CJK outputs should contain at least one space (not one giant token).
        if " " not in text:
            return False
        return True

    def generate_dm_turn(self, messages):
        """Run a DM turn: accept full message list, return (raw_text, success).

        The messages include the DM system prompt + user message with game state.
        Returns the raw text output from the model, or (None, False) on failure.
        Does NOT trim — the output is JSON, so trimming at sentence punctuation
        would break the structure.
        """
        try:
            last_raw = None
            attempt_messages = list(messages)
            for _ in range(DM_COMPLETION_RETRIES + 1):
                raw = self._run(attempt_messages, DM_MAX_TOKENS, trim=False)
                if not raw or len(raw) <= 10:
                    continue
                last_raw = raw
                if self._looks_like_complete_dm_json(raw):
                    return raw, True
                attempt_messages = self._build_continue_messages(messages, raw)
                logger.info("DM JSON appears truncated; requesting continuation (local).")
            if last_raw:
                return last_raw, True
        except Exception as e:
            logger.warning(f"Local DM turn failed: {e}")
        return None, False

    @staticmethod
    def _build_continue_messages(base_messages, partial):
        system_text = ""
        if base_messages:
            system_text = str((base_messages[0] or {}).get("content", ""))
        user_content = (
            "你之前的 JSON 被截断了。请从中断处继续，并且只输出一个完整 JSON 对象。"
            "所有 scene 与 npc_reply 内容必须只使用中文。必须包含所有必需字段。"
            if _contains_cjk(system_text)
            else "Your previous JSON was cut off. Continue from where you stopped and "
            "output one complete JSON object only, including all required keys."
        )
        return list(base_messages) + [
            {"role": "assistant", "content": partial},
            {"role": "user", "content": user_content},
        ]

    @staticmethod
    def _looks_like_complete_dm_json(text):
        if not text:
            return False
        s = text.strip()
        if not (s.startswith("{") and s.endswith("}")):
            return False
        required = [
            '"intent"',
            '"scene"',
            '"npc_reply"',
            '"npc_name"',
            '"mood"',
            '"move_target"',
        ]
        return all(k in s for k in required)


_llm_instance = None
_llm_lock = threading.Lock()


def get_llm(model_name=DEFAULT_MODEL):
    """Module-level singleton accessor for the GameLLM."""
    global _llm_instance
    with _llm_lock:
        if _llm_instance is None:
            _llm_instance = GameLLM(model_name=model_name)
    return _llm_instance


# ------------------------------------------------------------------ #
# DeepSeek API Client
# ------------------------------------------------------------------ #

@contextmanager
def track_deepseek_usage(callback):
    """Call callback(total_tokens) for DeepSeek usage in the current request."""
    token = _deepseek_usage_callback.set(callback)
    try:
        yield
    finally:
        _deepseek_usage_callback.reset(token)


class DeepSeekClient:
    """DeepSeek API client using the OpenAI-compatible SDK.

    Provides the same interface as GameLLM: generate_dialogue,
    generate_scene, and generate_dm_turn.
    """

    def __init__(self, api_key=None, model=None):
        from openai import OpenAI
        self.api_key = os.getenv("DEEPSEEK_API_KEY", "") if api_key is None else api_key
        self.model = model or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        self.client = OpenAI(
            api_key=self.api_key,
            base_url="https://api.deepseek.com"
        )
        logger.info(f"DeepSeekClient initialized with model={self.model}")

    def _call(self, messages, max_tokens, timeout=15, trim=True):
        """Call the DeepSeek chat completions API."""
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=0.7,
                top_p=0.9,
                timeout=timeout,
            )
            text = response.choices[0].message.content
            self._record_usage(response, messages, text)
            if not text:
                return None
            text = text.strip()
            return self._trim(text) if trim else text
        except Exception as e:
            logger.warning(f"DeepSeek API call failed: {e}")
            return None

    @staticmethod
    def _value(obj, key):
        if obj is None:
            return None
        if isinstance(obj, dict):
            return obj.get(key)
        return getattr(obj, key, None)

    @classmethod
    def _usage_total(cls, response, messages, completion_text):
        usage = cls._value(response, "usage")
        total = cls._value(usage, "total_tokens")
        if total is not None:
            try:
                return max(0, int(total))
            except (TypeError, ValueError):
                pass

        prompt_tokens = cls._value(usage, "prompt_tokens")
        completion_tokens = cls._value(usage, "completion_tokens")
        if prompt_tokens is not None or completion_tokens is not None:
            try:
                return max(0, int(prompt_tokens or 0) + int(completion_tokens or 0))
            except (TypeError, ValueError):
                pass

        prompt_chars = sum(len(str(msg.get("content", ""))) for msg in (messages or []))
        completion_chars = len(completion_text or "")
        return max(1, (prompt_chars + completion_chars + 3) // 4)

    def _record_usage(self, response, messages, completion_text):
        callback = _deepseek_usage_callback.get()
        if not callback:
            return
        total_tokens = self._usage_total(response, messages, completion_text)
        if total_tokens > 0:
            callback(total_tokens)

    def generate_dm_turn(self, messages):
        """Run a DM turn via DeepSeek API. Returns (raw_text, success).
        Does NOT trim — the output is JSON, so trimming at sentence punctuation
        would break the structure.
        """
        try:
            last_raw = None
            attempt_messages = list(messages)
            for _ in range(DM_COMPLETION_RETRIES + 1):
                raw = self._call(attempt_messages, DM_MAX_TOKENS, timeout=20, trim=False)
                if not raw or len(raw) <= 10:
                    continue
                last_raw = raw
                if GameLLM._looks_like_complete_dm_json(raw):
                    return raw, True
                attempt_messages = GameLLM._build_continue_messages(messages, raw)
                logger.info("DM JSON appears truncated; requesting continuation (api).")
            if last_raw:
                return last_raw, True
        except Exception as e:
            logger.warning(f"DeepSeek DM turn failed: {e}")
        return None, False

    def generate_dialogue(self, system_prompt, npc_name, history, player_text, lang=None):
        """Generate an in-character NPC reply via DeepSeek API."""
        if lang is None:
            lang = "zh" if _contains_cjk(system_prompt) or _contains_cjk(player_text) else "en"
        messages = [{"role": "system", "content": system_prompt}]
        for speaker, text in (history or [])[-8:]:
            role = "user" if speaker in ("Player", "player") else "assistant"
            messages.append({"role": role, "content": text})
        messages.append({"role": "user", "content": player_text})
        messages = _with_language_guard(messages, lang)
        for attempt in range(MAX_RETRIES + 1):
            reply = self._call(messages, DIALOGUE_MAX_TOKENS)
            if reply and self._quality_ok(reply, player_text, lang=lang):
                return reply, True
        return None, False

    def generate_scene(self, world_name, world_description, player_action, lang=None):
        """Generate atmospheric narration via DeepSeek API."""
        if lang is None:
            lang = "zh" if _contains_cjk(world_name) or _contains_cjk(world_description) or _contains_cjk(player_action) else "en"
        system_prompt = SCENE_SYSTEM + ("\n\n" + ZH_LANGUAGE_GUARD if lang == "zh" else "")
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": (
                f"World: {world_name}\n"
                f"Setting: {world_description}\n"
                f'The player tries: "{player_action}"\n\n'
                "Describe what the player experiences right now."
            )}
        ]
        for attempt in range(MAX_RETRIES + 1):
            scene = self._call(messages, SCENE_MAX_TOKENS)
            if scene and self._quality_ok(scene, player_action, lang=lang):
                return scene
        return None

    @staticmethod
    def _trim(text):
        if not text:
            return text
        last = max(text.rfind("."), text.rfind("!"), text.rfind("?"))
        if last > 20:
            return text[: last + 1].strip()
        return text

    @staticmethod
    def _quality_ok(text, player_text, lang=None):
        if not text or len(text) < 15:
            return False
        if lang == "zh":
            return _contains_cjk(text) and not _has_english_leak(text)
        low = text.lower()
        if player_text and player_text[:20].lower() in low:
            return False
        if len(text) > 20 and text.count(text[:5]) > 4:
            return False
        if " " not in text:
            return False
        return True


class RemoteExperienceClient:
    """DeepSeek-compatible client that delegates experience calls to a remote proxy."""

    def __init__(self, proxy_url, client_id, model=None, auth_token=None):
        self.proxy_url = (proxy_url or "").rstrip("/")
        self.client_id = client_id
        self.model = model or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        self.auth_token = auth_token or ""
        self.api_key = f"remote:{self.proxy_url}"
        logger.info(f"RemoteExperienceClient initialized with proxy={self.proxy_url}")

    def _call(self, messages, max_tokens, timeout=30, trim=True):
        if not self.proxy_url or not self.client_id:
            return None

        payload = {
            "client_id": self.client_id,
            "messages": messages,
            "max_tokens": max_tokens,
            "model": self.model,
            "trim": bool(trim),
        }
        data = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        request = urllib.request.Request(
            f"{self.proxy_url}/api/experience/chat",
            data=data,
            headers=headers,
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                result = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8")
            except Exception:
                detail = str(exc)
            logger.warning(f"Experience proxy call failed: {exc.code} {detail}")
            return None
        except Exception as exc:
            logger.warning(f"Experience proxy call failed: {exc}")
            return None

        text = (result.get("text") or "").strip()
        usage_tokens = result.get("usage_total_tokens")
        callback = _deepseek_usage_callback.get()
        if callback and usage_tokens is not None:
            try:
                callback(max(0, int(usage_tokens)))
            except (TypeError, ValueError):
                pass
        if not text:
            return None
        return DeepSeekClient._trim(text) if trim else text

    def generate_dm_turn(self, messages):
        try:
            last_raw = None
            attempt_messages = list(messages)
            for _ in range(DM_COMPLETION_RETRIES + 1):
                raw = self._call(attempt_messages, DM_MAX_TOKENS, timeout=45, trim=False)
                if not raw or len(raw) <= 10:
                    continue
                last_raw = raw
                if GameLLM._looks_like_complete_dm_json(raw):
                    return raw, True
                attempt_messages = GameLLM._build_continue_messages(messages, raw)
                logger.info("DM JSON appears truncated; requesting continuation (experience proxy).")
            if last_raw:
                return last_raw, True
        except Exception as exc:
            logger.warning(f"Experience proxy DM turn failed: {exc}")
        return None, False

    def generate_dialogue(self, system_prompt, npc_name, history, player_text, lang=None):
        if lang is None:
            lang = "zh" if _contains_cjk(system_prompt) or _contains_cjk(player_text) else "en"
        messages = [{"role": "system", "content": system_prompt}]
        for speaker, text in (history or [])[-8:]:
            role = "user" if speaker in ("Player", "player") else "assistant"
            messages.append({"role": role, "content": text})
        messages.append({"role": "user", "content": player_text})
        messages = _with_language_guard(messages, lang)
        for _ in range(MAX_RETRIES + 1):
            reply = self._call(messages, DIALOGUE_MAX_TOKENS)
            if reply and DeepSeekClient._quality_ok(reply, player_text, lang=lang):
                return reply, True
        return None, False

    def generate_scene(self, world_name, world_description, player_action, lang=None):
        if lang is None:
            lang = "zh" if _contains_cjk(world_name) or _contains_cjk(world_description) or _contains_cjk(player_action) else "en"
        system_prompt = SCENE_SYSTEM + ("\n\n" + ZH_LANGUAGE_GUARD if lang == "zh" else "")
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": (
                f"World: {world_name}\n"
                f"Setting: {world_description}\n"
                f'The player tries: "{player_action}"\n\n'
                "Describe what the player experiences right now."
            )},
        ]
        for _ in range(MAX_RETRIES + 1):
            scene = self._call(messages, SCENE_MAX_TOKENS)
            if scene and DeepSeekClient._quality_ok(scene, player_action, lang=lang):
                return scene
        return None


# ------------------------------------------------------------------ #
# Factory
# ------------------------------------------------------------------ #

_deepseek_instance = None
_deepseek_lock = threading.Lock()
_remote_experience_instance = None
_remote_experience_lock = threading.Lock()


def get_deepseek_client(api_key=None, model=None):
    """Module-level singleton accessor for the DeepSeekClient."""
    global _deepseek_instance
    target_api_key = os.getenv("DEEPSEEK_API_KEY", "") if api_key is None else api_key
    target_model = model or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    with _deepseek_lock:
        if (
            _deepseek_instance is None
            or _deepseek_instance.api_key != target_api_key
            or _deepseek_instance.model != target_model
        ):
            _deepseek_instance = DeepSeekClient(api_key=target_api_key, model=target_model)
    return _deepseek_instance


def reset_deepseek_client(api_key=None, model=None):
    """Recreate the DeepSeek client after settings change the API key."""
    global _deepseek_instance
    with _deepseek_lock:
        _deepseek_instance = DeepSeekClient(api_key=api_key, model=model)
        return _deepseek_instance


def get_remote_experience_client(proxy_url, client_id, model=None, auth_token=None):
    global _remote_experience_instance
    target_url = (proxy_url or "").rstrip("/")
    target_model = model or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    target_token = auth_token or ""
    with _remote_experience_lock:
        if (
            _remote_experience_instance is None
            or _remote_experience_instance.proxy_url != target_url
            or _remote_experience_instance.client_id != client_id
            or _remote_experience_instance.model != target_model
            or _remote_experience_instance.auth_token != target_token
        ):
            _remote_experience_instance = RemoteExperienceClient(
                proxy_url=target_url,
                client_id=client_id,
                model=target_model,
                auth_token=target_token,
            )
    return _remote_experience_instance


def get_llm_client(mode, api_key=None, model=None):
    """Factory: return the LLM client for the given mode.

    Args:
        mode: "api" for DeepSeek, "local" for Phi-3-mini.
        api_key: Optional API key override for DeepSeek.
        model: Optional model name override for DeepSeek.

    Returns:
        A client with generate_dm_turn(), generate_dialogue(), generate_scene().
    """
    if mode == "api":
        return get_deepseek_client(api_key=api_key, model=model)
    else:
        return get_llm()
