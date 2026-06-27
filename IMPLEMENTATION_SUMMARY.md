# The Cursed Canvas - Implementation Summary

## Project Overview
A text-based adventure game where players explore famous paintings (Starry Night by Van Gogh and The Great Wave by Hokusai) to restore them and escape a magical museum.

## Core Features Implemented

### 1. Three-Tier Command Processing System
- **Tier 1**: DeepSeek API (primary) - AI-powered narrative generation
- **Tier 2**: Keyword-based fallback - Rule-based intent classification
- **Tier 3**: ML classifier fallback - Trained model for edge cases

### 2. Input Convention
- **Actions**: Wrapped in parentheses `(look around)`, `(take lantern)`
- **Dialogue**: Plain text `Where is the lantern?`, `Tell me about the curse`
- System automatically routes to appropriate handlers

### 3. World Navigation
- Three worlds: Museum (hub), Starry Night, Great Wave
- Smooth transitions with fade animations
- NPC cards appear/disappear with smooth transitions
- Quest status and inventory persist across world changes

### 4. Quest System
**Starry Night Quest:**
1. Find lantern (explore)
2. Use lantern to reveal yellow pigment (explore)
3. Take yellow pigment (use_item)
4. Give pigment to Van Gogh (use_item) → Quest Complete

**Great Wave Quest:**
1. Find shell flute (explore)
2. Play flute to reveal calming stone (use_item)
3. Take calming stone (use_item)
4. Use shell flute with Hokusai (use_item) → Quest Complete

### 5. Ending System
- Game completes when both quests are done
- "View Your Story" button appears in sidebar
- Ending page shows:
  - Narrative summary of the adventure
  - Complete chat log
  - Download options (Markdown or PNG image)
  - Return to game option

## Technical Architecture

### Backend (Flask + Python)
```
app.py              - Main Flask application, routing, command processing
engine/
  story_engine.py   - Game state management, quest logic
  world_data.py     - World/NPC/item data loading
  memory.py         - Conversation history tracking
ai/
  dm_prompt.py      - AI prompt engineering
  llm.py           - DeepSeek API + local model integration
  intent.py        - ML classifier for intent detection
  sentiment.py     - Sentiment analysis
```

### Frontend (Vanilla JS + CSS)
```
templates/
  index.html       - Main game interface
  ending.html      - Story summary page
static/
  game.js         - Game logic, UI updates, transitions
  style.css       - Dark theme with world-specific color schemes
```

### Data Structure
```json
{
  "worlds": {
    "museum": {...},
    "starry_night": {...},
    "great_wave": {...}
  },
  "npcs": {
    "van_gogh": {...},
    "hokusai": {...}
  },
  "items": {
    "lantern": {...},
    "yellow_pigment": {...},
    "shell_flute": {...},
    "calming_stone": {...}
  }
}
```

## Key Features

### 1. Intelligent Intent Detection
- Parentheses convention for explicit actions
- Context-aware dialogue routing (NPC present = dialogue mode)
- Move validation prevents invalid world transitions
- Quest completion detection via keyword matching

### 2. Dynamic NPC System
- NPCs only appear in their designated worlds
- Smooth fade transitions when entering/leaving worlds
- Conversation history tracked per NPC
- AI-generated dialogue with fallback to scripted responses

### 3. Inventory & Quest Tracking
- Real-time sidebar updates
- Quest checkmarks appear when completed
- Inventory persists across world changes
- Items can be used in specific contexts

### 4. Ending & Story Generation
- Automatic story compilation from game events
- Chat log export (Markdown or PNG)
- Beautiful ending page with game credits
- Option to return and continue exploring

### 5. Visual Polish
- World-specific color themes (Museum: warm, Starry Night: blue/gold, Great Wave: teal)
- Smooth transitions between worlds
- NPC card animations
- Responsive design

## Testing Results

All 18 comprehensive tests passed:
- ✅ Game initialization
- ✅ World navigation (enter/exit paintings)
- ✅ NPC interactions
- ✅ Item acquisition and usage
- ✅ Quest completion logic
- ✅ State persistence
- ✅ Ending page functionality
- ✅ Story generation
- ✅ Return from ending

## Files Modified During Final Fixes

1. **static/game.js**
   - Added NPC card fade transitions
   - Improved world transition logic

2. **engine/story_engine.py**
   - Fixed Great Wave quest completion (requires using shell_flute)
   - Expanded quest completion keywords

3. **ai/dm_prompt.py**
   - Added NPC location consistency rules
   - Added anti-repetition guidelines
   - Strengthened exit validation

4. **templates/ending.html**
   - Replaced broken SVG with html2canvas
   - Redesigned download UI with dropdowns
   - Improved styling consistency

## Known Limitations

1. **Token Limits**: Very long conversations may hit API token limits (mitigated by JSON repair)
2. **Image Quality**: html2canvas may not perfectly render all CSS (but provides reliable PNG output)
3. **DM Variability**: AI responses can vary, but keyword detection is robust

## Future Enhancements (Optional)

1. Conversation summarization to reduce token usage
2. Streaming responses for better UX
3. Save/load game functionality
4. Achievement system
5. Multiple difficulty levels
6. Additional paintings/worlds

## Deployment

```bash
cd projects/cursed-canvas
source venv/bin/activate
python app.py
# Open http://localhost:5000
```

## Credits

**Developers**: Daihong Luo & Xinzhi Bao  
**Course**: CPS 3320 - Python Programming  
**Date**: June 2026  
**Technologies**: Flask, DeepSeek API, Vanilla JS, html2canvas

---

**Status**: ✅ All features implemented and tested  
**Last Updated**: 2026-06-22
