# Settings Scroll and Preload Input Fixes

Date: 2026-07-05

## Research

- Reviewed the preload overlay, title-screen keyboard handler, and staged startup flow in `static/game.js`.
- Reviewed the settings DOM structure in `templates/index.html`, including the shared `.settings-card`, tab panels, and cursor controls.
- Reviewed settings card height synchronization and scroll reset behavior in `static/game.js`.
- Reviewed settings card max-height and scroll-limited styling in `static/style.css`.

## Plan

- Ignore title-screen keyboard dismissal while the preload overlay is still active.
- Preserve settings scroll positions while measuring tab-panel heights.
- Avoid resetting scroll when the active settings tab is selected again.
- Move scroll-only bottom breathing room to the end of the scroll container.
- Make the settings card max-height budget use actual topbar/tab chrome height.

## Implementation

- Added a preload guard before the title-screen "any key" handler.
- Added settings chrome height measurement based on rendered topbar/tab heights and margins.
- Preserved settings scroll positions around panel height synchronization.
- Changed active-tab scroll reset so it only runs on real tab changes.
- Replaced scroll-limited padding inflation with a real scroll-container tail spacer.
- Kept scroll-limited active settings panels at content height so the tail spacer is not covered by flex overflow.

## Check

- `node --check static/game.js` passed.
- `git diff --check` passed.
- `curl -I --max-time 2 http://127.0.0.1:8025/` returned `200 OK` from the local Flask verification server.
- Electron verification passed: pressing Space during preload left `body.is-preloading` active and did not add `dismissing` to `#title-screen`.
- Electron verification passed: on the Cursor settings tab, scrolling to the bottom produced `104px` of bottom breathing room.
- Electron verification passed: after clicking the trail-style button, `.settings-card.scrollTop` stayed at `463` instead of resetting to `0`.
