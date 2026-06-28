$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Step,
        [Parameter(Mandatory = $true)]
        [scriptblock] $Command
    )

    Write-Host ""
    Write-Host "=== $Step ==="
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE"
    }
}

$Python = Join-Path $PWD "venv\Scripts\python.exe"
if (!(Test-Path $Python)) {
    Invoke-Checked "Create Python venv" { py -3.11 -m venv venv }
}

Invoke-Checked "Upgrade Python packaging tools" { & $Python -m pip install --upgrade pip setuptools wheel }
Invoke-Checked "Install Python dependencies" { & $Python -m pip install -r requirements.txt }
Invoke-Checked "Install Node dependencies" { npm install }
$env:PYINSTALLER_CONFIG_DIR = Join-Path $PWD "build\pyinstaller-config"
Invoke-Checked "Build PyInstaller backend" { & $Python -m PyInstaller cursed-canvas-backend.spec --noconfirm --clean }

$BackendExe = Join-Path $PWD "dist\cursed-canvas-backend\cursed-canvas-backend.exe"
if (!(Test-Path $BackendExe)) {
    throw "PyInstaller did not produce the expected backend executable: $BackendExe"
}

Invoke-Checked "Build Electron Windows app" { npx electron-builder --win --x64 }
