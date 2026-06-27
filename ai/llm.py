"""LLM layer for The Cursed Canvas.

Provides two backends:
- GameLLM: local Phi-3-mini via transformers (offline, requires warmup)
- DeepSeekClient: DeepSeek API via openai SDK (online, instant)

Both backends expose the same public methods: generate_dialogue,
generate_scene, and generate_dm_turn.
"""

import logging
import os
import threading
import time
from contextlib import contextmanager
import contextvars
import json
import urllib.error
import urllib.request

import torch
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    StoppingCriteria,
    StoppingCriteriaList,
)

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

SCENE_SYSTEM = (
    "You are the narrator of a text-adventure game set inside famous paintings. "
    "Describe the scene vividly in two or three sentences. Use second person ('you'). "
    "Do NOT list inventory, items, or exits. Focus only on atmosphere and what the "
    "player sees, hears, and feels."
)


class _TimeoutCriteria(StoppingCriteria):
    """Stop generation once a wall-clock deadline is reached.

    Checked after every token, so a slow call returns whatever it managed to
    produce instead of hanging forever. This keeps the request thread alive
    (no orphan background threads) while honoring the generation timeout.
    """

    def __init__(self, timeout):
        self.deadline = time.time() + timeout

    def __call__(self, input_ids, scores, **kwargs):
        return time.time() > self.deadline


class GameLLM:
    """Single LLM wrapping Phi-3-mini for both dialogue and narration."""

    def __init__(self, model_name=DEFAULT_MODEL):
        logger.info(f"Loading {model_name} ...")
        self.device = self._pick_device()
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        quant_cfg = self._maybe_quant_config()
        load_kwargs = {"torch_dtype": torch.float16} if self.device != "cpu" else {}
        if quant_cfg is not None:
            load_kwargs = {"quantization_config": quant_cfg, "device_map": "auto"}

        self.model = AutoModelForCausalLM.from_pretrained(model_name, **load_kwargs)
        if quant_cfg is None:
            self.model = self.model.to(self.device)
        self.model.eval()
        # Serialize generation so concurrent Flask requests don't collide.
        self._lock = threading.Lock()
        logger.info(f"{model_name} loaded on {self.device}.")

    @staticmethod
    def _pick_device():
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
    def generate_dialogue(self, system_prompt, npc_name, history, player_text):
        """Generate an in-character NPC reply.

        Returns (response_text, success_flag). On timeout/failure/low quality,
        returns (None, False) so the caller can fall back to the static matcher.
        """
        messages = [{"role": "system", "content": system_prompt}]
        # history: list of (speaker, text) -- speaker == "Player" is the user.
        for speaker, text in (history or [])[-8:]:
            role = "user" if speaker in ("Player", "player") else "assistant"
            messages.append({"role": role, "content": text})
        messages.append({"role": "user", "content": player_text})

        for attempt in range(MAX_RETRIES + 1):
            reply = self._run(messages, DIALOGUE_MAX_TOKENS)
            if reply and self._quality_ok(reply, player_text):
                return reply, True
            if reply:
                logger.info(f"Dialogue rejected by quality gate (attempt {attempt + 1}).")
        return None, False

    def generate_scene(self, world_name, world_description, player_action):
        """Generate a short atmospheric narration for an explore action.

        Returns the scene text, or None on timeout/failure.
        """
        messages = [
            {"role": "system", "content": SCENE_SYSTEM},
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
            if scene and self._quality_ok(scene, player_action):
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
                stopping = StoppingCriteriaList([_TimeoutCriteria(GENERATION_TIMEOUT)])
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
    def _quality_ok(text, player_text):
        """Reject empty, too-short, player-echo, or repetitive gibberish."""
        if not text or len(text) < 15:
            return False
        low = text.lower()
        if player_text and player_text[:20].lower() in low:
            return False
        # Repetition gibberish: a 5-char slice reused many times.
        if len(text) > 20 and text.count(text[:5]) > 4:
            return False
        # Must contain at least one space (not one giant token).
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
        return list(base_messages) + [
            {"role": "assistant", "content": partial},
            {
                "role": "user",
                "content": (
                    "Your previous JSON was cut off. Continue from where you stopped and "
                    "output one complete JSON object only, including all required keys."
                ),
            },
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

    def generate_dialogue(self, system_prompt, npc_name, history, player_text):
        """Generate an in-character NPC reply via DeepSeek API."""
        messages = [{"role": "system", "content": system_prompt}]
        for speaker, text in (history or [])[-8:]:
            role = "user" if speaker in ("Player", "player") else "assistant"
            messages.append({"role": role, "content": text})
        messages.append({"role": "user", "content": player_text})
        for attempt in range(MAX_RETRIES + 1):
            reply = self._call(messages, DIALOGUE_MAX_TOKENS)
            if reply and self._quality_ok(reply, player_text):
                return reply, True
        return None, False

    def generate_scene(self, world_name, world_description, player_action):
        """Generate atmospheric narration via DeepSeek API."""
        messages = [
            {"role": "system", "content": SCENE_SYSTEM},
            {"role": "user", "content": (
                f"World: {world_name}\n"
                f"Setting: {world_description}\n"
                f'The player tries: "{player_action}"\n\n'
                "Describe what the player experiences right now."
            )}
        ]
        for attempt in range(MAX_RETRIES + 1):
            scene = self._call(messages, SCENE_MAX_TOKENS)
            if scene and self._quality_ok(scene, player_action):
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
    def _quality_ok(text, player_text):
        if not text or len(text) < 15:
            return False
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

    def generate_dialogue(self, system_prompt, npc_name, history, player_text):
        messages = [{"role": "system", "content": system_prompt}]
        for speaker, text in (history or [])[-8:]:
            role = "user" if speaker in ("Player", "player") else "assistant"
            messages.append({"role": role, "content": text})
        messages.append({"role": "user", "content": player_text})
        for _ in range(MAX_RETRIES + 1):
            reply = self._call(messages, DIALOGUE_MAX_TOKENS)
            if reply and DeepSeekClient._quality_ok(reply, player_text):
                return reply, True
        return None, False

    def generate_scene(self, world_name, world_description, player_action):
        messages = [
            {"role": "system", "content": SCENE_SYSTEM},
            {"role": "user", "content": (
                f"World: {world_name}\n"
                f"Setting: {world_description}\n"
                f'The player tries: "{player_action}"\n\n'
                "Describe what the player experiences right now."
            )},
        ]
        for _ in range(MAX_RETRIES + 1):
            scene = self._call(messages, SCENE_MAX_TOKENS)
            if scene and DeepSeekClient._quality_ok(scene, player_action):
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
