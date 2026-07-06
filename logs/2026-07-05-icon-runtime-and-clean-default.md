# Icon Runtime Scope and Clean Default

Date: 2026-07-05

## Research

- Reviewed the frontend icon picker in `static/game.js`.
- Reviewed the Electron bridge in `desktop/electron/preload.js` and icon application in `desktop/electron/main.js`.
- Confirmed the packaged desktop icons are sourced from `desktop/assets/icon.icns` and `desktop/assets/icon.ico`.
- Confirmed the installed `.app` / `.exe` icon should remain the packaged Clean icon because runtime patching would break signing or rely on OS icon caches.
- Confirmed the Windows taskbar is most reliably affected when the Electron window is created with a native `.ico`, so selected icons need to be persisted before the next launch.
- Found existing uncommitted settings scroll/preload changes and kept this pass scoped around them.

## Plan

- Make Clean the default runtime icon.
- Regenerate packaged desktop icon assets from the Clean PNG.
- Include `desktop/assets` in the packaged app so the startup window can use the native icon path.
- Generate native per-icon desktop assets for every selectable icon.
- Persist the selected icon id in Electron `userData` so it can be applied before the next desktop window is created.
- Clarify runtime icon-switching scope in English and Simplified Chinese.
- Remove `Version` / `版本` from Concept and Clean names everywhere they appear in project copy.

## Implementation

- Changed the default game icon to `clean`.
- Updated default favicon and apple-touch-icon links to `static/icons/clean.png`.
- Updated Electron startup to use the Clean native icon file before the backend finishes loading.
- Set the Windows AppUserModelID to the same app id used by electron-builder.
- Regenerated `desktop/assets/icon.png`, `desktop/assets/icon.ico`, and `desktop/assets/icon.icns` from `static/icons/clean.png`.
- Generated `desktop/assets/icons/*.png` and `desktop/assets/icons/*.ico` for Clean, Concept, Skeuomorphic, and Flattened.
- Updated the Electron IPC payload to pass both `iconPath` and `iconId`.
- Updated Electron icon handling to prefer native desktop assets, save the selected icon id, and apply the saved icon during future launches.
- Added platform-specific icon picker hint and applied-status copy for macOS and Windows.
- Updated README icon labels to `Concept` / `Clean` and `概念` / `纯净`.

## Check

- `node --check static/game.js`
- `node --check desktop/electron/main.js`
- `node --check desktop/electron/preload.js`
- `python3 -m json.tool i18n/en/ui.json`
- `python3 -m json.tool i18n/zh/ui.json`
- `python3 -m json.tool package.json`
- `git diff --check`
- Verified `static/icons/clean.png`, `desktop/assets/icon.png`, `desktop/assets/icon.ico`, and `desktop/assets/icon.icns` have transparent corner alpha values.
- Verified every generated file in `desktop/assets/icons/` has transparent corner alpha values.
