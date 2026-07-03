# Cursor Trail Style and Language Guard Update

Date: 2026-07-03

## Research

- Reviewed `switchLanguage`, `refreshAllUI`, new-adventure onboarding, and cursor trail code in `static/game.js`.
- Confirmed the mixed-language screenshot is caused by dynamic UI refresh timing, not by historical dialogue translation.
- Confirmed cursor settings are local browser preferences and should remain frontend-only.

## Plan

- Lock language controls while a new adventure is being prepared or opened.
- Apply static i18n before dynamic side-panel refresh during language switching.
- Add a default continuous laser-style cursor trail while preserving the existing stardust trail.
- Bind the cursor settings preview to the current cursor/trail settings.

## Implementation

- Added a short new-adventure transition lock for language controls and onboarding next buttons.
- Reordered `refreshAllUI` so dynamic world state wins over static `data-i18n` placeholders.
- Added frontend fallback world descriptions and localized exit rendering for language refreshes without fresh server state.
- Added `Laser Trace` / `视觉残留` and `Starlight Sparks` / `群星璀璨` trail styles.
- Made the settings preview respond to cursor style enabled, trail enabled, and trail style.
- Updated static asset cache keys.

## Check

- `node --check static/game.js` passed.
- `i18n/en/ui.json` and `i18n/zh/ui.json` parsed successfully with Node.
- `git diff --check` passed for the touched frontend and i18n files.
- Browser verification on `http://127.0.0.1:7900` confirmed:
  - The updated static asset keys loaded.
  - The Cursor tab defaults to `Laser Trace` / `视觉残留`.
  - Laser movement creates `.cursor-trail-streak` elements.
  - Switching to `Starlight Sparks` preserves the previous dot-style trail.
  - Turning the trail off disables the style stepper and clears trail elements.
  - During new-adventure reset, language controls and next controls are disabled until the intro opens.
  - In-game language switching refreshes header, input placeholder, location name, location description, exit button, side-panel heading, and Settings button consistently.
  - No browser console errors were reported.

## Notes

- Historical chat messages still keep their original language by design.
- New cursor trail style preference is stored as `theCursedCanvas.cursorTrailStyle.v1`.
