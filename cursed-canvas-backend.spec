# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, copy_metadata


def _safe_collect(collector, package):
    try:
        return collector(package)
    except Exception as exc:
        print(f"WARNING: could not collect {package}: {exc}")
        return []


datas = [
    ("templates", "templates"),
    ("static", "static"),
    ("data", "data"),
    ("models", "models"),
    ("i18n", "i18n"),
]

for dist_name in ("numpy", "scipy", "scikit-learn", "joblib", "threadpoolctl"):
    datas += _safe_collect(copy_metadata, dist_name)

# SnowNLP ships non-Python data files (stopwords.txt, *.marshal) that it opens at
# import time. PyInstaller has no built-in hook for snownlp, so collect them
# explicitly; otherwise the frozen backend crashes with FileNotFoundError on
# `snownlp/normal/stopwords.txt` before the game's ImportError fallback can run.
datas += _safe_collect(collect_data_files, "snownlp")

binaries = []
for package_name in ("numpy", "scipy", "sklearn"):
    binaries += _safe_collect(collect_dynamic_libs, package_name)

hiddenimports = [
    "dotenv",
    "openai",
    "i18n.en.keywords",
    "i18n.en.prompts",
    "i18n.zh.keywords",
    "i18n.zh.prompts",
    "joblib",
    "sklearn.feature_extraction.text",
    "sklearn.linear_model._logistic",
    "sklearn.preprocessing._label",
    "sklearn.utils._openmp_helpers",
    "threadpoolctl",
    "scipy.sparse",
    "torch",
    "transformers",
    "transformers.models.auto",
    "transformers.models.phi3",
    "transformers.models.phi3.modeling_phi3",
    "transformers.models.phi3.tokenization_phi3",
    "snownlp",
    "snownlp.normal",
    "snownlp.seg",
    "snownlp.tag",
    "snownlp.summary",
    "snownlp.classification",
]


a = Analysis(
    ["desktop_backend.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "nltk",
        "nltk.app",
        "nltk.draw",
        "matplotlib",
        "tkinter",
    ],
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
    upx=False,
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
    upx=False,
    upx_exclude=[],
    name="cursed-canvas-backend",
)
