# -*- mode: python ; coding: utf-8 -*-

datas = [
    ("templates", "templates"),
    ("static", "static"),
    ("data", "data"),
    ("models", "models"),
]

hiddenimports = [
    "dotenv",
    "openai",
    "sklearn.feature_extraction.text",
    "sklearn.linear_model._logistic",
    "sklearn.preprocessing._label",
    "scipy.sparse",
    "torch",
    "transformers",
    "transformers.models.auto",
    "transformers.models.phi3",
    "transformers.models.phi3.modeling_phi3",
    "transformers.models.phi3.tokenization_phi3",
]


a = Analysis(
    ["desktop_backend.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="cursed-canvas-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="cursed-canvas-backend",
)
