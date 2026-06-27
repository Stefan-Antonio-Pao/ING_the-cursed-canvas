# Refactor Plan — Unified Phi-3-mini Dialogue Engine

**Motivation:** The current dual-model setup (distilgpt2 82M + DialoGPT-small 117M) produces repetitive, context-blind responses. The static topic matcher answers every "where" question identically. Three rounds of patching haven't fixed the root problem. Time to upgrade the core.

---

## Architecture: Before → After

```
BEFORE (current)                           AFTER (refactored)
═══════════════                            ══════════════════

distilgpt2 (82M) ──→ explore narration     ┐
DialoGPT-sm (117M) ─→ NPC dialogue         ├── Phi-3-mini (3.8B) ──→ All generation
Static topic matcher ─→ talk fallback      │   ┌── generate_dialogue()
ML intent classifier ─→ routing            ┘   ├── generate_scene()
                                               └── (single model, two prompt formats)
```

---

## Files Changed

### New: `ai/llm.py` — Single GameLLM class

```python
class GameLLM:
    def __init__(self, model_name="microsoft/Phi-3-mini-4k-instruct"):
        # 4-bit quantized, ~2.5 GB RAM on CPU
        # Single tokenizer, single model

    def generate_dialogue(self, system_prompt, npc_name, history, player_text):
        # Instruction format for NPC conversation
        # Returns (response_text, success_flag)

    def generate_scene(self, world_name, world_description, player_action):
        # Instruction format for exploration narration
        # Returns scene_description
```

**Timeouts & fallback:**
- 10-second generation timeout
- One retry on timeout, then returns `(None, False)` → caller falls back to static matcher
- Quality gate: rejects <15 chars, player-echo, gibberish patterns

### Remove: `ai/generator.py`, `ai/dialogue.py`

Both replaced by `ai/llm.py`.

### Rewrite: `app.py` (model loading section)

```
BEFORE:                              AFTER:
_generator = None                     _llm = None
_dialogue = None       ──→           _llm_ready = False
_classifier = None                    _llm_loading = False
_gen_ready = False                    _classifier = None (unchanged)
_dia_ready = False
```

Lazy loading: LLM warms up in background thread (same pattern as before), classifier loads at import time.

### Update: `engine/story_engine.py`

**`_handle_talk`** — priority chain:
1. Try `llm.generate_dialogue(system, npc, history, command)` with timeout
2. If success → return AI response
3. If timeout/failure → static matcher (greeting → question_topics → talk_topics → idle_lines)

**`_handle_explore`** — priority chain:
1. Build scripted parts (items, exits, clues) — always shown
2. Try `llm.generate_scene(world, description, command)` with timeout
3. If success → append AI scene after scripted parts
4. If timeout/failure → just show scripted parts

**`process`** — simplified:
- `ai_generator` and `ai_dialogue` params merge into single `ai_llm`
- Dispatch adjusted accordingly

### Rewrite: `data/world_data.json` (NPC system prompts)

Van Gogh example:

```json
"van_gogh": {
    "name": "Vincent van Gogh",
    "system_prompt": "You are Vincent van Gogh, the Painter-Wizard of Light. You speak with passionate, poetic urgency about color and light. Your language is vivid and emotional.\n\nWORLD KNOWLEDGE:\n- You are trapped inside your painting, Starry Night.\n- A shadowy curse has stolen the yellow pigment from your stars.\n- The enchanted lantern is hidden in the swirling sky — the player must explore to find it.\n- Once they have the lantern, its light will reveal the stolen yellow pigment behind the cypress tree.\n- The player must return the pigment to you to restore the painting.\n\nBEHAVIOR:\n- Answer the player's questions directly and helpfully.\n- If they ask about the lantern, tell them it's hidden somewhere in the swirling sky — they should look around.\n- If they ask about the pigment, tell them the lantern's light will reveal it behind the cypress.\n- If they ask how to help, guide them step by step: lantern → pigment → return.\n- Never say you don't know something that's in your world knowledge.\n- Stay in character as a passionate, poetic artist."
}
```

Same structure for Hokusai with wave/flute/stone knowledge.

### Update: `requirements.txt`

```diff
- transformers==4.48.0
+ transformers>=4.44.0
+ accelerate>=0.30.0
+ bitsandbytes>=0.43.0
  torch==2.5.1
  scikit-learn==1.6.0
  nltk==3.9.1
  pandas==2.2.3
  numpy==2.2.0
```

### Update: `templates/index.html`

Loading overlay text updated: "Warming up Phi-3-mini..." instead of separate GPT-2/DialoGPT messages.

---

## Implementation Order

| # | Task | File(s) | Est. |
|---|------|---------|------|
| 1 | Write `ai/llm.py` — `GameLLM` class with 4-bit quant, prompt templates, timeout | New | 80 lines |
| 2 | Rewrite `app.py` model section — single LLM, combined status endpoint | `app.py` | ~30 lines changed |
| 3 | Rewrite `_handle_talk` and `_handle_explore` in story_engine | `engine/story_engine.py` | ~40 lines changed |
| 4 | Rewrite NPC system prompts in world_data.json | `data/world_data.json` | ~60 lines |
| 5 | Update `requirements.txt` | `requirements.txt` | 3 lines |
| 6 | Update loading overlay text in `index.html` and `game.js` | Templates + static | 5 lines |
| 7 | Remove `ai/generator.py` and `ai/dialogue.py` | Delete files | — |
| 8 | End-to-end test: full two-world walkthrough with AI dialogue | Integration test | — |

---

## Expected Outcomes

| Before | After |
|--------|-------|
| "Where is the lantern?" → pigment answer (wrong) | → "Search the swirling sky, traveler. The lantern's starlight glimmers near the cypress." |
| Same answer repeated 3 times | → Context-aware follow-up with new information |
| Two models, 600MB total, slow first load | → One model, 2.2GB, ~3-5 min first download |
| Static topics needed for gameplay | → Static topics only as emergency fallback (rarely reached) |
| AI output replaces item clues | → Scripted clues always shown; AI appends flavor |

---

## Risk: Model Size

Phi-3-mini with 4-bit quantization uses ~2.5 GB RAM. On a machine with 8 GB RAM this leaves plenty of headroom. On 4 GB it'll be tight but functional. If the target machine is severely constrained, fall back to `Qwen/Qwen2.5-1.5B-Instruct` (~1 GB with 4-bit quant) — still dramatically better than DialoGPT-small.
