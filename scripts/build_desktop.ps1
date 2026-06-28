$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

$Python = Join-Path $PWD "venv\Scripts\python.exe"
if (!(Test-Path $Python)) {
    py -3.11 -m venv venv
}

& $Python -m pip install --upgrade pip setuptools wheel
& $Python -m pip install -r requirements.txt
npm install
$env:PYINSTALLER_CONFIG_DIR = Join-Path $PWD "build\pyinstaller-config"
& $Python -m PyInstaller cursed-canvas-backend.spec --noconfirm --clean
npx electron-builder --win nsis portable --x64
