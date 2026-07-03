# Cursor Effects UI Update

Date: 2026-07-03

## Research

- Reviewed the existing settings tab structure in `templates/index.html`, `static/game.js`, and `static/style.css`.
- Confirmed UI copy is localized through `i18n/en/ui.json` and `i18n/zh/ui.json`.
- Reused the existing painting theme palettes from `START_PARTICLE_THEME_COLORS` for cursor and trail colors.

## Plan

- Add a new settings tab named Cursor / 光标.
- Add separate local preferences for the themed cursor and themed glow trail.
- Generate the cursor from the active theme colors and keep the trail synchronized with menu, gallery, settings, and in-game themes.

## Implementation

- Added the Cursor / 光标 settings tab with two checkbox controls.
- Added theme-aware cursor CSS, a glow-trail layer, and a settings preview panel.
- Added localStorage-backed cursor preferences in `static/game.js`.
- Synced cursor palette updates with `setStartParticleTheme` and `setParticleWorld`.
- Added English and Simplified Chinese i18n strings.
- Updated static asset cache keys in `templates/index.html`.

## Check

- `node --check static/game.js` passed.
- `i18n/en/ui.json` and `i18n/zh/ui.json` parsed successfully with Node.
- `git diff --check` passed for the touched files.
- Browser verification on `http://127.0.0.1:7860` confirmed:
  - The Cursor tab appears in Settings.
  - Both cursor options default to enabled.
  - The themed cursor CSS variable is generated from an SVG data URI.
  - Mouse movement creates theme-colored trail dots.
  - Disabling the options removes the body state and clears trail dots.
  - Re-enabling the options restores both effects.
  - No browser console errors were reported.

## Notes

- No backend settings API changes were required.
- Preferences are stored locally in the browser:
  - `theCursedCanvas.cursorStyleEnabled.v1`
  - `theCursedCanvas.cursorTrailEnabled.v1`
