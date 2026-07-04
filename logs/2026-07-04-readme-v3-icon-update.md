# README v3 and Icon Update

Date: 2026-07-04

## Research

- Reviewed `README.md` and `README.zh-CN.md`.
- Confirmed v3 feature work includes startup preload, voice input/runtime safeguards, cursor effects, game icon selection, gallery language polish, and main-menu exit behavior.
- Confirmed the new selectable icon files exist under `static/icons/`: `skeuomorphic.png`, `flattened.png`, `concept.png`, and `clean.png`.

## Plan

- Refresh both README files so their feature lists match the current v3.0.0 app.
- Add a visible icon preview near the top of each README.
- Add an icon set section that references all four selectable icon styles.
- Keep the update documentation-only.

## Implementation

- Added a top icon preview to both README files.
- Added an `Icon Set` / `图标资源` section with four icon variants.
- Updated feature lists for preload, voice input, cursor effects, icon picker, gallery, and runtime-aware exit behavior.
- Updated Quick Start, How to Play, Project Structure, and Troubleshooting notes to mention optional voice/runtime behavior.

## Check

- `git diff --check -- README.md README.zh-CN.md logs/2026-07-04-readme-v3-icon-update.md` passed.
- Confirmed all README icon paths exist under `static/icons/`.
- Reviewed the README diff to confirm the change is documentation-only.
