# Settings, Gallery, and Cursor Polish

Date: 2026-07-03

## Research

- Reviewed the settings card height synchronization, settings tab panels, cursor dependent controls, cursor SVG generation, `Chasing Light` trail generation, and gallery language loading.
- Confirmed the settings height sync already measured tab panels, but cursor dependent controls were measured in their current checked/unchecked state instead of their maximum reachable state.
- Confirmed `Chasing Light` connected the most recent pointer events with straight segment groups, which made circular motion read as a polygon.
- Confirmed the cursor SVG viewBox did not leave enough transparent margin for medium/large tip glow.
- Confirmed gallery payload loading preferred `settingsData.language.current`, which could be stale during startup when local language preference was already Simplified Chinese.

## Plan

- Keep settings card height stable by measuring cursor dependent controls in their expanded state.
- Make cursor dependent controls hide immediately while preserving the maximum settings card height.
- Smooth `Chasing Light` with recent-point curve sampling instead of only straight event-to-event segments.
- Expand the cursor SVG canvas and update the cursor hotspot to avoid clipping tip glow.
- Make gallery loading use the active i18n language and invalidate cached gallery pages on language refresh.

## Implementation

- Updated settings panel height measurement to force cursor dependent controls visible during max-height calculation.
- Triggered immediate settings height sync from cursor settings UI updates.
- Added recent pointer history and Catmull-Rom sampling for `Chasing Light`.
- Preserved follow-direction drift while sampling smoother curved trail segments.
- Increased cursor SVG canvas to `58x58` with `viewBox="-18 -18 58 58"` and updated the cursor hotspot to `24 21`.
- Added `getCurrentInterfaceLanguage()` and `galleryLanguage` tracking so gallery fetches use the active UI language.
- Cleared gallery cached pages when the UI language refreshes.
- Updated static asset cache keys.

## Check

- `node --check static/game.js` passed.
- JSON parsing passed for `i18n/en/ui.json` and `i18n/zh/ui.json`.
- `git diff --check` passed for touched frontend files.
- Browser verification on `http://127.0.0.1:7900` confirmed:
  - cursor dependent controls hide immediately when unchecked;
  - settings card height stayed `526px` before, immediately after, and after delay;
  - the settings view height stayed `624px`;
  - large tip glow uses the widened SVG canvas and updated hotspot;
  - switching to Simplified Chinese and opening gallery fetched `/api/gallery?lang=zh`;
  - gallery title and intro rendered in Chinese without the previous English cached line;
  - asset cache keys loaded as `cursor-gallery-polish-20260703`;
  - no browser console errors were reported.
- Restored the browser test state to English and medium tip glow radius.
- Stopped the Flask verification service and confirmed no listener remained on ports 7900 or 7901.
