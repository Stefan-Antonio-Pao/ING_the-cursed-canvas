# The Cursed Canvas -- A Magical Art Mystery

A web-based text adventure game blending art history with fantasy, powered by real AI.

## Story

You are locked inside a magical museum at midnight. Paintings have become portals to fantasy
worlds. To escape, step into Starry Night and The Great Wave, meet Van Gogh and Hokusai,
and restore each artwork.

## Features

- **AI-generated story** (GPT-2 / distilgpt2)
- **AI-powered NPC dialogue** (DialoGPT-small)
- **Intent classifier** (TF-IDF + Logistic Regression, trained from labeled data, >=85% accuracy)
- **Sentiment-aware mood** (VADER)
- **Two playable worlds** with quests, items, and NPCs
- **Full ML pipeline**: data labeling -> training -> evaluation -> deployment

## Quick Start

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m nltk.downloader vader_lexicon
python -m ai.intent       # train classifier (~2 sec)
python app.py              # start server
```

Open **http://127.0.0.1:5000**. First run downloads AI models (~650MB, 5-15 min).

## Desktop Test Build

Desktop packaging uses Electron + PyInstaller. See [DESKTOP_PACKAGING.md](DESKTOP_PACKAGING.md)
for the Experience Proxy, desktop config, and Mac/Windows build commands.

## How to Play

| Command | Intent |
|---------|--------|
| look around, explore, examine | Explore |
| talk to van gogh, ask about stars | Talk to NPCs |
| use lantern, take flute, give pigment | Use/collect items |
| enter starry night, go to museum | Move between worlds |
| inventory, i | Check inventory |
| help, hint, what do i do | Get hints |
| solve the puzzle, restore painting | Complete quests |

## Project Structure

```
cursed-canvas/
├── app.py               # Flask application
├── engine/               # Game state, memory, world data
├── ai/                   # GPT-2, DialoGPT, intent classifier, sentiment
├── data/                 # intents.json, world_data.json
├── models/               # Saved classifier
├── static/ + templates/  # Chat UI
├── requirements.txt
└── README.md
```

## Troubleshooting

- **No classifier found**: Run `python -m ai.intent`
- **Slow first load**: Models download from HuggingFace; cached afterward
- **Out of memory**: Close other apps; models use ~1.5GB RAM
- **Repetitive text**: Vary commands; use `help` to reset context

## Credits
Daihong Luo, Xinzhi Bao -- CPS 3320 Python Programming, June 2026
