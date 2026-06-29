"""Dungeon Master prompt engineering for The Cursed Canvas — i18n-aware."""

import json
import logging
import re

from engine.world_data import get_world, get_npc, get_item, load_world_data
from i18n.loader import get_dm_prompt, get_npc_prompt, get_scene_prompt


logger = logging.getLogger(__name__)


def _current_lang():
    try:
        from flask import g
        return getattr(g, "lang", "en")
    except (ImportError, RuntimeError):
        return "en"


def build_dm_prompt(command, game_state, memory, force_talk=False, force_no_talk=False):
    lang = _current_lang()
    world = get_world(game_state.current_world)
    if not world:
        return [
            {"role": "system", "content": get_dm_prompt(lang)},
            {"role": "user", "content": f'Player says: "{command}"'}
        ]

    world_ctx = _build_world_context(world, game_state, lang)

    mem_ctx = memory.context_summary() if memory else "(No history yet.)"
    recent_events = memory.recent_events_string(6) if memory else "(Nothing yet.)"

    npc_history_ctx = ""
    if world.get("npcs") and memory:
        for npc_id in world["npcs"]:
            history = memory.get_npc_history(npc_id)
            if history:
                npc = get_npc(npc_id)
                npc_label = npc["name"] if npc else npc_id
                lines = []
                for speaker, text in history[-6:]:
                    lines.append(f"  {speaker}: {text}")
                npc_history_ctx += f"\n## Recent Conversation with {npc_label}\n" + "\n".join(lines) + "\n"

    section_labels = _get_section_labels(lang)

    input_type_hint = ""
    if force_talk:
        input_type_hint = "\n**" + section_labels["dialogue_hint"] + "**\n"
    elif force_no_talk:
        input_type_hint = "\n**" + section_labels["action_hint"] + "**\n"

    user_content = (
        f"{section_labels['game_state']}\n"
        f"{world_ctx}\n\n"
        f"{section_labels['player_status']}\n"
        f"{mem_ctx}\n\n"
        f"{section_labels['recent_events']}\n"
        f"{recent_events}\n"
        f"{npc_history_ctx}\n"
        f"{section_labels['player_command']}\n"
        f'"{command}"\n'
        f"{input_type_hint}\n"
        f"{section_labels['respond_json']}"
    )

    return [
        {"role": "system", "content": get_dm_prompt(lang)},
        {"role": "user", "content": user_content}
    ]


def _get_section_labels(lang):
    if lang == "zh":
        return {
            "game_state": "## 当前游戏状态",
            "player_status": "## 玩家状态",
            "recent_events": "## 最近事件",
            "player_command": "## 玩家命令",
            "respond_json": "请用上述 JSON 格式回复。",
            "dialogue_hint": "这是对话——玩家正在与 NPC 交谈。使用 intent \"talk\"。",
            "action_hint": "这是行动（玩家使用了括号）。不要将其分类为 \"talk\"。",
        }
    return {
        "game_state": "## Current Game State",
        "player_status": "## Player Status",
        "recent_events": "## Recent Events",
        "player_command": "## Player Command",
        "respond_json": "Respond with the JSON object as instructed.",
        "dialogue_hint": "This is DIALOGUE — the player is speaking to the NPC. Use intent \"talk\".",
        "action_hint": "This is an ACTION (player used parentheses). Do NOT classify as \"talk\".",
    }


def _build_world_context(world, game_state, lang):
    parts = []
    if lang == "zh":
        parts.append(f"**地点**: {world['name']}")
        parts.append(f"**描述**: {world['description']}")

        exits = world.get("exits", [])
        if exits:
            exit_strs = []
            for ex in exits:
                target_world = get_world(ex["target"])
                target_name = target_world["name"] if target_world else ex["target"]
                exit_strs.append(f"{target_name} (id: {ex['target']})")
            parts.append(f"**可用出口**: {', '.join(exit_strs)}")
        else:
            parts.append("**可用出口**: 无。")

        items_available = world.get("items_available", [])
        found_items = game_state.items_found
        visible_items = []
        for item_id in items_available:
            if item_id not in found_items:
                item = get_item(item_id)
                if item:
                    visible_items.append(f"{item['name']} (id: {item_id})")
        if visible_items:
            parts.append(f"**可见物品**: {', '.join(visible_items)}")
        else:
            parts.append("**可见物品**: 无可视物品（均已找到或不在此处）。")

        hidden = world.get("items_hidden", {})
        for hid_id, hid_data in hidden.items():
            if hid_id not in found_items:
                reveal_item = hid_data.get("reveal_item", "")
                if reveal_item in game_state.inventory:
                    item = get_item(reveal_item)
                    parts.append(f"**提示**: 玩家现在拥有{item['name'] if item else reveal_item}，这可能会揭示这里的隐藏物品。")

        if game_state.inventory:
            inv_names = [get_item(i)['name'] if get_item(i) else i for i in game_state.inventory]
            parts.append(f"**玩家物品栏**: {', '.join(inv_names)}")
        else:
            parts.append("**玩家物品栏**: 空。")

        npcs = world.get("npcs", [])
        if npcs:
            for npc_id in npcs:
                npc = get_npc(npc_id)
                if npc:
                    parts.append(f"**在场的 NPC**: {npc['name']} — {npc.get('role', '')}")
                    parts.append(f"  性格: {npc.get('personality', 'N/A')}")
                    quest_goal = world.get("quest_goal")
                    if quest_goal and not game_state.quests_completed.get(game_state.current_world):
                        parts.append(f"  任务提示: {npc.get('quest_hint', 'N/A')}")
        else:
            parts.append("**在场的 NPC**: 无。")

        cw = game_state.current_world
        quest_goal = world.get("quest_goal")
        if quest_goal:
            done = game_state.quests_completed.get(cw, False)
            quest_desc = world.get("quest_description", "未知任务。")
            parts.append(f"**任务**: {quest_desc}")
            parts.append(f"**任务状态**: {'已完成' if done else '进行中'}")
            if not done:
                if cw == "starry_night":
                    has_pigment = "yellow_pigment" in game_state.inventory
                    parts.append(f"  需求: 黄色颜料 (玩家拥有: {'是' if has_pigment else '否'})")
                elif cw == "great_wave":
                    has_stone = "calming_stone" in game_state.inventory
                    has_flute = "shell_flute" in game_state.inventory
                    parts.append(f"  需求: 安宁石 + 海螺笛 (玩家拥有石头: {'是' if has_stone else '否'}, 拥有笛子: {'是' if has_flute else '否'})")
                elif cw == "impression_sunrise":
                    has_pigment = "sunrise_pigment" in game_state.inventory
                    parts.append(f"  需求: 日出颜料 (玩家拥有: {'是' if has_pigment else '否'})")

        total_quests = dict(game_state.quests_completed)
        parts.append(f"**所有任务**: {total_quests}")
    else:
        parts.append(f"**Location**: {world['name']}")
        parts.append(f"**Description**: {world['description']}")

        exits = world.get("exits", [])
        if exits:
            exit_strs = [f"{ex['target'].replace('_', ' ').title()} (id: {ex['target']})" for ex in exits]
            parts.append(f"**Available Exits**: {', '.join(exit_strs)}")
        else:
            parts.append("**Available Exits**: None visible.")

        items_available = world.get("items_available", [])
        found_items = game_state.items_found
        visible_items = []
        for item_id in items_available:
            if item_id not in found_items:
                item = get_item(item_id)
                if item:
                    visible_items.append(f"{item['name']} (id: {item_id})")
        if visible_items:
            parts.append(f"**Visible Items**: {', '.join(visible_items)}")
        else:
            parts.append("**Visible Items**: None visible (already found or none here).")

        hidden = world.get("items_hidden", {})
        for hid_id, hid_data in hidden.items():
            if hid_id not in found_items:
                reveal_item = hid_data.get("reveal_item", "")
                if reveal_item in game_state.inventory:
                    item = get_item(reveal_item)
                    parts.append(f"**Hint**: The player now has the {item['name'] if item else reveal_item}, which could reveal a hidden item here.")

        if game_state.inventory:
            inv_names = [get_item(i)['name'] if get_item(i) else i for i in game_state.inventory]
            parts.append(f"**Player Inventory**: {', '.join(inv_names)}")
        else:
            parts.append("**Player Inventory**: Empty.")

        npcs = world.get("npcs", [])
        if npcs:
            for npc_id in npcs:
                npc = get_npc(npc_id)
                if npc:
                    parts.append(f"**NPC Present**: {npc['name']} — {npc.get('role', '')}")
                    parts.append(f"  Personality: {npc.get('personality', 'N/A')}")
                    quest_goal = world.get("quest_goal")
                    if quest_goal and not game_state.quests_completed.get(game_state.current_world):
                        parts.append(f"  Quest Hint: {npc.get('quest_hint', 'N/A')}")
        else:
            parts.append("**NPC Present**: None.")

        cw = game_state.current_world
        quest_goal = world.get("quest_goal")
        if quest_goal:
            done = game_state.quests_completed.get(cw, False)
            quest_desc = world.get("quest_description", "Unknown quest.")
            parts.append(f"**Quest**: {quest_desc}")
            parts.append(f"**Quest Status**: {'Completed' if done else 'In Progress'}")
            if not done:
                if cw == "starry_night":
                    has_pigment = "yellow_pigment" in game_state.inventory
                    parts.append(f"  Required: Yellow Pigment (player has it: {has_pigment})")
                elif cw == "great_wave":
                    has_stone = "calming_stone" in game_state.inventory
                    has_flute = "shell_flute" in game_state.inventory
                    parts.append(f"  Required: Calming Stone + Shell Flute (player has stone: {has_stone}, has flute: {has_flute})")
                elif cw == "impression_sunrise":
                    has_pigment = "sunrise_pigment" in game_state.inventory
                    parts.append(f"  Required: Sunrise Pigment (player has it: {has_pigment})")

        total_quests = dict(game_state.quests_completed)
        parts.append(f"**All Quests**: {total_quests}")

    return "\n".join(parts)


def parse_dm_response(raw_text):
    if not raw_text:
        return None

    try:
        result = json.loads(raw_text.strip())
        if _validate_dm_result(result):
            return result
    except (json.JSONDecodeError, ValueError):
        pass

    json_match = re.search(r'\{[\s\S]*?"intent"[\s\S]*?\}', raw_text)
    if json_match:
        try:
            result = json.loads(json_match.group())
            if _validate_dm_result(result):
                return result
        except (json.JSONDecodeError, ValueError):
            pass

    json_block = re.search(r'\{[^{}]*"intent"\s*:\s*"[^"]*"[^{}]*\}', raw_text)
    if json_block:
        try:
            result = json.loads(json_block.group())
            if _validate_dm_result(result):
                return result
        except (json.JSONDecodeError, ValueError):
            pass

    repaired = _repair_truncated_json(raw_text)
    if repaired:
        try:
            result = json.loads(repaired)
            if _validate_dm_result(result):
                logger.info(f"Repaired truncated JSON successfully.")
                return result
        except (json.JSONDecodeError, ValueError):
            pass

    logger.warning(f"Failed to parse DM response: {raw_text[:200]}...")
    return None


def _repair_truncated_json(text):
    text = text.strip()
    if not text.startswith('{') or '"intent"' not in text:
        return None

    in_string = False
    brace_depth = 0
    for i, ch in enumerate(text):
        if ch == '"' and (i == 0 or text[i-1] != '\\'):
            in_string = not in_string
        elif not in_string:
            if ch == '{':
                brace_depth += 1
            elif ch == '}':
                brace_depth -= 1

    if in_string:
        text += '"'

    while brace_depth > 0:
        text += '}'
        brace_depth -= 1

    text = re.sub(r',\s*\}$', '\n}', text)
    text = re.sub(r',\s*"[^"]*"\s*:\s*$', '\n}', text)
    text = re.sub(r',\s*"[^"]*"\s*:\s*"[^"]*$', '"\n}', text)

    return text


def _validate_dm_result(result):
    if not isinstance(result, dict):
        return False
    if "intent" not in result:
        return False
    valid_intents = {"explore", "talk", "use_item", "solve", "move", "inventory", "help"}
    if result["intent"] not in valid_intents:
        return False
    return True
