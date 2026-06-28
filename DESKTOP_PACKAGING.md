# The Cursed Canvas Desktop Packaging

This project now supports a desktop test build using Electron + PyInstaller.

## Architecture

```text
Desktop App
  Electron window
    -> bundled local Flask backend
      -> Personal API: user's local DeepSeek key
      -> Experience Mode: remote Experience Proxy
      -> Local Model: local Phi-3 warmup remains available
```

The desktop package does not need to contain the experience DeepSeek API key.
Experience Mode calls a remote proxy that owns the key and quota state.

## 1. Deploy The Experience Proxy

Deploy `experience_proxy/proxy_app.py` to Render, Railway, Fly.io, a VPS, or a similar Python host.

Proxy environment variables:

```env
DEEPSEEK_EXPERIENCE_API_KEY=your_real_experience_mode_deepseek_key
DEEPSEEK_MODEL=deepseek-v4-flash
EXPERIENCE_TOKEN_LIMIT=120000
DEEPSEEK_EXPERIENCE_UNLOCK_KEY=your_unlock_test_key
EXPERIENCE_UNLOCK_TTL_SECONDS=21600
EXPERIENCE_PROXY_AUTH_TOKEN=
EXPERIENCE_PROXY_DB_PATH=experience_proxy.sqlite3
```

On Render Free, leave `EXPERIENCE_PROXY_DB_PATH` as `experience_proxy.sqlite3` or use `/tmp/experience_proxy.sqlite3`.
Use `/var/data/experience_proxy.sqlite3` only after adding a Render Persistent Disk mounted at `/var/data`.

Start command:

```bash
gunicorn proxy_app:app --bind 0.0.0.0:$PORT
```

For local proxy testing:

```bash
cd experience_proxy
python -m pip install -r requirements.txt
PORT=8080 python proxy_app.py
```

## 2. Configure The Desktop App

After the proxy is deployed, edit:

```text
desktop/electron/config.json
```

Set:

```json
{
  "experienceProxyUrl": "https://your-experience-proxy.example.com",
  "experienceProxyAuthToken": ""
}
```

Do not put the real DeepSeek API key in this file. This file is packaged into the desktop app and is visible to users.

## 3. Build The Desktop Backend

macOS/Linux:

```bash
python -m pip install -r requirements.txt
python -m PyInstaller cursed-canvas-backend.spec --noconfirm
```

Windows PowerShell:

```powershell
python -m pip install -r requirements.txt
python -m PyInstaller cursed-canvas-backend.spec --noconfirm
```

The backend output is:

```text
dist/cursed-canvas-backend/
```

## 4. Build The Desktop App

Install Node dependencies:

```bash
npm install
```

Development run:

```bash
npm run desktop:dev
```

Full packaged build:

```bash
npm run desktop:dist
```

Output:

```text
build/desktop-dist/
```

Desktop icons live in `desktop/assets/`. Regenerate them with:

```bash
python scripts/generate_desktop_icons.py
```

Build macOS packages on macOS. Build Windows packages on Windows. Cross-building is not recommended for this project because the bundled Python backend and ML dependencies are platform-specific.

## 5. Save Data Location

Desktop saves are written outside the app install directory:

- macOS: `~/Library/Application Support/The Cursed Canvas/save_slots.json`
- Windows: `%APPDATA%/The Cursed Canvas/save_slots.json`
- Linux: `~/.local/share/the-cursed-canvas/save_slots.json`

The desktop client id used by the Experience Proxy is stored in the same app data directory.

## 6. Local Model Notes

The Local Model option is preserved. The packaged app still uses the local Phi-3 path, but model weights are not bundled by default. On first use, Transformers may download/cache model files on the user's machine. This keeps the installer smaller, but the first local-model run can be slow and requires enough RAM.

For a small tester build, recommend DeepSeek API or Experience Mode as the default path.

## 7. Camera-Ready Checklist

- Deploy Experience Proxy.
- Put the proxy URL in `desktop/electron/config.json`.
- Build the backend with PyInstaller.
- Build the desktop app with Electron Builder.
- Launch the packaged app and test:
  - Experience Mode response and token deduction.
  - Unlock key behavior.
  - Personal API mode.
  - Local Model loading/progress.
  - Save/load path persistence after app restart.
  - macOS and Windows packages independently.
