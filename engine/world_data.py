"""World data access — delegates to i18n loader based on current language."""

import sys
import os
from i18n.loader import get_world_data as _i18n_get_world_data


def _current_lang():
    try:
        from flask import g
        return getattr(g, "lang", "en")
    except (ImportError, RuntimeError):
        return "en"


def _resource_path(*parts):
    base = getattr(sys, "_MEIPASS", None)
    if base:
        return os.path.join(base, *parts)
    return os.path.join(os.path.dirname(__file__), "..", *parts)


def load_world_data():
    return _i18n_get_world_data(_current_lang())


def get_world(wid):
    return load_world_data()["worlds"].get(wid)


def get_npc(nid):
    return load_world_data()["npcs"].get(nid)


def get_item(iid):
    return load_world_data()["items"].get(iid)


def get_default(key):
    return load_world_data()["default_responses"].get(key, "")


def get_game_intro():
    return load_world_data()["game"]["intro"]


def get_world_name(wid, lang=None):
    data = _i18n_get_world_data(lang or _current_lang())
    world = data.get("worlds", {}).get(wid, {})
    return world.get("name", wid.replace("_", " ").title())


def get_item_name(iid, lang=None):
    data = _i18n_get_world_data(lang or _current_lang())
    item = data.get("items", {}).get(iid, {})
    return item.get("name", iid.replace("_", " ").title())
