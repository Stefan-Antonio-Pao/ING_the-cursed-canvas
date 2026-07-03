# Cursor Feedback Polish

Date: 2026-07-03

## Research

- Reviewed the existing cursor settings tab, cursor SVG generation, trail rendering, preview card, and i18n strings.
- Confirmed the continuous trail style is stored internally as `laser`, so the visible rename can be made without breaking existing local preferences.
- Confirmed new cursor effects can remain frontend-only browser preferences.

## Plan

- Rename the continuous trail to `Chasing Light` / `追光逐影`.
- Make the continuous trail narrower, brighter, more frequent, and tapered toward older segments.
- Add cursor tip glow and click feedback toggles before trail controls.
- Update the settings preview so it reflects all cursor-related options.

## Implementation

- Added cursor tip glow and click ripple feedback settings.
- Added theme-colored click ripple and subtle spark particles.
- Rebuilt the cursor SVG with an optional theme-colored tip glow.
- Tuned the continuous trail into shorter, denser, tapered light segments.
- Updated English and Simplified Chinese labels and notes.
- Updated static asset cache keys.

## Check

- `node --check static/game.js` passed.
- Cursor i18n key/value check passed for English and Simplified Chinese, including `Chasing Light` / `追光逐影`.
- `git diff --check` passed for the touched cursor/settings/i18n files and this log.
- Reviewed the cursor logic manually: the new tip glow and click feedback preferences default on, update the preview state, and are included in storage synchronization.
- Reviewed the continuous trail logic manually: fast movement is split into up to 14 short tapered segments, with shorter 260ms fade timing to keep the trail dense but brief.
- Browser verification was not completed in this environment. Starting the local Flask service required escalation, and the request was rejected by the environment usage limit; no existing service was reachable on `127.0.0.1:7900`.
