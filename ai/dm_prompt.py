"""Dungeon Master prompt engineering for The Cursed Canvas.

Builds structured prompts that let the LLM act as a DM: understanding player
free-text, deciding intent, and generating the full narrative response in one pass.
"""

import json
import logging
import re

from engine.world_data import get_world, get_npc, get_item, load_world_data

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# DM system prompt
# ---------------------------------------------------------------------------

DM_SYSTEM_PROMPT = """You are the Dungeon Master (DM) for "The Cursed Canvas", a text-adventure game set inside famous paintings in a magical museum at midnight.

Your job is to:
1. Understand the player's free-text command.
2. Determine the player's intent.
3. Generate a vivid, atmospheric narrative response.

## Valid Intents (choose exactly one)
- "explore"  — The player looks around, observes, or investigates the current location.
- "talk"     — The player speaks to, asks a question of, or addresses an NPC in any way.
- "use_item" — The player picks up, uses, or interacts with an item.
- "solve"    — The player tries to solve the current world's quest.
- "move"     — The player wants to go to a different location (enter a painting, return to museum).
- "inventory" — The player checks what they are carrying.
- "help"     — The player asks for hints, help, or game instructions.

## Player Input Convention
The game client uses a parentheses convention to distinguish actions from dialogue:
- Text in parentheses like "(look around)" or "(take lantern)" is a GAME ACTION.
- Plain text without parentheses like "Where is the lantern?" is DIALOGUE directed at the current NPC.

The game engine may tell you the player's input type:
- If told "This is DIALOGUE": you MUST use intent "talk".
- If told "This is an ACTION": use normal intent detection below, but NEVER classify as "talk".

## Intent Detection (for actions)
When detecting intent for an action command:
1. Item verbs (pick up, take, grab, use, examine, inspect, look at, collect) -> "use_item"
2. Explore verbs (look around, explore, search, investigate, observe) -> "explore"
3. Move verbs (go to, enter, step into, leave, return to) -> "move"
4. Solve verbs (solve, restore, fix, calm, soothe) -> "solve"
5. Talk verbs (talk to, speak to, ask, greet) or addressing NPC by name -> "talk"

## CRITICAL: "move" means LEAVING the current world
- "move" intent is ONLY for traveling between worlds (e.g., leaving Starry Night to go to the museum, or entering a painting from the museum).
- Movement WITHIN the current world is ALWAYS "explore". Examples:
  - "go back to where Van Gogh is standing" = explore (still in Starry Night)
  - "walk to the cottage" = explore (still in Starry Night)
  - "go back to the shore" = explore (still in Great Wave)
  - "approach the wave" = explore (still in Great Wave)
  - "return to the village" = explore (still in current world, village is not a separate world)
- Only use "move" when the player explicitly wants to enter/leave a PAINTING or the MUSEUM:
  - "enter starry night" = move
  - "go back to museum" = move
  - "return to the museum" = move
  - "leave this painting" = move

## CRITICAL: Ambiguous or Short Commands
- Single words like "back", "forward", "left", "right", "up", "down" are AMBIGUOUS and should NOT be interpreted as move commands — use "explore".
- "back" alone = explore
- "go back" = explore (the player might be returning to an NPC or previous spot within the world)
- "go back to museum" = move (explicit world-level destination)

If intent is "talk" and an NPC is present, you MUST:
1. Set "scene" to ONE short sentence like "You turn to Vincent van Gogh." or "You speak with the painter."
2. Set "npc_reply" to the NPC's ACTUAL in-character spoken dialogue (this is the most important field).
3. Set "npc_name" to the NPC's EXACT full name as provided in the world data. IMPORTANT: The NPC names include "Katsushika Hokusai" (NOT "HokusAI", NOT "KokusAI") and "Claude Monet". Always spell them correctly.
4. NEVER put the NPC's dialogue inside "scene". The dialogue ALWAYS goes in "npc_reply".

## CRITICAL: NPC Location Consistency
- NPCs ONLY exist in their designated worlds. Van Gogh is ONLY in Starry Night. Hokusai is ONLY in The Great Wave. Monet is ONLY in Impression, Sunrise.
- NEVER mention or describe an NPC being in a world where they don't belong.
- If the player is in the museum, there are NO NPCs present. Do not generate NPC dialogue or mention NPCs being in the museum.
- Only generate npc_reply and npc_name when the player is in a world that has an NPC.

## CRITICAL: NPC Dialogue Consistency
- When the player asks the SAME question in different words (e.g. "Where is the lantern?" vs "Where can I find the lantern?"), give the SAME core information every time.
- Always check the conversation history. If you already answered a question, your new answer must be consistent with what you said before.
- For questions about items (lantern, pigment, flute, stone, lens, sunrise pigment), always give specific, actionable guidance based on your WORLD KNOWLEDGE.
- Never say "I don't know" about something that is in your world knowledge.
- NEVER repeat the same dialogue or description verbatim. Always vary your wording while keeping the core information consistent.

## CRITICAL: NPC Agency and Quest Ownership
- The player is the only actor who can perform player actions (take, use, give, play, blow, solve, restore).
- NPCs can speak, advise, observe, or react. NPCs must NOT perform the player's quest actions for the player.
- Never narrate that an NPC restores the painting alone, uses quest items on behalf of the player, or directly completes the objective unless the player's action explicitly does it.
- For The Great Wave: if the player has both the shell flute and calming stone, the completion action is triggered by the player's use/play action. Hokusai may guide and acknowledge, but must not replace the player.
- For Starry Night: Van Gogh may receive pigment and respond, but the scene must make clear the player returned the pigment.
- For Impression, Sunrise: Monet may guide and acknowledge, but the player must use/return the sunrise pigment to restore the orange light.

## CRITICAL: Move Targets Must Be Valid Exits
- For "move" intent, the move_target MUST be one of the available exits listed in the world data.
- NEVER suggest destinations that are not valid exits (e.g. "village", "forest", "shore" are NOT valid unless listed as exits).
- If the player tries to go somewhere that is not a valid exit, set intent to "explore" instead and describe what they see in that direction.

## Rules
- Stay faithful to the game world data provided. Do NOT invent items, NPCs, or locations that don't exist.
- NEVER mention doors, exits, gates, or paths that are not listed in the "Available Exits" section. Do not describe "doors with EXIT signs" or "emergency exits" or any other exits.
- When describing the scene, only reference the exits that are actually available (e.g., "Step back through the painting frame" or "Step into the Starry Night painting").
- For "use_item", only allow items that exist in the world or the player's inventory.
- For "solve", only succeed if the player has the required items in their inventory.
- Keep responses vivid, atmospheric, and in second person ("you see...", "you hear...").
- NPC dialogue should reflect their personality and the provided system prompt.
- Do not break the fourth wall or mention game mechanics unless the player asks "help".
- NEVER repeat the same NPC dialogue twice. Check the conversation history and give a fresh, different reply each time.
- Vary your descriptions and avoid repetitive phrases. Each response should feel unique while staying true to the world.

## How to fill scene vs npc_reply
- For "talk" intent: scene = SHORT narration (1 sentence). npc_reply = NPC's spoken dialogue. npc_name = NPC's full name.
- For "explore" intent: scene = full atmospheric description. npc_reply = null. npc_name = null.
- For "move" intent: scene = travel/arrival description. npc_reply = NPC greeting if present, else null.
- For all other intents: scene = result narration. npc_reply = null unless an NPC comments.

## Output Format
Respond with ONLY a JSON object (no markdown, no explanation, no extra text):
{
  "intent": "<one of: explore, talk, use_item, solve, move, inventory, help>",
  "scene": "<short narration for talk, full description for explore>",
  "npc_reply": "<NPC spoken dialogue for talk intent, or null>",
  "npc_name": "<full NPC name when npc_reply is set, or null>",
  "mood": "<one of: neutral, tense, hopeful, melancholy, joyful>",
  "move_target": "<world_id to move to, only for move intent, otherwise null>"
}

IMPORTANT: Keep npc_reply to 2-3 sentences maximum. Be concise but atmospheric.
"""


# ---------------------------------------------------------------------------
# Build prompt messages
# ---------------------------------------------------------------------------

def build_dm_prompt(command, game_state, memory, force_talk=False, force_no_talk=False):
    """Build the message list for the DM LLM call.

    Args:
        command: Raw player text (already stripped of parentheses).
        game_state: A GameState instance (from engine.story_engine).
        memory: A ContextMemory instance.
        force_talk: If True, hint to the DM that this is dialogue.
        force_no_talk: If True, hint to the DM that this is an action.

    Returns:
        List of {"role": ..., "content": ...} message dicts.
    """
    world = get_world(game_state.current_world)
    if not world:
        # Safety fallback
        return [
            {"role": "system", "content": DM_SYSTEM_PROMPT},
            {"role": "user", "content": f'Player says: "{command}"'}
        ]

    # Build world context
    world_ctx = _build_world_context(world, game_state)

    # Build memory context
    mem_ctx = memory.context_summary() if memory else "(No history yet.)"
    recent_events = memory.recent_events_string(6) if memory else "(Nothing yet.)"

    # Build NPC conversation history for the current world
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

    # Input type hint based on parentheses convention
    input_type_hint = ""
    if force_talk:
        input_type_hint = "\n**This is DIALOGUE** — the player is speaking to the NPC. Use intent \"talk\".\n"
    elif force_no_talk:
        input_type_hint = "\n**This is an ACTION** (player used parentheses). Do NOT classify as \"talk\".\n"

    user_content = (
        f"## Current Game State\n"
        f"{world_ctx}\n\n"
        f"## Player Status\n"
        f"{mem_ctx}\n\n"
        f"## Recent Events\n"
        f"{recent_events}\n"
        f"{npc_history_ctx}\n"
        f"## Player Command\n"
        f'"{command}"\n'
        f"{input_type_hint}\n"
        f"Respond with the JSON object as instructed."
    )

    return [
        {"role": "system", "content": DM_SYSTEM_PROMPT},
        {"role": "user", "content": user_content}
    ]


def _build_world_context(world, game_state):
    """Build a text summary of the current world for the DM prompt."""
    parts = []
    parts.append(f"**Location**: {world['name']}")
    parts.append(f"**Description**: {world['description']}")

    # Exits
    exits = world.get("exits", [])
    if exits:
        exit_strs = [f"{ex['target'].replace('_', ' ').title()} (id: {ex['target']})" for ex in exits]
        parts.append(f"**Available Exits**: {', '.join(exit_strs)}")
    else:
        parts.append("**Available Exits**: None visible.")

    # Items available in the world
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

    # Hidden items (hint for DM to know when to reveal)
    hidden = world.get("items_hidden", {})
    for hid_id, hid_data in hidden.items():
        if hid_id not in found_items:
            reveal_item = hid_data.get("reveal_item", "")
            if reveal_item in game_state.inventory:
                parts.append(f"**Hint**: The player now has the {get_item(reveal_item)['name'] if get_item(reveal_item) else reveal_item}, which could reveal a hidden item here.")

    # Inventory
    if game_state.inventory:
        inv_names = [get_item(i)['name'] if get_item(i) else i for i in game_state.inventory]
        parts.append(f"**Player Inventory**: {', '.join(inv_names)}")
    else:
        parts.append("**Player Inventory**: Empty.")

    # NPCs
    npcs = world.get("npcs", [])
    if npcs:
        for npc_id in npcs:
            npc = get_npc(npc_id)
            if npc:
                parts.append(f"**NPC Present**: {npc['name']} — {npc.get('role', '')}")
                parts.append(f"  Personality: {npc.get('personality', 'N/A')}")
                # Include quest hint if quest not done
                quest_goal = world.get("quest_goal")
                if quest_goal and not game_state.quests_completed.get(game_state.current_world):
                    parts.append(f"  Quest Hint: {npc.get('quest_hint', 'N/A')}")
    else:
        parts.append("**NPC Present**: None.")

    # Quest status
    cw = game_state.current_world
    quest_goal = world.get("quest_goal")
    if quest_goal:
        done = game_state.quests_completed.get(cw, False)
        quest_desc = world.get("quest_description", "Unknown quest.")
        parts.append(f"**Quest**: {quest_desc}")
        parts.append(f"**Quest Status**: {'Completed' if done else 'In Progress'}")
        if not done:
            # Tell the DM what items are needed
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

    # Overall quest progress
    total_quests = dict(game_state.quests_completed)
    parts.append(f"**All Quests**: {total_quests}")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Parse DM response
# ---------------------------------------------------------------------------

def parse_dm_response(raw_text):
    """Extract structured JSON from the LLM's DM response.

    Tries multiple strategies:
    1. Direct json.loads on the raw text.
    2. Find a JSON block inside the text (regex).
    3. Repair truncated JSON by closing open strings/braces.
    4. Return None on failure (caller falls back to keyword rules).

    Returns:
        Parsed dict with keys (intent, scene, npc_reply, npc_name, mood, move_target)
        or None if parsing fails.
    """
    if not raw_text:
        return None

    # Strategy 1: Direct parse
    try:
        result = json.loads(raw_text.strip())
        if _validate_dm_result(result):
            return result
    except (json.JSONDecodeError, ValueError):
        pass

    # Strategy 2: Find JSON block in text
    json_match = re.search(r'\{[\s\S]*?"intent"[\s\S]*?\}', raw_text)
    if json_match:
        try:
            result = json.loads(json_match.group())
            if _validate_dm_result(result):
                return result
        except (json.JSONDecodeError, ValueError):
            pass

    # Strategy 3: Try to find JSON with more permissive matching
    json_block = re.search(r'\{[^{}]*"intent"\s*:\s*"[^"]*"[^{}]*\}', raw_text)
    if json_block:
        try:
            result = json.loads(json_block.group())
            if _validate_dm_result(result):
                return result
        except (json.JSONDecodeError, ValueError):
            pass

    # Strategy 4: Repair truncated JSON
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
    """Attempt to repair JSON that was truncated mid-string by _trim().

    If the text starts with '{' and has an 'intent' field, try to close
    any open string value and add missing closing braces.
    """
    text = text.strip()
    if not text.startswith('{') or '"intent"' not in text:
        return None

    # Count unmatched braces and quotes
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

    # If we're inside an unclosed string, close it
    if in_string:
        text += '"'

    # Close any unclosed braces
    while brace_depth > 0:
        text += '}'
        brace_depth -= 1

    # If the last value was being written (trailing comma or key without value),
    # remove it and close properly
    # Remove trailing commas before closing brace
    text = re.sub(r',\s*\}$', '\n}', text)
    # Remove incomplete key-value pairs at the end
    text = re.sub(r',\s*"[^"]*"\s*:\s*$', '\n}', text)
    text = re.sub(r',\s*"[^"]*"\s*:\s*"[^"]*$', '"\n}', text)

    return text


def _validate_dm_result(result):
    """Check that the parsed result has the minimum required fields."""
    if not isinstance(result, dict):
        return False
    if "intent" not in result:
        return False
    valid_intents = {"explore", "talk", "use_item", "solve", "move", "inventory", "help"}
    if result["intent"] not in valid_intents:
        return False
    return True
