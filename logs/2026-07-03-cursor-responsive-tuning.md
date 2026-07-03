# Cursor Responsive Tuning

Date: 2026-07-03

## Research

- Reviewed the cursor settings tab, shared settings stepper layout, cursor SVG generation, trail rendering, preview card, and English/Simplified Chinese strings.
- Confirmed the cursor trail style selector had its own class but no full-width rule.
- Confirmed the tip glow only had an on/off preference, so a new radius preference could be added as a frontend-only browser setting.
- Confirmed the previous continuous trail used many short DOM elements, which could become heavy during fast mouse movement.

## Plan

- Make cursor-tab steppers match the full-width settings controls used by other tabs.
- Add three cursor tip glow radius options with a medium default.
- Hide dependent left/right steppers when their parent checkbox is off.
- Re-tune `Chasing Light` / `追光逐影` to use fewer compensated streaks, slightly wider traces, and more emphasis-color-dominant gradients.
- Keep the preview and bilingual strings synchronized with the new settings.

## Implementation

- Added a tip glow radius stepper with `Small` / `Medium` / `Large` and `小` / `中` / `大` labels.
- Added `theCursedCanvas.cursorTipGlowRadius.v1`, defaulting to `medium`.
- Split cursor SVG filters so the tip glow radius changes do not enlarge the whole pointer shadow.
- Hid the tip glow radius selector when tip glow is off, and hid the trail style selector when trail is off.
- Made cursor trail and tip glow steppers full-width.
- Reworked `Chasing Light` to generate up to 7 compensated streaks per movement instead of up to 14, with short follow-direction drift during fade-out.
- Adjusted `Chasing Light` width and color gradient so the near-cursor emphasis color dominates while the secondary color stays in the tail.
- Updated static asset cache keys.

## Check

- `node --check static/game.js` passed.
- JSON parsing passed for `i18n/en/ui.json` and `i18n/zh/ui.json`.
- Cursor radius i18n key/value check passed for English and Simplified Chinese.
- `git diff --check` passed for the touched files.
- Browser verification on `http://127.0.0.1:7900` confirmed:
  - cursor trail and tip glow steppers are full-width;
  - tip glow radius defaults to `Medium`;
  - radius changes update the preview dataset;
  - dependent steppers are hidden when their checkbox is off;
  - Chinese cursor labels render as `光标`, `光晕半径`, `追光逐影`;
  - final state was restored to English and medium radius;
  - no browser console errors were reported.
- Automated browser pointer movement/clicking did not trigger page `pointermove` / `pointerdown` effects in this environment, so live trail animation smoothness was reviewed through the DOM generation strategy and style variables rather than visual pointer events.
- Stopped the Flask verification service and confirmed no listener remained on ports 7900 or 7901.
