"""The Cursed Canvas -- Flask application with 3-tier command pipeline.

Priority cascade:
  Tier 1: DM Mode (LLM-as-DM via DeepSeek API or local model)
  Tier 2: Keyword rules (fast fallback)
  Tier 3: ML classifier (last resort)
"""

from flask import Flask, render_template, request, jsonify, session, g
import sys
import re
from dotenv import load_dotenv
load_dotenv()

import os, json, secrets, logging, threading, time, atexit, socket
from engine.story_engine import GameState
from engine.world_data import load_world_data, get_world, get_npc, get_world_name, get_item_name
from ai.intent import IntentClassifier
from ai.sentiment import analyze_sentiment
from ai.dm_prompt import build_dm_prompt, parse_dm_response
from ai.llm import get_llm_client, get_remote_experience_client, track_deepseek_usage
from i18n.loader import (
    resolve_language, get_supported_languages, get_ui_strings,
    get_keywords, get_move_world_keywords, LANG_FALLBACK,
)
import urllib.error
import urllib.request

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
app = Flask(__name__)
app.secret_key = secrets.token_hex(32)

# --- Model state ---
_llm = None
_classifier_en = None
_classifier_zh = None
_classifier_ready = False
_llm_ready = False
_llm_loading = False
_llm_progress_percent = 0
_llm_loading_started_at = 0
_active_mode = "api"  # "api" (DeepSeek) or "local" (Phi-3-mini)

# API failure tracking — skip API after repeated failures
_api_fail_count = 0
_api_broken_until = 0  # timestamp: 0 = not broken
_API_FAIL_THRESHOLD = 2  # after N consecutive failures, mark broken
_API_COOLDOWN_SECONDS = 30  # skip API for this long after marked broken

def _init_classifier():
    """Load the lightweight ML classifiers (sub-second, no network)."""
    global _classifier_en, _classifier_zh, _classifier_ready
    try:
        _classifier_en = IntentClassifier(lang="en")
        _classifier_en.load()
        logger.info("English intent classifier loaded.")
    except FileNotFoundError:
        logger.warning("No English classifier found. Run 'python -m ai.intent en' first.")
    except Exception as exc:
        _classifier_en = None
        logger.warning("English intent classifier unavailable. Falling back to keyword rules: %s", exc)
    try:
        _classifier_zh = IntentClassifier(lang="zh")
        _classifier_zh.load()
        logger.info("Chinese intent classifier loaded.")
    except FileNotFoundError:
        logger.warning("No Chinese classifier found. Run 'python -m ai.intent zh' to train.")
    except Exception as exc:
        _classifier_zh = None
        logger.warning("Chinese intent classifier unavailable. Falling back to keyword rules: %s", exc)
    _classifier_ready = True


def _get_classifier(lang="en"):
    if lang == "zh" and _classifier_zh:
        return _classifier_zh
    return _classifier_en


def _current_lang():
    try:
        return getattr(g, "lang", "en")
    except RuntimeError:
        return "en"

def _ensure_llm():
    """Lazy-load Phi-3-mini (heavy). Called when switching to local mode."""
    global _llm, _llm_ready, _llm_loading, _llm_progress_percent, _llm_loading_started_at
    if _llm_ready or _llm_loading:
        return _llm
    _llm_loading = True
    _llm_progress_percent = 10
    _llm_loading_started_at = time.time()
    logger.info("Loading Phi-3-mini (unified LLM)...")
    try:
        from ai.llm import get_llm
        _llm_progress_percent = 35
        _llm = get_llm()
        _llm_ready = True
        _llm_progress_percent = 100
        logger.info("Phi-3-mini loaded.")
    except Exception as e:
        _llm_progress_percent = 0
        logger.warning(f"Phi-3-mini failed: {e}. Using scripted fallbacks.")
    finally:
        _llm_loading = False
        _llm_loading_started_at = 0
    return _llm

def _warmup_async():
    """Background thread: warm up the local LLM."""
    logger.info("Background warmup started for Phi-3-mini...")
    _ensure_llm()
    logger.info("Background warmup complete.")

# Load classifier at import time (instant)
_init_classifier()
load_world_data()


# ------------------------------------------------------------------ #
# Server-side state store (avoids oversized session cookies)
# ------------------------------------------------------------------ #

_STATE_STORE = {}
_STATE_STORE_LOCK = threading.Lock()
_STATE_TTL_SECONDS = int(os.getenv("STATE_TTL_SECONDS", "21600"))
_SAVE_SLOT_COUNT = 3


def _is_desktop_app():
    return os.getenv("CURSED_CANVAS_DESKTOP") == "1" or bool(getattr(sys, "frozen", False))


def _app_user_data_dir():
    configured = os.getenv("CURSED_CANVAS_USER_DATA_DIR")
    if configured:
        return os.path.abspath(os.path.expanduser(configured))

    app_name = "The Cursed Canvas"
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~/Library/Application Support"), app_name)
    if os.name == "nt":
        base = os.getenv("APPDATA") or os.path.expanduser("~")
        return os.path.join(base, app_name)
    base = os.getenv("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, "the-cursed-canvas")


def _default_save_file_path():
    if _is_desktop_app():
        return os.path.join(_app_user_data_dir(), "save_slots.json")
    return os.path.join(app.root_path, "data", "save_slots.json")


_SAVE_FILE_PATH = os.getenv(
    "SAVE_FILE_PATH",
    _default_save_file_path(),
)
_SAVE_FILE_LOCK = threading.Lock()
try:
    _EXPERIENCE_TOKEN_LIMIT = int(os.getenv("EXPERIENCE_TOKEN_LIMIT", "120000"))
except ValueError:
    _EXPERIENCE_TOKEN_LIMIT = 120000
_EXPERIENCE_TOKEN_LIMIT = max(0, _EXPERIENCE_TOKEN_LIMIT)
_DEFAULT_EXPERIENCE_UNLOCK_KEY = "CURSED-CANVAS-TEST-7Q4M-2026"
_EXPERIENCE_UNLOCK_ENV_KEYS = ("DEEPSEEK_EXPERIENCE_UNLOCK_KEY", "EXPERIENCE_UNLOCK_KEY")


class _ExperienceQuotaExhausted(Exception):
    pass


def _mask_secret(value):
    value = (value or "").strip()
    if not value:
        return ""
    if len(value) <= 8:
        return value[:4] + ("*" * max(0, len(value) - 4))
    return value[:4] + ("*" * (len(value) - 8)) + value[-4:]


def _local_model_progress_percent():
    if _llm_ready:
        return 100
    if not _llm_loading:
        return 0
    configured = os.getenv("LOCAL_MODEL_PROGRESS_PERCENT")
    if configured:
        try:
            return max(0, min(99, int(configured)))
        except ValueError:
            pass
    elapsed = max(0, time.time() - _llm_loading_started_at) if _llm_loading_started_at else 0
    estimated = max(_llm_progress_percent, 35 + int(min(55, elapsed / 180 * 55)))
    return max(1, min(95, estimated))


def _experience_tokens_used():
    try:
        used = int(session.get("experience_tokens_used", 0))
    except (TypeError, ValueError):
        used = 0
    return max(0, min(_EXPERIENCE_TOKEN_LIMIT, used))


def _experience_tokens_remaining():
    if session.get("experience_unlocked"):
        return _EXPERIENCE_TOKEN_LIMIT
    return max(0, _EXPERIENCE_TOKEN_LIMIT - _experience_tokens_used())


def _experience_token_percent():
    if session.get("experience_unlocked"):
        return 100
    if _EXPERIENCE_TOKEN_LIMIT <= 0:
        return 0
    percent = round((_experience_tokens_remaining() / _EXPERIENCE_TOKEN_LIMIT) * 100)
    return max(0, min(100, percent))


def _experience_quota_limited():
    if _experience_proxy_url():
        return False
    return (
        session.get("deepseek_api_mode", "experience") == "experience"
        and not session.get("experience_unlocked")
    )


def _experience_api_allowed():
    if session.get("deepseek_api_mode", "experience") == "experience" and _experience_proxy_url():
        proxy_status, _ = _experience_proxy_probe(timeout=3)
        if not proxy_status:
            session["deepseek_api_mode"] = "personal"
            session.modified = True
            return False
        return True
    return not _experience_quota_limited() or _experience_tokens_remaining() > 0


def _consume_experience_tokens(total_tokens):
    if not _experience_quota_limited():
        return
    try:
        consumed = max(0, int(total_tokens))
    except (TypeError, ValueError):
        consumed = 0
    if consumed <= 0:
        return
    session["experience_tokens_used"] = min(
        _EXPERIENCE_TOKEN_LIMIT,
        _experience_tokens_used() + consumed,
    )
    session.modified = True


def _run_with_experience_quota(callable_):
    if not _experience_quota_limited():
        return callable_()
    if _experience_tokens_remaining() <= 0:
        raise _ExperienceQuotaExhausted()
    with track_deepseek_usage(_consume_experience_tokens):
        return callable_()


def _experience_unlock_key():
    for env_key in _EXPERIENCE_UNLOCK_ENV_KEYS:
        value = os.getenv(env_key)
        if value:
            return value
    return _DEFAULT_EXPERIENCE_UNLOCK_KEY


def _experience_proxy_url():
    return os.getenv("EXPERIENCE_PROXY_URL", "").rstrip("/")


def _experience_proxy_auth_token():
    return os.getenv("EXPERIENCE_PROXY_AUTH_TOKEN", "")


def _desktop_client_id_path():
    return os.path.join(_app_user_data_dir(), "client_id")


def _experience_client_id():
    if _is_desktop_app():
        path = _desktop_client_id_path()
        try:
            with open(path, "r", encoding="utf-8") as f:
                client_id = f.read().strip()
                if client_id:
                    return client_id
        except FileNotFoundError:
            pass
        except OSError as exc:
            logger.warning(f"Desktop client id could not be read: {exc}")
        client_id = secrets.token_urlsafe(32)
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(client_id)
        except OSError as exc:
            logger.warning(f"Desktop client id could not be written: {exc}")
        return client_id

    client_id = session.get("experience_client_id")
    if not client_id:
        client_id = secrets.token_urlsafe(32)
        session["experience_client_id"] = client_id
    return client_id


def _experience_proxy_request(path, payload=None, method="POST", timeout=8):
    proxy_url = _experience_proxy_url()
    if not proxy_url:
        return None
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    auth_token = _experience_proxy_auth_token()
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    request = urllib.request.Request(
        f"{proxy_url}{path}",
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        try:
            data = json.loads(exc.read().decode("utf-8"))
        except Exception:
            data = {"error": f"Experience proxy returned HTTP {exc.code}."}
        data.setdefault("status_code", exc.code)
        return data
    except Exception as exc:
        logger.warning(f"Experience proxy request failed: {exc}")
        return {"error": "Experience proxy is unavailable."}


def _experience_proxy_probe(timeout=4):
    proxy_url = _experience_proxy_url()
    if not proxy_url:
        return None, ""
    client_id = _experience_client_id()
    query = f"/api/experience/status?client_id={client_id}"
    data = _experience_proxy_request(query, payload=None, method="GET", timeout=timeout)
    if isinstance(data, dict) and not data.get("error"):
        return data, ""
    if isinstance(data, dict):
        return None, data.get("error") or "Experience proxy is unavailable."
    return None, "Experience proxy is unavailable."


def _experience_proxy_status():
    proxy_status, _ = _experience_proxy_probe()
    return proxy_status


def _experience_mode_available(proxy_status=None):
    if _experience_proxy_url():
        return bool(proxy_status)
    return bool(_experience_deepseek_key())


def _personal_deepseek_key():
    session_key = session.get("deepseek_personal_api_key", "")
    if session_key:
        return session_key, "settings"
    env_key = os.getenv("DEEPSEEK_API_KEY", "")
    if env_key:
        return env_key, "environment"
    return "", "none"


def _experience_deepseek_key():
    return os.getenv("DEEPSEEK_EXPERIENCE_API_KEY", "")


def _reset_deepseek_client_for_settings(api_mode=None):
    selected_mode = api_mode or session.get("deepseek_api_mode", "experience")
    if selected_mode == "personal":
        api_key, _ = _personal_deepseek_key()
    else:
        if _experience_proxy_url():
            return
        api_key = _experience_deepseek_key()
    try:
        from ai.llm import reset_deepseek_client
        reset_deepseek_client(api_key=api_key)
    except Exception as exc:
        logger.warning(f"DeepSeek client reset skipped: {exc}")


def _get_deepseek_client_for_current_settings():
    if session.get("deepseek_api_mode", "experience") == "personal":
        api_key, _ = _personal_deepseek_key()
        return get_llm_client("api", api_key=api_key)
    proxy_url = _experience_proxy_url()
    if proxy_url:
        proxy_status, _ = _experience_proxy_probe(timeout=3)
        if not proxy_status:
            session["deepseek_api_mode"] = "personal"
            session.modified = True
            api_key, _ = _personal_deepseek_key()
            if not api_key:
                raise RuntimeError("Experience mode is unavailable; personal DeepSeek API key is required.")
            return get_llm_client("api", api_key=api_key)
        return get_remote_experience_client(
            proxy_url=proxy_url,
            client_id=_experience_client_id(),
            auth_token=_experience_proxy_auth_token(),
        )
    else:
        api_key = _experience_deepseek_key()
    return get_llm_client("api", api_key=api_key)


def _model_status_payload(extra=None):
    api_broken = _api_broken_until > time.time()
    payload = {
        "active_mode": _active_mode,
        "api_available": not api_broken,
        "local_ready": _llm_ready,
        "local_loading": _llm_loading and not _llm_ready,
        "local_progress_percent": _local_model_progress_percent(),
        "classifier_ready": _classifier_ready,
        "game_ready": True,
    }
    if extra:
        payload.update(extra)
    return payload


def _settings_payload():
    key, source = _personal_deepseek_key()
    payload = _model_status_payload()
    proxy_status, proxy_error = _experience_proxy_probe()
    experience_available = _experience_mode_available(proxy_status)
    forced_personal = False
    if session.get("deepseek_api_mode", "experience") == "experience" and not experience_available:
        session["deepseek_api_mode"] = "personal"
        session.modified = True
        forced_personal = True
    if proxy_status:
        remaining_tokens = int(proxy_status.get("remaining_tokens", _experience_tokens_remaining()))
        token_limit = int(proxy_status.get("token_limit", _EXPERIENCE_TOKEN_LIMIT))
        remaining_percent = int(proxy_status.get("remaining_percent", _experience_token_percent()))
        experience_unlimited = bool(proxy_status.get("unlocked")) or bool(session.get("experience_unlocked"))
    else:
        remaining_tokens = _experience_tokens_remaining()
        token_limit = _EXPERIENCE_TOKEN_LIMIT
        remaining_percent = _experience_token_percent()
        experience_unlimited = bool(session.get("experience_unlocked"))
    payload.update({
        "language": {
            "current": g.lang if hasattr(g, "lang") else session.get("lang", "en"),
            "available": get_supported_languages(),
            "switching_available": True,
        },
        "deepseek": {
            "api_mode": session.get("deepseek_api_mode", "experience"),
            "personal_configured": bool(key),
            "personal_key_masked": _mask_secret(key),
            "personal_key_source": source,
            "experience_remaining_tokens": remaining_tokens,
            "experience_token_limit": token_limit,
            "experience_remaining_percent": remaining_percent,
            "experience_unlimited": experience_unlimited,
            "experience_proxy_enabled": bool(_experience_proxy_url()),
            "experience_proxy_available": bool(proxy_status),
            "experience_available": experience_available,
            "experience_status": "online" if experience_available else "offline",
            "experience_status_detail": (
                "Experience service is online."
                if experience_available
                else (proxy_error or "Experience service is not configured.")
            ),
            "experience_forced_personal": forced_personal,
        },
    })
    return payload


def _prune_expired_states(now_ts):
    expired = [
        sid
        for sid, rec in _STATE_STORE.items()
        if now_ts - rec.get("updated_at", 0) > _STATE_TTL_SECONDS
    ]
    for sid in expired:
        _STATE_STORE.pop(sid, None)


def _get_or_create_state_id():
    state_id = session.get("state_id")
    if not state_id:
        state_id = secrets.token_urlsafe(24)
        session["state_id"] = state_id
    return state_id


def _load_session_game_state():
    state_id = session.get("state_id")
    if not state_id:
        return None

    now_ts = time.time()
    with _STATE_STORE_LOCK:
        _prune_expired_states(now_ts)
        rec = _STATE_STORE.get(state_id)
        if not rec:
            return None
        rec["updated_at"] = now_ts
        state_dict = rec.get("state")

    return _restore_state(state_dict) if state_dict else None


def _save_session_game_state(gs):
    state_id = _get_or_create_state_id()
    now_ts = time.time()
    state_dict = _serialize_state(gs)

    with _STATE_STORE_LOCK:
        _prune_expired_states(now_ts)
        _STATE_STORE[state_id] = {"state": state_dict, "updated_at": now_ts}


def _delete_session_game_state():
    state_id = session.get("state_id")
    with _STATE_STORE_LOCK:
        if state_id:
            _STATE_STORE.pop(state_id, None)
    session.pop("state_id", None)


def _empty_save_slots():
    return [None for _ in range(_SAVE_SLOT_COUNT)]


def _public_save_record(record):
    if not record:
        return None
    return {
        "version": record.get("version", 1),
        "savedAt": record.get("savedAt"),
        "summary": record.get("summary") or {},
    }


def _public_save_slots(slots):
    return [_public_save_record(slot) for slot in slots]


def _normalize_save_record(record):
    if not isinstance(record, dict):
        return None
    state = record.get("state")
    if not isinstance(state, dict):
        return None

    gs = _restore_state(state)
    version = record.get("version", 1)

    saved_at = record.get("savedAt")
    if not isinstance(saved_at, str) or not saved_at:
        saved_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    if version < 2:
        lang = record.get("lang", "en")
        summary = record.get("summary") or _state_summary(gs, lang)
        if "location_name" not in summary:
            summary["location_name"] = get_world_name(summary.get("location_id", "museum"), lang)
        if "inventory_ids" not in summary:
            summary["inventory_ids"] = list(state.get("inventory", []))
        if "quests_completed_count" not in summary and "quests_completed" in summary:
            quests = summary.get("quests_completed_ids", {})
            if isinstance(quests, dict):
                summary["quests_completed_count"] = sum(1 for v in quests.values() if v)
            else:
                summary["quests_completed_count"] = summary.get("quests_completed", 0)
        return {
            "version": 2,
            "lang": lang,
            "savedAt": saved_at,
            "summary": summary,
            "state": _serialize_state(gs),
        }
    return {
        "version": 2,
        "lang": record.get("lang", "en"),
        "savedAt": saved_at,
        "summary": record.get("summary") or _state_summary(gs, "en"),
        "state": _serialize_state(gs),
    }


def _read_save_slots():
    with _SAVE_FILE_LOCK:
        try:
            if os.path.exists(_SAVE_FILE_PATH) and os.path.getsize(_SAVE_FILE_PATH) == 0:
                return _empty_save_slots()
            with open(_SAVE_FILE_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)
        except FileNotFoundError:
            return _empty_save_slots()
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning(f"Save slots could not be read: {exc}")
            return _empty_save_slots()

    raw_slots = raw.get("slots") if isinstance(raw, dict) else raw
    slots = _empty_save_slots()
    if isinstance(raw_slots, list):
        for idx in range(_SAVE_SLOT_COUNT):
            try:
                slots[idx] = _normalize_save_record(raw_slots[idx])
            except (IndexError, TypeError, ValueError) as exc:
                logger.warning(f"Save slot {idx + 1} could not be normalized: {exc}")
                slots[idx] = None
    return slots


def _write_save_slots(slots):
    normalized = _empty_save_slots()
    for idx in range(_SAVE_SLOT_COUNT):
        normalized[idx] = _normalize_save_record(slots[idx]) if idx < len(slots) and slots[idx] else None

    payload = {"version": 2, "slots": normalized}
    save_dir = os.path.dirname(_SAVE_FILE_PATH)
    os.makedirs(save_dir, exist_ok=True)
    tmp_path = f"{_SAVE_FILE_PATH}.tmp"

    with _SAVE_FILE_LOCK:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=True, indent=2)
        os.replace(tmp_path, _SAVE_FILE_PATH)

    return normalized


def _slot_index_from_request(slot_index):
    try:
        idx = int(slot_index)
    except (TypeError, ValueError):
        return None
    return idx if 0 <= idx < _SAVE_SLOT_COUNT else None


def _save_record_from_state(gs):
    lang = _current_lang()
    return {
        "version": 2,
        "lang": lang,
        "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary": _state_summary(gs, lang),
        "state": _serialize_state(gs),
    }


# ------------------------------------------------------------------ #
# Keyword-based intent classification (Tier 2 fallback)
# ------------------------------------------------------------------ #

def _classify_keyword_fallback(command, game_state=None):
    """Pure keyword-based intent detection. No ML, no LLM.
    Returns an intent string or None if no keyword matches.
    When game_state is provided and an NPC is present, conversational
    commands default to 'talk' instead of other intents.
    """
    lang = _current_lang()
    rules = get_keywords(lang)
    cmd = command.lower()
    words = cmd.split()
    npc_present = False
    if game_state:
        from engine.world_data import get_world
        world = get_world(game_state.current_world)
        if world and world.get("npcs"):
            npc_present = True

    if cmd in rules["inventory_exact"]:
        return "inventory"
    if any(phrase in cmd for phrase in rules["inventory"]):
        return "inventory"

    help_phrases = rules["help_exact"]
    if cmd in help_phrases or any(cmd.startswith(p + " ") or cmd.startswith(p + "？") for p in help_phrases):
        return "help"

    if any(v in cmd for v in rules["move_verbs"]):
        return "move"

    if any(v in cmd for v in rules["item_verbs"]):
        return "use_item"

    if any(w in cmd for w in rules["solve_keywords"]):
        return "solve"

    if any(w in cmd for w in rules["talk_starters"]):
        return "talk"
    if any(cmd.startswith(w) for w in rules["question_words"]):
        return "talk"

    if not npc_present and any(kw in cmd for kw in rules["world_keywords"]):
        return "move"

    if any(w in cmd for w in rules["explore_words"]):
        return "explore"

    if npc_present:
        first_word = words[0] if words else ""
        if first_word not in rules["action_verbs"] and len(words) >= 4:
            return "talk"

    first_word = words[0] if words else ""
    if first_word not in rules["action_verbs"] and len(words) >= 8:
        return "talk"

    return None


def _classify_ml_fallback(command):
    """ML classifier last resort. Returns intent or 'explore' on failure."""
    lang = _current_lang()
    clf = _get_classifier(lang)
    if clf:
        try:
            return clf.predict(command)
        except Exception:
            pass
    return "explore"


_MOVE_VERB_RE = re.compile(
    r"\b(go|move|enter|step|walk|head|travel|return|leave|exit|visit)\b"
)


def _has_explicit_move_verb(command):
    return bool(_MOVE_VERB_RE.search((command or "").lower()))


def _validate_move_intent(command, intent, world):
    """Validate that a 'move' intent targets a valid exit from the current world.
    
    If the command doesn't contain any valid exit destination, override to 'explore'.
    This prevents within-world movement (e.g., 'go back to the cottage') from being
    treated as world-level movement.
    """
    if intent != "move" or not world:
        return intent
    
    forced_target = _extract_move_target_from_command(
        command,
        world,
        require_move_verb=True,
    )
    if forced_target:
        return intent
    
    # No valid exit destination found — this is within-world movement
    logger.info(f"Move intent without valid destination, overriding to explore: '{command}'")
    return "explore"


def _extract_move_target_from_command(command, world, require_move_verb=False):
    """Extract a concrete world_id target from a move command.

    Returns a valid exit target from the current world, or None.
    """
    if not world:
        return None
    lang = _current_lang()
    move_kw = get_move_world_keywords(lang)
    cmd_lower = command.lower()
    if require_move_verb:
        rules = get_keywords(lang)
        if not any(v in cmd_lower for v in rules["move_verbs"]):
            return None
    for ex in (world.get("exits") or []):
        target = ex["target"]
        keywords = move_kw.get(target, [])
        if any(kw in cmd_lower for kw in keywords):
            return target
        target_world = get_world(target)
        if not target_world:
            continue
        target_name = target_world["name"].lower()
        target_id = target.lower()
        target_spaced = target_id.replace("_", " ")
        if target_name in cmd_lower or target_id in cmd_lower or target_spaced in cmd_lower:
            return target
        target_artist = target_world.get("artist", "").lower()
        if target_artist and target_artist in cmd_lower:
            return target
        if target_artist:
            artist_words = [w for w in re.split(r"\W+", target_artist) if len(w) > 3]
            if any(w in cmd_lower for w in artist_words):
                return target
    return None


# ------------------------------------------------------------------ #
# Input parsing — parentheses convention
# ------------------------------------------------------------------ #

def _parse_player_input(raw_command):
    """Parse player input using the parentheses convention.

    - Text wrapped in parentheses (...) or （...） = ACTION
      e.g. "(look around)", "(take lantern)", "(go to starry night)"
    - Plain text (no parentheses) = DIALOGUE with NPC
      e.g. "Where is the lantern?", "Tell me about the curse"

    Returns:
        (stripped_command, input_mode)
        input_mode: "action" or "dialogue"
    """
    cmd = raw_command.strip()
    if not cmd:
        return cmd, "action"

    if (cmd.startswith("(") and cmd.endswith(")")) or \
       (cmd.startswith("（") and cmd.endswith("）")):
        inner = cmd[1:-1].strip()
        if inner:
            return inner, "action"

    return cmd, "dialogue"


# ------------------------------------------------------------------ #
# Language detection
# ------------------------------------------------------------------ #

@app.before_request
def detect_language():
    lang = None
    if request.method == "POST" and request.is_json:
        data = request.get_json(silent=True)
        if data:
            lang = data.get("lang")
    session_lang = session.get("lang")
    accept = request.headers.get("Accept-Language", "")
    g.lang = resolve_language(
        request_lang=lang,
        session_lang=session_lang,
        accept_header=accept,
    )


# ------------------------------------------------------------------ #
# Routes
# ------------------------------------------------------------------ #

@app.route("/")
def index():
    session.pop("game_state", None)  # Legacy cookie payload cleanup
    existing_state = _load_session_game_state()
    if not existing_state:
        _save_session_game_state(GameState())
    session["llm_mode"] = _active_mode
    if not _llm_ready and not _llm_loading:
        threading.Thread(target=_warmup_async, daemon=True).start()
    return render_template("index.html")


@app.route("/api/command", methods=["POST"])
def handle_command():
    data = request.get_json(force=True)
    raw_command = data.get("command", "").strip()
    if not raw_command:
        return jsonify({"error": "Empty command"}), 400

    session.pop("game_state", None)  # Legacy cookie payload cleanup
    gs = _load_session_game_state() or GameState()
    mode = session.get("llm_mode", _active_mode)

    command, input_mode = _parse_player_input(raw_command)
    if not command:
        return jsonify({"error": "Empty command"}), 400

    # Preserve original input for transcript (with parentheses for actions)
    display_command = f"({command})" if (input_mode == "action" and raw_command != command) else raw_command

    world = get_world(gs.current_world)
    npc_present = bool(world and world.get("npcs"))

    is_action = input_mode == "action"
    force_talk = (input_mode == "dialogue" and npc_present)
    force_no_talk = is_action

    response = None
    global _api_fail_count, _api_broken_until

    dm_client = None
    dm_client_uses_api = False
    api_is_broken = (mode == "api" and _api_broken_until > time.time())
    try:
        if mode == "api" and not api_is_broken:
            if _experience_api_allowed():
                dm_client = _get_deepseek_client_for_current_settings()
                dm_client_uses_api = True
            else:
                logger.info("Experience token quota exhausted; skipping DeepSeek DM tier.")
        elif mode == "local" and _llm_ready:
            dm_client = _llm
    except Exception as e:
        logger.warning(f"Could not get LLM client for mode '{mode}': {e}")

    if dm_client is not None:
        try:
            messages = build_dm_prompt(command, gs, gs.memory,
                                       force_talk=force_talk,
                                       force_no_talk=force_no_talk)
            if dm_client_uses_api:
                raw_text, ok = _run_with_experience_quota(
                    lambda: dm_client.generate_dm_turn(messages)
                )
            else:
                raw_text, ok = dm_client.generate_dm_turn(messages)
            if ok and raw_text:
                dm_result = parse_dm_response(raw_text)
                if not dm_result:
                    retry_messages = messages + [
                        {"role": "assistant", "content": raw_text},
                        {
                            "role": "user",
                            "content": (
                                "Return one valid JSON object only. Do not include any extra text. "
                                "Include all keys: intent, scene, npc_reply, npc_name, mood, move_target."
                            ),
                        },
                    ]
                    if dm_client_uses_api:
                        retry_raw, retry_ok = _run_with_experience_quota(
                            lambda: dm_client.generate_dm_turn(retry_messages)
                        )
                    else:
                        retry_raw, retry_ok = dm_client.generate_dm_turn(retry_messages)
                    if retry_ok and retry_raw:
                        dm_result = parse_dm_response(retry_raw)
                if dm_result:
                    # Action commands with explicit destinations must win over DM drift.
                    if is_action:
                        kw_intent = _classify_keyword_fallback(command, game_state=gs)
                        if kw_intent == "move":
                            kw_intent = _validate_move_intent(command, kw_intent, world)
                            forced_target = _extract_move_target_from_command(
                                command,
                                world,
                                require_move_verb=True,
                            )
                            if kw_intent == "move" and forced_target:
                                if dm_result.get("intent") != "move":
                                    logger.info(
                                        "Overriding DM intent to move for explicit action command: '%s' -> %s",
                                        command,
                                        forced_target,
                                    )
                                dm_result["intent"] = "move"
                                dm_result["move_target"] = forced_target
                        elif kw_intent in ("use_item", "inventory", "help", "solve"):
                            if dm_result.get("intent") != kw_intent:
                                logger.info(
                                    "Overriding DM intent for explicit action command: '%s' -> %s",
                                    command,
                                    kw_intent,
                                )
                            dm_result["intent"] = kw_intent
                            dm_result["move_target"] = None

                    if force_talk:
                        dm_result["intent"] = "talk"
                        dm_result["move_target"] = None

                    # Dialogue input must never trigger world travel.
                    if input_mode == "dialogue" and dm_result.get("intent") == "move":
                        dm_result["intent"] = "talk" if npc_present else "explore"
                        dm_result["move_target"] = None
                    
                    # Safeguard: verify move_target is a valid exit from current world
                    if dm_result.get("intent") == "move":
                        mt = (dm_result.get("move_target") or "").lower().replace(" ", "_").replace("-", "_")
                        valid_exits = [ex["target"] for ex in (world.get("exits") or [])]
                        if mt not in valid_exits or mt == gs.current_world:
                            dm_result["intent"] = "explore"
                            dm_result["move_target"] = None
                            logger.info(f"Overriding invalid move to explore: '{command}' (target='{mt}', valid={valid_exits})")
                    
                    dm_result["player_command"] = display_command
                    response = gs.process_dm_response(dm_result)
                    logger.info(f"DM mode ({mode}): intent={dm_result.get('intent')}")
                    if mode == "api":
                        _api_fail_count = 0
            else:
                if mode == "api":
                    _api_fail_count += 1
                    if _api_fail_count >= _API_FAIL_THRESHOLD:
                        _api_broken_until = time.time() + _API_COOLDOWN_SECONDS
                        logger.warning(f"API failed {_api_fail_count}x, cooling down for {_API_COOLDOWN_SECONDS}s")
                    else:
                        logger.warning(f"API fail #{_api_fail_count}")
        except _ExperienceQuotaExhausted:
            logger.info("Experience token quota exhausted during DeepSeek DM tier.")
        except Exception as e:
            logger.warning(f"DM tier failed: {e}")
            if mode == "api":
                _api_fail_count += 1
                if _api_fail_count >= _API_FAIL_THRESHOLD:
                    _api_broken_until = time.time() + _API_COOLDOWN_SECONDS

    if response is None:
        if force_talk:
            ai_llm = None
            ai_llm_uses_api = False
            try:
                if mode == "api" and not api_is_broken and _experience_api_allowed():
                    ai_llm = _get_deepseek_client_for_current_settings()
                    ai_llm_uses_api = True
                elif _llm_ready:
                    ai_llm = _llm
            except Exception:
                pass
            if ai_llm_uses_api:
                try:
                    result = _run_with_experience_quota(
                        lambda: gs.process(intent="talk", command=display_command,
                                           ai_llm=ai_llm, sentiment=analyze_sentiment)
                    )
                except _ExperienceQuotaExhausted:
                    result = gs.process(intent="talk", command=display_command,
                                        ai_llm=None, sentiment=analyze_sentiment)
            else:
                result = gs.process(intent="talk", command=display_command,
                                    ai_llm=ai_llm, sentiment=analyze_sentiment)
            result["response_type"] = "keyword"
            response = result
        else:
            intent = _classify_keyword_fallback(command, game_state=gs)
            if intent is not None:
                if force_no_talk and intent == "talk":
                    intent = None
                if input_mode == "dialogue" and intent == "move":
                    intent = "talk" if npc_present else "explore"
            if intent is not None:
                # Safeguard: validate move intent against valid exits
                if intent == "move":
                    intent = _validate_move_intent(command, intent, world)
                logger.info(f"Keyword fallback: '{command}' -> {intent}")
                ai_llm = None
                ai_llm_uses_api = False
                if intent in ("explore", "talk"):
                    try:
                        if mode == "api" and not api_is_broken and _experience_api_allowed():
                            ai_llm = _get_deepseek_client_for_current_settings()
                            ai_llm_uses_api = True
                        elif _llm_ready:
                            ai_llm = _llm
                    except Exception:
                        pass
                if ai_llm_uses_api:
                    try:
                        result = _run_with_experience_quota(
                            lambda: gs.process(intent=intent, command=display_command,
                                               ai_llm=ai_llm, sentiment=analyze_sentiment)
                        )
                    except _ExperienceQuotaExhausted:
                        result = gs.process(intent=intent, command=display_command,
                                            ai_llm=None, sentiment=analyze_sentiment)
                else:
                    result = gs.process(intent=intent, command=display_command,
                                        ai_llm=ai_llm, sentiment=analyze_sentiment)
                result["response_type"] = "keyword"
                response = result

    if response is None:
        intent = _classify_ml_fallback(command)
        if force_no_talk and intent == "talk":
            intent = "explore"
        # Safeguard: validate move intent against valid exits
        if intent == "move":
            intent = _validate_move_intent(command, intent, world)
        logger.info(f"ML classifier fallback: '{command}' -> {intent}")
        result = gs.process(intent=intent, command=display_command,
                            ai_llm=None, sentiment=analyze_sentiment)
        result["response_type"] = "classifier"
        response = result

    _save_session_game_state(gs)
    if isinstance(response, dict) and session.get("deepseek_api_mode", "experience") == "experience":
        proxy_status = _experience_proxy_status()
        if proxy_status:
            response["experience_remaining_percent"] = proxy_status.get("remaining_percent", _experience_token_percent())
            response["experience_remaining_tokens"] = proxy_status.get("remaining_tokens", _experience_tokens_remaining())
        else:
            response["experience_remaining_percent"] = _experience_token_percent()
            response["experience_remaining_tokens"] = _experience_tokens_remaining()
    return jsonify(response)


@app.route("/api/mode", methods=["POST"])
def set_mode():
    """Switch between 'api' (DeepSeek) and 'local' (Phi-3-mini) modes."""
    global _active_mode
    data = request.get_json(force=True)
    new_mode = data.get("mode", "api")
    if new_mode not in ("api", "local"):
        return jsonify({"error": "Invalid mode. Use 'api' or 'local'."}), 400

    _active_mode = new_mode
    session["llm_mode"] = new_mode

    if new_mode == "local" and not _llm_ready and not _llm_loading:
        threading.Thread(target=_warmup_async, daemon=True).start()

    logger.info(f"Mode switched to: {new_mode}")
    return jsonify(_model_status_payload())


@app.route("/api/settings", methods=["GET", "POST"])
def settings():
    if request.method == "GET":
        return jsonify(_settings_payload())

    data = request.get_json(force=True)
    language = data.get("language")
    api_mode = data.get("api_mode")
    personal_api_key = data.get("personal_api_key")
    unlock_key = data.get("unlock_key")

    if language is not None:
        if language not in get_supported_languages():
            return jsonify({"error": f"Language '{language}' is not yet available."}), 400
        session["lang"] = language
        session["settings_language"] = language
        g.lang = language

    if api_mode is not None:
        if api_mode not in ("experience", "personal"):
            return jsonify({"error": "Invalid DeepSeek API mode."}), 400
        if api_mode == "experience":
            proxy_status, proxy_error = _experience_proxy_probe(timeout=4)
            if not _experience_mode_available(proxy_status):
                session["deepseek_api_mode"] = "personal"
                session.modified = True
                message = proxy_error or "Experience mode is unavailable. Use a personal DeepSeek API key."
                return jsonify({"error": message, **_settings_payload()}), 503
        session["deepseek_api_mode"] = api_mode

    if isinstance(personal_api_key, str):
        cleaned_key = personal_api_key.strip()
        if cleaned_key and "*" not in cleaned_key:
            session["deepseek_personal_api_key"] = cleaned_key
            session["deepseek_api_mode"] = "personal"

    if isinstance(unlock_key, str) and unlock_key.strip():
        if _experience_proxy_url():
            proxy_status, proxy_error = _experience_proxy_probe(timeout=4)
            if not proxy_status:
                session["deepseek_api_mode"] = "personal"
                session.modified = True
                return jsonify({"error": proxy_error or "Experience mode is unavailable."}), 503
            unlock_result = _experience_proxy_request("/api/experience/unlock", {
                "client_id": _experience_client_id(),
                "unlock_key": unlock_key.strip(),
            })
            if not unlock_result or unlock_result.get("error"):
                message = unlock_result.get("error") if unlock_result else "Unlock key was not accepted."
                return jsonify({"error": message}), 400
        else:
            expected_unlock_key = _experience_unlock_key()
            if not expected_unlock_key:
                return jsonify({"error": "Experience unlock is not configured."}), 400
            if not secrets.compare_digest(unlock_key.strip(), expected_unlock_key):
                return jsonify({"error": "Unlock key was not accepted."}), 400
        session["experience_unlocked"] = True
        session["deepseek_api_mode"] = "experience"

    _reset_deepseek_client_for_settings(session.get("deepseek_api_mode", "experience"))
    return jsonify(_settings_payload())


@app.route("/api/settings/experience/lock", methods=["POST"])
def lock_experience_mode():
    if _experience_proxy_url():
        _experience_proxy_request("/api/experience/lock", {
            "client_id": _experience_client_id(),
        }, timeout=3)
    session.pop("experience_unlocked", None)
    return ("", 204)


@app.route("/api/reset", methods=["POST"])
def reset_game():
    preserved_ai_settings = {
        "deepseek_api_mode": session.get("deepseek_api_mode"),
        "deepseek_personal_api_key": session.get("deepseek_personal_api_key"),
        "experience_tokens_used": session.get("experience_tokens_used"),
        "experience_unlocked": session.get("experience_unlocked"),
        "settings_language": session.get("settings_language"),
        "lang": session.get("lang"),
    }
    _delete_session_game_state()
    session.clear()
    for key, value in preserved_ai_settings.items():
        if value is not None:
            session[key] = value
    _save_session_game_state(GameState())
    session["llm_mode"] = _active_mode
    _reset_deepseek_client_for_settings(session.get("deepseek_api_mode", "experience"))
    return jsonify({"status": "ok", "message": "Game reset."})


@app.route("/api/save/export", methods=["GET"])
def export_save_state():
    gs = _load_session_game_state() or GameState()
    return jsonify({
        "state": _serialize_state(gs),
        "summary": _state_summary(gs),
    })


@app.route("/api/save/slots", methods=["GET"])
def get_save_slots():
    slots = _read_save_slots()
    return jsonify({"slots": _public_save_slots(slots)})


@app.route("/api/save/slots/<int:slot_index>", methods=["POST"])
def save_to_slot(slot_index):
    idx = _slot_index_from_request(slot_index)
    if idx is None:
        return jsonify({"error": "Invalid save slot."}), 400

    gs = _load_session_game_state() or GameState()
    slots = _read_save_slots()
    slots[idx] = _save_record_from_state(gs)
    slots = _write_save_slots(slots)

    return jsonify({
        "status": "ok",
        "slot": idx,
        "save": _public_save_record(slots[idx]),
        "slots": _public_save_slots(slots),
        "summary": slots[idx]["summary"],
    })


@app.route("/api/save/slots/<int:slot_index>", methods=["DELETE"])
def delete_save_slot(slot_index):
    idx = _slot_index_from_request(slot_index)
    if idx is None:
        return jsonify({"error": "Invalid save slot."}), 400

    slots = _read_save_slots()
    if not slots[idx]:
        return jsonify({"error": "This save slot is already empty."}), 404

    slots[idx] = None
    slots = _write_save_slots(slots)
    return jsonify({
        "status": "ok",
        "slot": idx,
        "slots": _public_save_slots(slots),
    })


@app.route("/api/save/import", methods=["POST"])
def import_save_state():
    data = request.get_json(force=True)
    slot_index = data.get("slot")
    state_payload = data.get("state")

    if slot_index is not None:
        idx = _slot_index_from_request(slot_index)
        if idx is None:
            return jsonify({"error": "Invalid save slot."}), 400
        slots = _read_save_slots()
        save_record = slots[idx]
        if not save_record:
            return jsonify({"error": "This save slot is empty."}), 404
        state_payload = save_record.get("state")

    if not isinstance(state_payload, dict):
        return jsonify({"error": "Invalid save data."}), 400

    try:
        gs = _restore_state(state_payload)
    except Exception as exc:
        logger.warning(f"Save import failed: {exc}")
        return jsonify({"error": "Save data could not be loaded."}), 400

    _save_session_game_state(gs)
    payload = {
        "status": "ok",
        "summary": _state_summary(gs),
        "ui_state": _build_ui_state_snapshot(gs),
        "state": _serialize_state(gs),
    }
    if slot_index is not None:
        payload["slot"] = idx
        payload["save"] = _public_save_record(save_record)
    return jsonify(payload)


@app.route("/api/save/migrate", methods=["POST"])
def migrate_browser_save_slots():
    data = request.get_json(force=True)
    incoming_slots = data.get("slots")
    if not isinstance(incoming_slots, list):
        return jsonify({"error": "Invalid save slots."}), 400

    slots = _read_save_slots()
    migrated = 0
    for idx in range(_SAVE_SLOT_COUNT):
        if slots[idx]:
            continue
        if idx >= len(incoming_slots):
            continue
        try:
            normalized = _normalize_save_record(incoming_slots[idx])
        except Exception as exc:
            logger.warning(f"Browser save slot {idx + 1} could not be migrated: {exc}")
            normalized = None
        if normalized:
            slots[idx] = normalized
            migrated += 1

    if migrated:
        slots = _write_save_slots(slots)

    return jsonify({
        "status": "ok",
        "migrated": migrated,
        "slots": _public_save_slots(slots),
    })


@app.route("/api/i18n/<lang>", methods=["GET"])
def get_i18n_strings(lang):
    if lang not in get_supported_languages():
        return jsonify({"error": f"Language '{lang}' not supported."}), 404
    return jsonify(get_ui_strings(lang))


@app.route("/api/language", methods=["POST"])
def set_language():
    data = request.get_json(force=True)
    lang = data.get("language", "en")
    if lang not in get_supported_languages():
        return jsonify({"error": f"Language '{lang}' is not yet available."}), 400
    session["lang"] = lang
    session["settings_language"] = lang
    g.lang = lang
    payload = {
        "language": lang,
        "available": get_supported_languages(),
    }
    gs = _load_session_game_state()
    if gs:
        ui_state = _build_ui_state_snapshot(gs)
        ui_state.pop("response_type", None)
        ui_state["intent"] = "language"
        payload["ui_state"] = ui_state
    return jsonify(payload)


@app.route("/api/status", methods=["GET"])
def status():
    gs = _load_session_game_state()
    return jsonify(_model_status_payload({
        "game_state_exists": gs is not None and gs.game_complete
    }))


# ------------------------------------------------------------------ #
# Gallery data routes
# ------------------------------------------------------------------ #

_GALLERY_SUPPLEMENT_EN = {
    "starry_night": {
        "order": 10,
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
        "image_alt": "The Starry Night by Vincent van Gogh",
        "image_credit": "Public domain image via Wikimedia Commons",
        "artwork_intro": [
            "Painted in 1889, The Starry Night turns the night sky into motion: stars burn like living suns, the cypress rises like a dark flame, and the village below feels almost silent enough to hear.",
            "The work belongs to Post-Impressionism, but it also feels like a private weather system. Van Gogh did not simply record what he saw; he shaped memory, emotion, and observation into a sky that still seems to move."
        ],
        "artist_intro": [
            "Vincent van Gogh was a Dutch painter whose short career changed modern art. His color, brushwork, and emotional intensity made ordinary landscapes feel charged with inner life.",
            "In the game, he appears as the Painter-Wizard of Light: urgent, wounded, and fiercely attached to the yellow that gives his stars their soul."
        ],
        "journey_story": [
            "Your journey with Van Gogh begins inside a sky that has lost its brightest note. The stars are present, but their warmth has been stolen by the curse.",
            "You search the dreamscape, find the enchanted lantern, and use its light to reveal the hidden yellow pigment behind the cypress. When you return that color to Van Gogh, the night recovers its voice and the first frame begins to heal."
        ]
    },
    "great_wave": {
        "order": 20,
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Great_Wave_off_Kanagawa2.jpg/1280px-Great_Wave_off_Kanagawa2.jpg",
        "image_alt": "The Great Wave off Kanagawa by Katsushika Hokusai",
        "image_credit": "Public domain image via Wikimedia Commons",
        "artwork_intro": [
            "The Great Wave off Kanagawa was created around 1831 as part of Hokusai's Thirty-six Views of Mount Fuji. Its force comes from contrast: a towering wave, fragile boats, and a distant mountain that remains impossibly calm.",
            "As a woodblock print, it was made to travel from hand to hand. That reproducible quality helped the wave become one of the most recognizable images in world art."
        ],
        "artist_intro": [
            "Katsushika Hokusai was a Japanese ukiyo-e master who kept changing his name, style, and ambitions across a long life of work. His lines make movement feel exact, disciplined, and alive.",
            "In the game, Hokusai becomes the Wave Commander: calm enough to listen to the sea, but unable to command a wave whose balance has been taken."
        ],
        "journey_story": [
            "Your path with Hokusai begins on a boat beneath a wave that has forgotten harmony. The danger is not solved by force; it asks for rhythm and stillness.",
            "You find the shell flute, reveal the calming stone, and bring both together. The wave softens, Mount Fuji keeps watch, and the print remembers the balance between motion and rest."
        ]
    },
    "impression_sunrise": {
        "order": 30,
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Claude_Monet%2C_Impression%2C_soleil_levant.jpg/1280px-Claude_Monet%2C_Impression%2C_soleil_levant.jpg",
        "image_alt": "Impression, Sunrise by Claude Monet",
        "image_credit": "Public domain image via Wikimedia Commons",
        "artwork_intro": [
            "Painted in 1872, Impression, Sunrise shows the port of Le Havre as fog, water, smoke, and one small orange sun. Its loose handling helped give Impressionism its name.",
            "The painting is less interested in hard outlines than in the sensation of a passing moment: light touching water before the eye can make everything certain."
        ],
        "artist_intro": [
            "Claude Monet was a French painter and a central figure of Impressionism. He returned again and again to changing light, weather, reflections, and the way color shifts across time.",
            "In the game, Monet is the Painter of Fleeting Light: precise, patient, and deeply aware that one missing color can make an entire morning fail to begin."
        ],
        "journey_story": [
            "Your journey with Monet begins in a harbor where dawn has thinned to a pale coin. The sun is present, but its orange breath has been drained away.",
            "You find the mist lens on the quay, use it to separate light from fog, and recover the sunrise pigment from the reflection beneath the boats. When the pigment returns, the harbor does not become sharper; it becomes alive."
        ]
    }
}

_GALLERY_SUPPLEMENT_ZH = {
    "starry_night": {
        "order": 10,
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
        "image_alt": "文森特·梵高《星月夜》",
        "image_credit": "Public domain image via Wikimedia Commons",
        "artwork_intro": [
            "《星月夜》创作于1889年，将夜空化为动势：星星如活的太阳般燃烧，丝柏树如一道黑色火焰般升起，而下方村庄的静谧几乎可以被听见。",
            "这件作品属于后印象派，但它也像是一个私密的天气系统。梵高并非简单地记录他所见之物；他将记忆、情感和观察塑造成一片似乎仍在移动的天空。"
        ],
        "artist_intro": [
            "文森特·梵高是一位荷兰画家，他短暂的职业生涯改变了现代艺术。他的色彩、笔触和情感强度使平凡的风景充满了内心生命。",
            "在游戏中，他以光线画家巫师的身份出现：急迫、受伤、并对赋予他星星灵魂的黄色怀着强烈的执念。"
        ],
        "journey_story": [
            "你与梵高的旅程始于一片失去了最亮音符的天空之内。星星仍在，但它们的温暖已被诅咒盗走。",
            "你在这片梦境中搜寻，找到了魔法灯笼，用它的光芒揭示了丝柏树后隐藏的黄色颜料。当你把那颜色归还给梵高时，夜晚重拾了它的声音，第一个画框开始愈合。"
        ]
    },
    "great_wave": {
        "order": 20,
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Great_Wave_off_Kanagawa2.jpg/1280px-Great_Wave_off_Kanagawa2.jpg",
        "image_alt": "葛饰北斋《神奈川冲浪里》",
        "image_credit": "Public domain image via Wikimedia Commons",
        "artwork_intro": [
            "《神奈川冲浪里》约于1831年创作，是北斋《富岳三十六景》系列的一部分。它的力量来自对比：一道高耸的巨浪、脆弱的小船，以及远处那座不可思议地保持平静的山。",
            "作为木版画，它被制作成可以在人与人之间传递的作品。这种可复制的特质帮助这道海浪成为世界艺术中最具辨识度的图像之一。"
        ],
        "artist_intro": [
            "葛饰北斋是一位日本浮世绘大师，在漫长的工作生涯中不断改变自己的名字、风格和抱负。他的线条让运动感觉精确、严谨且充满生命力。",
            "在游戏中，北斋化身为海浪之主：足够平静以聆听大海，却无法指挥一道平衡已被夺走的海浪。"
        ],
        "journey_story": [
            "你与北斋的旅程始于一道已忘记和谐的海浪之下的船上。危险不是靠力量解决的；它需要的是节奏与静默。",
            "你找到了海螺笛，揭示了安宁石，将两者结合。海浪柔化，富士山守望，版画记起了动静之间的平衡。"
        ]
    },
    "impression_sunrise": {
        "order": 30,
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Claude_Monet%2C_Impression%2C_soleil_levant.jpg/1280px-Claude_Monet%2C_Impression%2C_soleil_levant.jpg",
        "image_alt": "克劳德·莫奈《印象·日出》",
        "image_credit": "Public domain image via Wikimedia Commons",
        "artwork_intro": [
            "《印象·日出》创作于1872年，将勒阿弗尔港呈现为雾、水、烟尘和一轮小小的橙色太阳。它松散的笔法帮助印象派得名。",
            "这幅画对硬轮廓的兴趣不如对稍纵即逝瞬间的感觉：光芒触及水面，在眼睛能将一切确定之前。"
        ],
        "artist_intro": [
            "克劳德·莫奈是一位法国画家，印象派的核心人物。他一次又一次地回归到变化的光线、天气、倒影和颜色随时间变化的方式。",
            "在游戏中，莫奈是稍纵即逝的光线画家：精准、耐心，并深深意识到一抹缺失的颜色可以让整个清晨无法开始。"
        ],
        "journey_story": [
            "你与莫奈的旅程始于一个黎明已稀薄成一枚苍白硬币的港口。太阳仍在，但它的橙色呼吸已被抽干。",
            "你在码头上找到了雾透镜，用它分开光线与雾霭，从小船下方的倒影中找回了日出颜料。当颜料归还时，港口并未变得更清晰；它变得鲜活起来。"
        ]
    }
}

def _gallery_world_order(world_data):
    museum = world_data.get("worlds", {}).get("museum", {})
    ordered = [
        ex.get("target")
        for ex in museum.get("exits", [])
        if ex.get("target")
    ]
    remaining = [
        world_id
        for world_id, world in world_data.get("worlds", {}).items()
        if world_id != "museum" and world.get("artist") and world_id not in ordered
    ]
    return ordered + sorted(remaining)


def _build_gallery_artworks():
    """Build gallery pages from playable worlds.

    Future worlds can provide a "gallery" object in world_data.json with
    image, image_alt, image_credit, artwork_intro, artist_intro, journey_story,
    order, or visible fields. Nothing about this hook is shown in the UI.
    """
    lang = _current_lang()
    world_data = load_world_data()
    worlds = world_data.get("worlds", {})
    artworks = []

    for world_id in _gallery_world_order(world_data):
        world = worlds.get(world_id)
        if not world or not world.get("artist"):
            continue

        base_supplement = _GALLERY_SUPPLEMENT_ZH if lang == "zh" else _GALLERY_SUPPLEMENT_EN
        configured = dict(base_supplement.get(world_id, {}))
        configured.update(world.get("gallery") or {})
        if configured.get("visible", True) is False:
            continue

        npc = None
        for npc_id in world.get("npcs", []):
            npc = get_npc(npc_id)
            if npc:
                break

        artwork_intro = configured.get("artwork_intro") or [
            world.get("description", ""),
        ]
        artist_intro = configured.get("artist_intro") or [
            (npc or {}).get("personality", "") or f"{world['artist']} appears in this world as the guide to the restoration."
        ]
        journey_story = configured.get("journey_story") or [
            world.get("quest_description", ""),
            world.get("quest_completion", "")
        ]

        artworks.append({
            "id": world_id,
            "order": configured.get("order", 999),
            "artwork_title": world.get("name", world_id.replace("_", " ").title()),
            "artist_name": world.get("artist", ""),
            "artist_role": (npc or {}).get("role", ""),
            "period": world.get("art_period", ""),
            "image": configured.get("image", ""),
            "image_alt": configured.get("image_alt", f"{world.get('name', 'Artwork')} by {world.get('artist', 'the artist')}."),
            "image_credit": configured.get("image_credit", ""),
            "artwork_intro": [p for p in artwork_intro if p],
            "artist_intro": [p for p in artist_intro if p],
            "journey_story": [p for p in journey_story if p],
        })

    return sorted(artworks, key=lambda item: item["order"])


@app.route("/api/gallery", methods=["GET"])
def gallery_data():
    lang = request.args.get("lang") or _current_lang()
    artworks = _build_gallery_artworks()
    if lang == "zh":
        return jsonify({
            "intro": {
                "kicker": "修复画廊",
                "title": "被修复的画作安放光芒之处",
                "body": [
                    "这间画廊是《被诅咒的画布》的宁静侧翼：一份关于画框、声音和世界的鲜活记录——它们可能在博物馆陷入沉寂时敞开。",
                    "每一页将一幅画作与它的创作者配成一对，然后回忆起你在游戏中与它们共同经历的一段旅程：什么曾缺失，什么被修复，以及光芒回归后留下了什么。"
                ]
            },
            "artworks": artworks,
            "outro": {
                "kicker": "画框之后",
                "title": "博物馆不只是它的围墙",
                "body": [
                    "在旅程的终点，那些画作不再只是墙上遥远的杰作。它们已变成你跨越的场所、你回应过的声音、你帮助修复的脆弱世界。",
                    "诅咒因注意力化为行动而瓦解。你仔细观察，认真聆听，并修复了每位艺术家最需要的东西：光芒、平衡，以及一个瞬间的鲜活颜色。",
                    "当大门敞开时，画廊留在你身后——不是你逃离的房间，而是一段关于艺术的记忆，生动到足以踏入其中。"
                ]
            }
        })
    return jsonify({
        "intro": {
            "kicker": "Restoration Gallery",
            "title": "Where the Restored Paintings Keep Their Light",
            "body": [
                "This gallery is the quiet wing of The Cursed Canvas: a living record of frames, voices, and worlds that may open when the museum falls silent.",
                "Each page pairs an artwork with its maker, then remembers a fragment of the journey you share with them in the game: what was missing, what was restored, and what remained after the light returned."
            ]
        },
        "artworks": artworks,
        "outro": {
            "kicker": "After the Frames",
            "title": "A Museum Is More Than Its Walls",
            "body": [
                "By the end of the journey, the paintings are no longer distant masterpieces on a wall. They have become places you crossed, voices you answered, and fragile worlds you helped repair.",
                "The curse breaks because attention becomes action. You looked closely, listened carefully, and restored what each artist needed most: light, balance, and the living color of a moment.",
                "When the doors open, the gallery remains behind you - not as a room you escaped, but as a memory of art made vivid enough to step through."
            ]
        }
    })


# ------------------------------------------------------------------ #
# Ending page routes
# ------------------------------------------------------------------ #

@app.route("/ending")
def ending_page():
    return render_template("ending.html")


@app.route("/api/story", methods=["GET"])
def generate_story():
    gs = _load_session_game_state() or GameState()

    story_md = _build_story_from_memory(gs)
    chat_md = _build_chat_log(gs)

    return jsonify({"story": story_md, "chat_log": chat_md})


@app.route("/api/return", methods=["POST"])
def return_from_ending():
    gs = _load_session_game_state() or GameState()
    gs.current_world = "museum"
    _save_session_game_state(gs)
    return jsonify({
        "status": "ok",
        "message": "Welcome back! You can continue exploring the museum or revisit the paintings. Thank you for playing The Cursed Canvas!"
    })


def _build_story_from_memory(gs):
    """Generate a novella-style recap with stats footer."""
    lang = _current_lang()
    if lang == "zh":
        return _build_story_zh(gs)
    return _build_story_en(gs)


def _build_story_en(gs):
    memory = gs.memory
    events = list(memory.events) if memory else []
    transcript = memory.get_transcript() if memory else []

    def _world_name(world_id):
        w = get_world(world_id)
        return w["name"] if w else world_id.replace("_", " ").title()

    def _clean_line(text):
        s = (text or "").strip()
        s = re.sub(r"\s+", " ", s)
        return s

    player_lines = [line for line in transcript if line.get("speaker") == "Player"]
    narration_lines = [line for line in transcript if line.get("type") == "scene"]
    npc_lines = [line for line in transcript if line.get("type") == "npc_reply"]

    location_switches = 0
    last_location = None
    for line in transcript:
        location_id = line.get("location_id")
        if location_id and location_id != last_location:
            if last_location is not None:
                location_switches += 1
            last_location = location_id

    quest_events = [e for e in events if e.startswith("Quest completed in")]
    quest_by_world = {}
    for event in quest_events:
        m = re.search(r"Quest completed in\s+([a-z_]+)", event)
        if m:
            world_id = m.group(1)
            quest_by_world[world_id] = _world_name(world_id)

    first_command = _clean_line(player_lines[0]["text"]) if player_lines else "(No command captured.)"
    last_command = _clean_line(player_lines[-1]["text"]) if player_lines else "(No command captured.)"

    first_scene = _clean_line(narration_lines[0]["text"]) if narration_lines else "The halls were silent, and moonlight painted the floor in silver."
    last_scene = _clean_line(narration_lines[-1]["text"]) if narration_lines else "The museum doors opened, and the night finally exhaled."

    starry_quote = None
    wave_quote = None
    sunrise_quote = None
    for line in npc_lines:
        speaker = (line.get("speaker") or "").lower()
        if "vincent" in speaker and not starry_quote:
            starry_quote = _clean_line(line.get("text"))
        if "hokusai" in speaker and not wave_quote:
            wave_quote = _clean_line(line.get("text"))
        if "monet" in speaker and not sunrise_quote:
            sunrise_quote = _clean_line(line.get("text"))

    lines = []
    lines.append("# The Cursed Canvas - A Museum at Midnight\n")
    lines.append("## A Short Novella of Your Run\n")

    lines.append(
        "At an hour when ordinary doors should be locked and every corridor should be asleep, "
        "you stood in the Enchanted Museum listening to the silence breathe. "
        f"Your first move was simple: **{first_command}**. "
        f"From there, the night answered in color and weather: {first_scene}"
    )
    lines.append("")

    if "starry_night" in gs.visited_worlds:
        lines.append(
            "In *Starry Night*, the sky churned like a living spell. "
            "Vincent van Gogh carried grief and stubborn hope in the same heartbeat, "
            "and you learned to read light as if it were a language."
        )
        if starry_quote:
            lines.append(f"> Vincent van Gogh: \"{starry_quote}\"")
        lines.append(
            "With lantern-glow and careful searching, you pulled stolen color back into the world. "
            "The stars did not merely shine again; they sang."
        )
        lines.append("")

    if "great_wave" in gs.visited_worlds:
        lines.append(
            "In *The Great Wave off Kanagawa*, the sea held its breath at the edge of collapse. "
            "Katsushika Hokusai waited in composure sharpened by fear, and every crest looked like a question."
        )
        if wave_quote:
            lines.append(f"> Katsushika Hokusai: \"{wave_quote}\"")
        lines.append(
            "You found what the tide had hidden, answered the storm with rhythm, and returned calm to the water. "
            "When the wave finally bent instead of breaking, the painting remembered its balance."
        )
        lines.append("")

    if "impression_sunrise" in gs.visited_worlds:
        lines.append(
            "In *Impression, Sunrise*, the harbor dissolved into fog, smoke, and reflection. "
            "Claude Monet watched the dawn as a vanishing sensation, and the whole world seemed to depend on one orange note of light."
        )
        if sunrise_quote:
            lines.append(f"> Claude Monet: \"{sunrise_quote}\"")
        lines.append(
            "With the mist lens and the recovered pigment, you gave the sun back its pulse. "
            "The water answered in ripples of color, and the morning remembered how to begin."
        )
        lines.append("")

    lines.append(
        "When every canvas was restored, the museum changed temperature, as if relieved. "
        f"Your final action was **{last_command}**. "
        f"The last thing the night gave back to you was this: {last_scene}"
    )
    lines.append("")
    lines.append("The doors opened. You walked out carrying salt, starlight, sunrise, and three worlds that now knew your name.")
    lines.append("")
    lines.append("---")
    lines.append("## Run Statistics")
    lines.append(f"- Total turns: {gs.turn_count}")
    lines.append(f"- Location transitions: {location_switches}")
    lines.append(f"- Player commands captured: {len(player_lines)}")
    lines.append(f"- Narration lines captured: {len(narration_lines)}")
    lines.append(f"- NPC dialogue lines captured: {len(npc_lines)}")
    if quest_by_world:
        lines.append(f"- Quests completed: {', '.join(quest_by_world.values())}")
    else:
        lines.append("- Quests completed: none")
    lines.append(f"- Visited worlds: {', '.join(_world_name(w) for w in sorted(gs.visited_worlds))}")

    return "\n".join(lines)


def _build_story_zh(gs):
    memory = gs.memory
    events = list(memory.events) if memory else []
    transcript = memory.get_transcript() if memory else []

    def _world_name(world_id):
        w = get_world(world_id)
        return w["name"] if w else world_id.replace("_", " ").title()

    def _clean_line(text):
        s = (text or "").strip()
        s = re.sub(r"\s+", " ", s)
        return s

    player_lines = [line for line in transcript if line.get("speaker") == "Player"]
    narration_lines = [line for line in transcript if line.get("type") == "scene"]
    npc_lines = [line for line in transcript if line.get("type") == "npc_reply"]

    location_switches = 0
    last_location = None
    for line in transcript:
        location_id = line.get("location_id")
        if location_id and location_id != last_location:
            if last_location is not None:
                location_switches += 1
            last_location = location_id

    quest_events = [e for e in events if "Quest completed" in e]
    quest_by_world = {}
    for event in quest_events:
        m = re.search(r"Quest completed in\s+([a-z_]+)", event)
        if m:
            world_id = m.group(1)
            quest_by_world[world_id] = _world_name(world_id)

    first_command = _clean_line(player_lines[0]["text"]) if player_lines else "（未捕获命令。）"
    last_command = _clean_line(player_lines[-1]["text"]) if player_lines else "（未捕获命令。）"

    first_scene = _clean_line(narration_lines[0]["text"]) if narration_lines else "大厅一片寂静，月光将银辉洒在地板上。"
    last_scene = _clean_line(narration_lines[-1]["text"]) if narration_lines else "博物馆的大门打开了，夜色终于松了一口气。"

    starry_quote = None
    wave_quote = None
    sunrise_quote = None
    for line in npc_lines:
        speaker = (line.get("speaker") or "").lower()
        if ("vincent" in speaker or "梵高" in speaker) and not starry_quote:
            starry_quote = _clean_line(line.get("text"))
        if ("hokusai" in speaker or "北斋" in speaker) and not wave_quote:
            wave_quote = _clean_line(line.get("text"))
        if ("monet" in speaker or "莫奈" in speaker) and not sunrise_quote:
            sunrise_quote = _clean_line(line.get("text"))

    lines = []
    lines.append("# 被诅咒的画布 — 午夜博物馆\n")
    lines.append("## 你的冒险短篇\n")

    lines.append(
        "在这个本应大门紧锁、每条走廊都沉入梦乡的时刻，"
        "你站在被施了魔法的博物馆中，聆听寂静的呼吸。"
        f"你的第一个动作简单而果断：**{first_command}**。"
        f"从那一刻起，夜晚以色彩和气象作答：{first_scene}"
    )
    lines.append("")

    if "starry_night" in gs.visited_worlds:
        lines.append(
            "在《星月夜》中，天空如活着的咒语般翻涌。"
            "文森特·梵高在同一颗心跳中承载着悲伤与固执的希望，"
            "而你学会了像阅读语言一样阅读光芒。"
        )
        if starry_quote:
            lines.append(f"> 文森特·梵高：「{starry_quote}」")
        lines.append(
            "凭借灯笼的光芒和仔细的搜寻，你将失窃的颜色拉回了这个世界。"
            "星星不再仅是闪耀——它们歌唱。"
        )
        lines.append("")

    if "great_wave" in gs.visited_worlds:
        lines.append(
            "在《神奈川冲浪里》中，大海在崩塌的边缘屏住了呼吸。"
            "葛饰北斋以一种被恐惧磨砺出的沉着等待，每一道浪峰都像是一个问号。"
        )
        if wave_quote:
            lines.append(f"> 葛饰北斋：「{wave_quote}」")
        lines.append(
            "你找到了潮汐隐藏的东西，以节奏回应风暴，将平静归还给海水。"
            "当那道海浪终于弯曲而非粉碎时，画作记起了它的平衡。"
        )
        lines.append("")

    if "impression_sunrise" in gs.visited_worlds:
        lines.append(
            "在《印象·日出》中，港口消融在雾霭、烟雾和倒影之中。"
            "克劳德·莫奈凝视着如同转瞬即逝的感觉般的黎明，仿佛整个世界都依赖于那一抹橙色的光芒。"
        )
        if sunrise_quote:
            lines.append(f"> 克劳德·莫奈：「{sunrise_quote}」")
        lines.append(
            "用雾透镜和找回的颜料，你让太阳恢复了脉搏。"
            "水面以色彩的涟漪作答，而清晨记起了如何开始。"
        )
        lines.append("")

    lines.append(
        "当每一幅画布都被修复后，博物馆似乎换了温度，像松了一口气。"
        f"你的最后一个动作是 **{last_command}**。"
        f"夜晚最后还给你的是：{last_scene}"
    )
    lines.append("")
    lines.append("大门敞开了。你走了出去，带着盐味、星光、日出，以及三个如今已知道你名字的世界。")
    lines.append("")
    lines.append("---")
    lines.append("## 游戏统计")
    lines.append(f"- 总回合数：{gs.turn_count}")
    lines.append(f"- 场景转换次数：{location_switches}")
    lines.append(f"- 玩家输入命令数：{len(player_lines)}")
    lines.append(f"- 叙事段落数：{len(narration_lines)}")
    lines.append(f"- NPC 对话记录数：{len(npc_lines)}")
    if quest_by_world:
        lines.append(f"- 已完成任务：{'、'.join(quest_by_world.values())}")
    else:
        lines.append("- 已完成任务：无")
    lines.append(f"- 已访问的世界：{'、'.join(_world_name(w) for w in sorted(gs.visited_worlds))}")

    return "\n".join(lines)


def _build_chat_log(gs):
    """Build a full timeline transcript in screenplay format."""
    lang = _current_lang()
    memory = gs.memory
    transcript = memory.get_transcript() if memory else []

    if lang == "zh":
        if not transcript:
            return "# 被诅咒的画布 — 完整对话时间线\n\n（本次游戏未捕获任何对话记录。）"
        title = "# 被诅咒的画布 — 完整对话时间线"
        notes_title = "## 记录说明"
        notes = ["- 按捕获的回合顺序排列。", "- 包含玩家命令、叙事和 NPC 对话。"]
    else:
        if not transcript:
            return "# The Cursed Canvas - Full Dialogue Timeline\n\n(No transcript captured in this run.)"
        title = "# The Cursed Canvas - Full Dialogue Timeline"
        notes_title = "## Transcript Notes"
        notes = ["- Ordered exactly by captured turn sequence.", "- Includes player commands, narration, and NPC dialogue."]

    def _slug_to_scene(world_id):
        w = get_world(world_id)
        return w["name"].upper() if w else world_id.replace("_", " ").upper()

    lines = []
    lines.append(title)
    lines.append("")
    lines.append("## Screenplay Transcript" if lang != "zh" else "## 剧本式记录")
    lines.append("")

    current_scene = None
    last_turn = None

    for line in transcript:
        turn = line.get("turn", 0)
        location_id = line.get("location_id", "museum")
        speaker = line.get("speaker", "Narrator")
        text = (line.get("text") or "").strip()
        line_type = line.get("type", "scene")
        if not text:
            continue

        scene_heading = f"SCENE {_slug_to_scene(location_id)}"
        if scene_heading != current_scene:
            if current_scene is not None:
                lines.append("")
            lines.append(f"### {scene_heading}")
            current_scene = scene_heading

        if turn != last_turn:
            lines.append("")
            lines.append(f"[TURN {turn}]")
            last_turn = turn

        if line_type == "player_command":
            lines.append(f"PLAYER: {text}")
        elif line_type == "scene":
            lines.append(f"NARRATOR: {text}")
        else:
            lines.append(f"{speaker.upper()}: {text}")

    lines.append("")
    lines.append("---")
    lines.append(notes_title)
    for note in notes:
        lines.append(note)

    return "\n".join(lines)


# ------------------------------------------------------------------ #
# State serialization helpers
# ------------------------------------------------------------------ #

def _serialize_state(gs):
    return {
        "current_world": gs.current_world,
        "inventory": gs.inventory,
        "items_found": list(gs.items_found),
        "revealed_items": list(gs.revealed_items),
        "quests_completed": gs.quests_completed,
        "npcs_met": list(gs.npcs_met),
        "visited_worlds": list(gs.visited_worlds),
        "game_complete": gs.game_complete,
        "turn_count": gs.turn_count,
        "_first_turn": gs._first_turn,
        "memory": gs.memory.to_dict()
    }


def _restore_state(d):
    from engine.memory import ContextMemory
    gs = GameState()
    gs.current_world = d.get("current_world", "museum")
    gs.inventory = d.get("inventory", [])
    gs.items_found = set(d.get("items_found", []))
    gs.revealed_items = set(d.get("revealed_items", []))
    default_quests = {"starry_night": False, "great_wave": False, "impression_sunrise": False}
    gs.quests_completed = {**default_quests, **(d.get("quests_completed") or {})}
    gs.npcs_met = set(d.get("npcs_met", []))
    gs.visited_worlds = set(d.get("visited_worlds", {"museum"}))
    gs.game_complete = d.get("game_complete", False)
    gs.turn_count = d.get("turn_count", 0)
    gs._first_turn = d.get("_first_turn", True)
    gs.memory = ContextMemory.from_dict(d.get("memory"))
    return gs


def _state_summary(gs, lang=None):
    if lang is None:
        lang = _current_lang()
    w = get_world(gs.current_world)
    quests = dict(gs.quests_completed)
    return {
        "location": get_world_name(gs.current_world, lang),
        "location_id": gs.current_world,
        "location_name": get_world_name(gs.current_world, lang),
        "turn_count": gs.turn_count,
        "inventory_count": len(gs.inventory),
        "inventory_ids": list(gs.inventory),
        "quests_completed": sum(1 for done in quests.values() if done),
        "quests_completed_count": sum(1 for done in quests.values() if done),
        "quests_total": len(quests),
        "quests_completed_ids": {k: v for k, v in quests.items() if v},
        "game_complete": gs.game_complete,
    }


def _build_ui_state_snapshot(gs):
    from engine.world_data import get_item

    w = get_world(gs.current_world)
    exits_data = []
    if w:
        for ex in w.get("exits", []):
            target = get_world(ex["target"])
            exits_data.append({
                "target": ex["target"],
                "name": target["name"] if target else ex["target"],
                "description": ex["description"],
            })

    npc_name = None
    npc_role = None
    if w and w.get("npcs"):
        npc = get_npc(w["npcs"][0])
        if npc:
            npc_name = npc.get("name")
            npc_role = npc.get("role")

    return {
        "scene": "",
        "npc_reply": None,
        "npc_name": npc_name,
        "npc_role": npc_role,
        "mood": "neutral",
        "intent": "load",
        "response_type": "save",
        "location": w["name"] if w else gs.current_world,
        "location_id": gs.current_world,
        "location_desc": w.get("short_desc", "") if w else "",
        "exits": exits_data,
        "inventory": [get_item(i)["name"] for i in gs.inventory] if gs.inventory else [],
        "quests": dict(gs.quests_completed),
        "game_over": gs.game_complete,
        "victory": gs.game_complete,
        "all_quests_done": all(gs.quests_completed.values()),
    }


# ------------------------------------------------------------------ #
# Server startup with automatic port cleanup
# ------------------------------------------------------------------ #

_DEFAULT_PORT = 7860


def _check_port_free(port, timeout=2):
    """Return True if the port is free to bind."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.bind(("127.0.0.1", port))
        sock.close()
        return True
    except OSError:
        return False


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else _DEFAULT_PORT

    max_attempts = 10
    for attempt in range(max_attempts):
        if _check_port_free(port):
            break
        print(f"Port {port} is busy, trying {port + 1}...")
        port += 1
    else:
        print(f"Could not find a free port after {max_attempts} attempts.")
        sys.exit(1)

    print(f"Starting server on port {port}...")
    print(f"Open http://127.0.0.1:{port} in your browser.")
    app.run(debug=True, host="127.0.0.1", port=port)
