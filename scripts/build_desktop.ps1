$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements.txt
npm install
$env:PYINSTALLER_CONFIG_DIR = Join-Path $PWD "build\pyinstaller-config"
python -m PyInstaller cursed-canvas-backend.spec --noconfirm
npx electron-builder --win nsis portable --x64
