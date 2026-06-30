# The Cursed Canvas -- A Magical Art Mystery

[English](./README.md) | [简体中文](./README.zh-CN.md)

A web-based text adventure game blending art history with fantasy, powered by real AI.

## Story

You are locked inside a magical museum at midnight. The paintings have come alive, and their
worlds are unraveling. To escape, step into Starry Night, The Great Wave, and Impression,
Sunrise -- meet Van Gogh, Hokusai, and Monet -- and restore the colors, sounds, and memories
each artwork has lost.

## Features

- **LLM-driven story and NPC dialogue** -- online via DeepSeek API, or offline via Phi-3-mini
  (transformers). An optional Experience Proxy grants trial tokens so new players can try the
  online mode without their own API key.
- **Intent classifier** (TF-IDF + Logistic Regression, trained from labeled data, >=85% accuracy,
  EN/ZH)
- **Sentiment-aware mood** -- VADER for English, SnowNLP for Chinese, each with a keyword
  fallback when the library or model is unavailable.
- **Three playable worlds** with quests, items, and NPCs
- **Bilingual UI (EN/ZH)** -- JSON resource files, in-game language switch, and a client-side
  `t()` function covering every screen.
- **Cinematic title screen** with particle effects, a bridge transition into the main menu, and
  staggered button reveals.
- **Beginner tutorial** -- an onboarding flow before the prologue (first playthrough only by
  default) plus an in-game tutorial dialog reachable from the Help quick action.
- **Save slots** -- multiple slots with browser-side migration, unsaved-progress warnings, and
  story recap.
- **Desktop build** (Electron + PyInstaller) for macOS and Windows.
- **Full ML pipeline**: data labeling -> training -> evaluation -> deployment

## Quick Start

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m ai.intent en    # train English classifier (~2 sec)
python -m ai.intent zh    # train Chinese classifier (~2 sec)
python app.py             # start server
```

Open **http://127.0.0.1:5000**. The local Phi-3-mini model downloads from HuggingFace on first
use (~650MB, 5-15 min) and is cached afterward; the DeepSeek API mode needs no download.

## Desktop Build

Desktop packaging uses Electron + PyInstaller. See [DESKTOP_PACKAGING.md](DESKTOP_PACKAGING.md)
for the Experience Proxy, desktop config, and Mac/Windows build commands.

### macOS: remove the quarantine attribute after install

Apple applies a quarantine flag to unsigned downloads, which blocks the app from launching with
an "Apple cannot check it for malicious software" or "damaged" error. After dragging **The Cursed
Canvas** into `/Applications`, run this in Terminal:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/The Cursed Canvas.app"
```

Enter your macOS password when prompted. The app will then open normally. This only needs to be
done once per install.

## How to Play

Actions are wrapped in parentheses; dialogue is typed directly. Use the quick-action buttons
under the input box for common moves (they update per location), or press **Help** to reopen
the tutorial at any time.

| Command | Intent |
|---------|--------|
| (look around), (examine painting) | Explore |
| talk to van gogh, where is the pigment? | Talk to NPCs |
| (take lantern), (use pigment), (give flute) | Use/collect items |
| (enter starry night), (return to museum) | Move between worlds |
| (inventory), (i) | Check inventory |
| (help), (hint) | Get hints / open tutorial |
| (restore painting), (solve puzzle) | Complete quests |

Chinese equivalents work the same way, e.g. `（四处看看）`, `（拿起灯笼）`, `（进入星月夜）`.

## Project Structure

```
cursed-canvas/
├── app.py                # Flask application
├── engine/               # Game state, memory, world data
├── ai/                   # LLM (Phi-3-mini / DeepSeek), intent classifier, sentiment
├── i18n/                 # EN/ZH keywords, prompts, world data, UI strings
├── data/                 # intents.json, world_data.json
├── models/               # Trained EN/ZH classifier + vectorizer
├── experience_proxy/     # Optional DeepSeek-compatible trial-token proxy
├── desktop/              # Electron main process, config, assets
├── static/ + templates/  # Chat UI, title screen, tutorial
├── tests/                # World sequence and ZH term/state tests
├── requirements.txt
└── README.md
```

## Troubleshooting

- **No classifier found**: Run `python -m ai.intent en` and `python -m ai.intent zh`.
- **Chinese sentiment falls back to keywords**: Install `snownlp` (`pip install snownlp`); the
  game keeps working without it, just less nuanced.
- **macOS app won't open ("damaged" / "cannot be checked")**: Run the `xattr` command in the
  Desktop Build section above.
- **Slow first load**: The local Phi-3-mini model downloads from HuggingFace and is cached
  afterward; switch to the DeepSeek API mode in Settings for instant responses.
- **Out of memory**: Close other apps; the local model uses ~1.5GB RAM.
- **Repetitive text**: Vary commands; use `help` to reset context.

## Credits
Daihong Luo, Xinzhi Bao -- CPS 3320 Python Programming, June 2026
