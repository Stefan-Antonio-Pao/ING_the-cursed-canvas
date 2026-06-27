$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")
python -m pip install -r requirements.txt
python -m PyInstaller cursed-canvas-backend.spec --noconfirm
npm install
npm run desktop:dist
