# Debug Report — The Cursed Canvas

**Date:** 2026-06-21
**Tester:** Codex automated test suite

---

## Test Methodology

1. Unit-level integration test of `GameState` and `StoryEngine` covering the complete game walkthrough (both worlds, all item interactions, quest completion)
2. Flask test client API tests: 10 endpoints covering GET `/`, POST `/api/command`, POST `/api/reset`, GET `/api/status`, game completion flow, session persistence, and reset
3. Memory serialization round-trip test (`ContextMemory.to_dict()` / `ContextMemory.from_dict()`)
4. AI model loading verification (GPT-2, DialoGPT, Intent classifier from cache)
5. Manual logic trace of all dispatch handlers, session state management, and frontend response handling

---

## Bugs Found and Fixed

### Bug 1 (CRITICAL): Flask session serialization crashes on first page load

**File:** `app.py`, routes `index()` and `reset_game()`

**Root cause:** Both routes stored `GameState().__dict__` directly in Flask's session. The raw `__dict__` contains Python `set` objects (`items_found`, `npcs_met`, `visited_worlds`), which are not JSON-serializable. Flask's `itsdangerous` session cookie serializer raises `TypeError: Object of type set is not JSON serializable` during request finalization.

**Impact:** Every fresh page load or game reset caused a 500 error. The HTML response was generated but the session cookie was never saved, making session-based state broken for the first request.

**Fix:** Both routes now call `_serialize_state(GameState())`, which converts all sets to lists before storing.

```python
# Before (broken)
session["game_state"] = GameState().__dict__

# After (fixed)
session["game_state"] = _serialize_state(GameState())
```

---

### Bug 2: World description and NPC greeting shown twice after moving

**File:** `engine/story_engine.py`, method `_move_to_world()`

**Root cause:** `_move_to_world()` set `self._first_turn = True` after returning a response that already contained the full world description and NPC greeting. On the next command, `process()` would re-trigger the `_first_turn` block and show the intro again.

**Impact:** Every time the player entered a new world (or returned to the museum), they'd see the full description and NPC greeting twice — once from the move response, and again from the next command they typed.

**Fix:** Changed `self._first_turn = True` to `self._first_turn = False` in `_move_to_world()`. The `__init__` method still initializes `_first_turn = True` for the very first game turn.

---

### Bug 3: AI dialogue memory lost between HTTP requests

**Files:** `engine/memory.py`, `app.py`

**Root cause:** `_serialize_state()` did not include the `memory` attribute, and `_restore_state()` always created a fresh `ContextMemory()`. Since Flask creates a new request context per API call, all NPC conversation history was wiped between turns.

**Impact:** The AI dialogue system (DialoGPT) received empty history on every talk interaction, producing context-free responses. Event tracking (`memory.add_event()`) was also useless since events disappeared immediately.

**Fix:** Added `to_dict()` and `from_dict()` class methods to `ContextMemory` in `memory.py`. Updated `_serialize_state()` to include `"memory": gs.memory.to_dict()` and `_restore_state()` to call `ContextMemory.from_dict(d.get("memory"))`.

---

### Bug 4: Second world's quest completion scene never shown to player

**File:** `engine/story_engine.py`, method `process()`

**Root cause:** When the second (and final) world's quest was completed, `process()` immediately overwrote the world-specific quest completion scene with the generic game-complete message. The player never saw the narrative resolution for the last world they completed.

**Impact:** If Starry Night was completed second, the player never read "You hand the yellow pigment to Van Gogh. A ray of brilliant golden light bursts forth..." — they jumped straight to "Both paintings restored. The museum's magic flows freely."

**Fix:** Instead of overwriting, the two scenes are now concatenated with a double newline separator:

```python
scene = (scene + "\n\n" + get_default("game_complete")) if scene else get_default("game_complete")
```

---

### Bug 5: `_handle_inventory()` crashes with TypeError

**File:** `engine/story_engine.py`, method `_handle_inventory()`

**Root cause:** The method was defined as `_handle_inventory(self)` — taking only `self`. But the dispatch system in `process()` calls every handler with `handler(command, world)`, passing three positional arguments (including self).

**Impact:** Any player typing "inventory", "i", "inv", or clicking the Inventory quick-action button would trigger an unhandled `TypeError` server-side, returning a 500 error.

**Fix:** Changed signature to `_handle_inventory(self, command, world)` to match the dispatch convention used by all other handlers.

---

### Bug 6: `_handle_talk()` returns `None` for the scene field

**File:** `engine/story_engine.py`, method `_handle_talk()`

**Root cause:** The method returned `return None, npc_reply, npc_name`. The frontend handled null scene gracefully (`if(data.scene)`), but it meant no context message appeared when the player talked to an NPC — only the NPC's reply was shown.

**Fix:** Now returns a context string: `return f"You talk to {npc_name}.", npc_reply, npc_name`.

---

## Bug 7 (Environment): AI model download hangs without network

**Files:** `app.py`, `ai/generator.py`, `ai/dialogue.py`

**Root cause:** The `transformers` library from HuggingFace retries 5 times with exponential backoff when `huggingface.co` is unreachable, taking roughly 2 minutes per model before giving up. In sandboxed environments without network access, this blocks the first request.

**Impact:** First API command takes ~4 minutes to respond while GPT-2 and DialoGPT time out. The game has proper `try/except` fallback that degrades gracefully (keyword-based classification instead of ML, no AI generation/dialogue).

**Fix (optional):** Set `TRANSFORMERS_OFFLINE=1` environment variable when network is unavailable, or reduce `TRANSFORMERS_VERBOSITY=error` and add a socket timeout via `HF_HUB_DOWNLOAD_TIMEOUT=5`.

---

## Test Results Summary

| Test | Result |
|------|--------|
| Game engine integration (19-command walkthrough) | ✅ Pass |
| Flask API — GET / | ✅ Pass |
| Flask API — POST /api/command (first turn) | ✅ Pass |
| Flask API — POST /api/command (move) | ✅ Pass |
| Flask API — Double-display prevention | ✅ Pass |
| Flask API — Inventory | ✅ Pass |
| Flask API — Talk to NPC | ✅ Pass |
| Flask API — Full starry_night quest | ✅ Pass |
| Flask API — Full great_wave quest + game completion | ✅ Pass |
| Flask API — Quest concatenation | ✅ Pass |
| Flask API — Reset | ✅ Pass |
| Flask API — Status endpoint | ✅ Pass |
| Flask API — Empty command / error handling | ✅ Pass |
| Session persistence across requests | ✅ Pass |
| Memory serialization round-trip | ✅ Pass |
| AI model loading (GPT-2, DialoGPT, Classifier) | ✅ Pass (from cache) |
| Intent classifier accuracy (8 test commands) | ✅ 8/8 correct |

---

## Files Modified

1. **`engine/story_engine.py`** — `_move_to_world` first_turn fix, `_handle_inventory` signature fix, `_handle_talk` scene return, quest completion concatenation
2. **`engine/memory.py`** — Added `to_dict()` / `from_dict()` for session serialization
3. **`app.py`** — Fixed session serialization in `index()` and `reset_game()`, added memory to `_serialize_state()` and `_restore_state()`

---

## Remaining Observations (Non-Blocking)

- `_handle_explore` AI generation can replace item-discovery messages — players may miss clues about available items when AI models are active. Consider appending AI output instead of replacing.
- `_handle_solve` for great_wave requires both `shell_flute` AND `calming_stone`, while `_handle_use_item` only checks `calming_stone`. In practice this is harmless since the calm_stone is gated behind the shell_flute reveal, but the inconsistency is worth noting.
- The `_classify()` fallback keyword matcher treats "enter" as a move keyword, which could conflict with explore intents in the training data (e.g. "enter the painting" is labeled "explore"). Only relevant if the ML classifier fails to load.

---

## Round 2 Findings (Live Browser Testing)

### Bug 8: Move handler doesn't recognize descriptive language

**Root cause:** `_handle_move()` only matched on the internal target ID (`starry_night`) or its underscored version (`starry night`). A player reading the world description and typing natural phrases like "go to the swirling night sky" or "swirling night sky" got "Which painting would you like to enter?"

**Impact:** Players couldn't figure out how to enter paintings. The game's own description says "a swirling night sky by Van Gogh," so players naturally referenced that language.

**Fix:** The move handler now matches on:
- Full world name (`"Starry Night"`, `"The Great Wave off Kanagawa"`)
- Significant name fragments (e.g., `"starry"` + `"night"` both present)
- A keyword alias map (`swirling` → Starry Night, `hokusai` → Great Wave, `sea` → Great Wave, etc.)
- Single-word matches are guarded (require multi-word commands to prevent accidental moves)

Also added a `cmd_words >= 2` guard so typing just `"wave"` or `"night"` doesn't accidentally trigger movement.

### Bug 9: ML classifier overrides fallback move-keyword detection

**Root cause:** `_classify()` tried the ML classifier first, and if it returned any result, immediately returned without checking the fallback keyword matcher. The classifier labeled `"enter the swirling night sky"` as `explore` and `"go to hokusai"` as `talk`.

**Fix:** Moved the move-keyword check *before* the ML classifier, and added world-specific keywords (`starry`, `night`, `swirling`, `wave`, `kanagawa`, `hokusai`, etc.) as move intent triggers even without an explicit move verb.

### Bug 10: AI-generated explore output replaces all item clues

**Root cause:** `_handle_explore` replaced the entire scripted scene (item discoveries, exit descriptions, hidden item reveals) with raw AI output when the generator was available. The small distilgpt2 model frequently produced irrelevant or nonsensical text.

**Fix:** AI output is now appended after the scripted scene rather than replacing it. Players always see item clues and exits, with AI flavor text as optional enrichment.

---

## Files Modified (Cumulative)

| File | Changes |
|------|---------|
| `engine/story_engine.py` | `_first_turn` fix, `_handle_inventory` signature, `_handle_talk` scene, quest concatenation, `_handle_move` keyword matching, `_handle_explore` AI append |
| `engine/memory.py` | `to_dict()` / `from_dict()` for session serialization |
| `app.py` | Session serialization fix, lazy model loading + background warmup, `_classify` move-keyword override, per-model status endpoint |
| `static/game.js` | Adaptive polling, model-ready notifications, dynamic loading overlay |
| `DEBUG_REPORT.md` | This report |
