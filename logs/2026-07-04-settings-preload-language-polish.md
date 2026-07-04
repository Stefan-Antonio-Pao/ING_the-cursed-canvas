# Settings Scroll, Language Display, and Preload Polish

Date: 2026-07-04

## Research

- Reviewed the settings tab/card layout in `templates/index.html` and `static/style.css`.
- Reviewed settings card height synchronization, language display rendering, language cycling, startup language initialization, and preload timing in `static/game.js`.
- Confirmed settings card scrolling is applied through `.settings-card.settings-card-scroll-limited`.
- Confirmed the language value could be rendered from the active i18n bundle instead of the selected language value, and server/settings data could briefly disagree with the local UI language.
- Confirmed the preload overlay minimum visible time was controlled by `PRELOAD_MIN_VISIBLE_MS`.

## Plan

- Add extra bottom breathing room only when the settings card is actually scroll-limited.
- Resolve the displayed language from the active UI/local setting/server setting, then render it with a stable language-label map.
- Use the same resolved language value when cycling the language stepper.
- Increase the preload overlay minimum visible time slightly.

## Implementation

- Added scroll-only bottom padding for `.settings-card.settings-card-scroll-limited`.
- Increased `PRELOAD_MIN_VISIBLE_MS` from `2600` to `3400`.
- Added `getSettingsLanguageCurrent()` to normalize the settings language value across active i18n, local storage, and server settings data.
- Updated `setLanguageDisplay()` to show `English` or `简体中文` from `LANG_LABELS` for the selected language instead of the current i18n bundle label.
- Updated language previous/next controls to cycle from the normalized language value.
- Updated static asset cache keys so the changed JS and CSS are fetched immediately.

## Check

- `node --check static/game.js` passed.
- `./venv/bin/python -m json.tool i18n/en/ui.json` passed.
- `./venv/bin/python -m json.tool i18n/zh/ui.json` passed.
- `./venv/bin/python -m py_compile app.py` passed.
- `git diff --check` passed.
