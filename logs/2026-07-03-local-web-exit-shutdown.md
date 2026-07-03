# 2026-07-03 Local Web Exit Shutdown

## Research
- Confirmed local browser mode runs Flask from `app.py` on `127.0.0.1`.
- Confirmed desktop mode already uses Electron IPC through `window.cursedCanvasDesktop.quitApp()`.
- Confirmed the main-menu exit button currently falls back to browser-only `window.close()`.

## Plan
- Add a local-only backend shutdown endpoint for browser mode.
- Keep Electron desktop exit as the first path.
- Update the main-menu button to stop the local Flask server before attempting to close the browser window.
- Add bilingual status text for the shutdown path and fallback.

## Implementation
- Added `POST /api/quit` in `app.py`, limited to local request addresses.
- Scheduled server shutdown after the JSON response is returned.
- Updated `exitGameFromMainMenu()` to call `/api/quit` outside Electron.
- Updated English and Simplified Chinese main-menu exit status copy.

## Check
- `./venv/bin/python -m py_compile app.py` passed.
- `node --check static/game.js` passed.
- `node -e` JSON parsing for `i18n/en/ui.json` and `i18n/zh/ui.json` passed.
- Flask test client check passed with `_shutdown_local_server` mocked: local `127.0.0.1` requests return `200`, non-local requests return `403`.
- `git diff --check -- app.py static/game.js i18n/en/ui.json i18n/zh/ui.json logs/2026-07-03-local-web-exit-shutdown.md` passed.

## Result
- In local browser mode, clicking the main-menu exit button now requests the local Flask terminal process to stop.
