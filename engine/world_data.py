import json, os, sys
_world_data = None


def _resource_path(*parts):
    base = getattr(sys, "_MEIPASS", None)
    if base:
        return os.path.join(base, *parts)
    return os.path.join(os.path.dirname(__file__), "..", *parts)


def load_world_data():
    global _world_data
    if _world_data is not None: return _world_data
    path = _resource_path("data", "world_data.json")
    with open(path, "r", encoding="utf-8") as f: _world_data = json.load(f)
    return _world_data
def get_world(wid): return load_world_data()["worlds"].get(wid)
def get_npc(nid): return load_world_data()["npcs"].get(nid)
def get_item(iid): return load_world_data()["items"].get(iid)
def get_default(key): return load_world_data()["default_responses"].get(key, "")
def get_game_intro(): return load_world_data()["game"]["intro"]
