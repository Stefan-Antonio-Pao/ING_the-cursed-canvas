"""Language resource loader with fallback chain.

Every getter follows this pattern:
  1. Try i18n/{lang}/resource
  2. Fall back to i18n/{LANG_FALLBACK}/resource  (always "en")
"""

import json
import os
import importlib
import logging

logger = logging.getLogger(__name__)

LANG_FALLBACK = "en"
SUPPORTED_LANGUAGES = ["en", "zh"]

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_CACHE = {}


def get_supported_languages():
    return list(SUPPORTED_LANGUAGES)


def get_default_language():
    return LANG_FALLBACK


def resolve_language(request_lang=None, session_lang=None, accept_header=None):
    """Determine the best language for a request.

    Priority:
      1. Explicit request_lang (from POST body or URL param)
      2. session_lang (user previously chose)
      3. accept_header (browser Accept-Language)
      4. LANG_FALLBACK ("en")
    """
    if request_lang and request_lang in SUPPORTED_LANGUAGES:
        return request_lang
    if session_lang and session_lang in SUPPORTED_LANGUAGES:
        return session_lang
    if accept_header:
        for part in accept_header.replace(" ", "").split(","):
            code = part.split(";")[0].split("-")[0]
            if code in SUPPORTED_LANGUAGES:
                return code
    return LANG_FALLBACK


def _load_json_resource(lang, resource_name):
    cache_key = (lang, resource_name)
    if cache_key in _CACHE:
        return _CACHE[cache_key]

    for try_lang in (lang, LANG_FALLBACK):
        path = os.path.join(_BASE_DIR, try_lang, resource_name)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            _CACHE[cache_key] = data
            return data

    raise FileNotFoundError(f"Resource {resource_name} not found for any language.")


def _load_python_resource(lang, module_name, attr_name):
    for try_lang in (lang, LANG_FALLBACK):
        try:
            mod = importlib.import_module(f"i18n.{try_lang}.{module_name}")
            return getattr(mod, attr_name)
        except (ImportError, AttributeError):
            continue
    raise ImportError(f"Module i18n.{{lang}}.{module_name} not found for any language.")


def get_world_data(lang):
    return _load_json_resource(lang, "world_data.json")


def get_intents(lang):
    return _load_json_resource(lang, "intents.json")


def get_dm_prompt(lang):
    return _load_python_resource(lang, "prompts", "DM_SYSTEM_PROMPT")


def get_npc_prompt(npc_id, lang):
    prompts = _load_python_resource(lang, "prompts", "NPC_PROMPTS")
    return prompts.get(npc_id, "")


def get_npc_personality(npc_id, lang):
    prompts = _load_python_resource(lang, "prompts", "NPC_PERSONALITIES")
    return prompts.get(npc_id, "")


def get_scene_prompt(lang):
    return _load_python_resource(lang, "prompts", "SCENE_SYSTEM")


def get_keywords(lang):
    return _load_python_resource(lang, "keywords", "KEYWORD_RULES")


def get_move_world_keywords(lang):
    return _load_python_resource(lang, "keywords", "MOVE_WORLD_KEYWORDS")


def get_ui_strings(lang):
    return _load_json_resource(lang, "ui.json")


def clear_cache():
    _CACHE.clear()
    import sys
    for try_lang in SUPPORTED_LANGUAGES:
        for mod_name in ("prompts", "keywords"):
            full = f"i18n.{try_lang}.{mod_name}"
            if full in sys.modules:
                del sys.modules[full]
