# 2026-07-03 Main Menu Exit Button

## Research
- Confirmed the requested main screen is `#start-menu`, where the title is followed by the four `.start-btn` buttons.
- Confirmed the previous change incorrectly touched the in-game `#side-panel` Session card and end-game dialog copy.
- Confirmed the Electron preload bridge already exists for desktop-only features.

## Plan
- Revert the mistaken side-panel/end-game wording change from the previous attempt.
- Add an `Exit Game` / `退出游戏` button below the four existing main-menu buttons.
- Use Electron IPC to quit the packaged desktop app, with a browser fallback message when `window.close()` is blocked.

## Implementation
- Added `#exit-game-menu-btn` under the existing main-menu Settings button.
- Added `start.exit_game` and browser-fallback text to English and Simplified Chinese UI dictionaries.
- Added `exitGameFromMainMenu()` and a click handler in `static/game.js`.
- Exposed `quitApp()` through the Electron preload bridge and handled it in Electron main.
- Restored the in-game Session button and end-game dialog wording to the prior `End Game` / `结束游戏` flow.

## Check
- `node --check static/game.js` passed.
- `node --check desktop/electron/main.js` passed.
- `node --check desktop/electron/preload.js` passed.
- `node -e` JSON parsing for `i18n/en/ui.json` and `i18n/zh/ui.json` passed.
- `git diff --check -- templates/index.html static/game.js static/style.css i18n/en/ui.json i18n/zh/ui.json desktop/electron/main.js desktop/electron/preload.js logs/2026-07-03-main-menu-exit-button.md logs/2026-07-03-exit-game-button.md` passed.

## Result
- The startup main menu now has a dedicated exit button below the original four buttons.
