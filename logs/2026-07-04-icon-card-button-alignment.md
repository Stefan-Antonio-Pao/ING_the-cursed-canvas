# Icon Card Button Alignment

Date: 2026-07-04

## Research

- Reviewed the icon settings markup in `templates/index.html`.
- Reviewed icon gallery rendering in `static/game.js`.
- Reviewed `.icon-gallery-grid`, `.icon-card`, `.icon-card-body`, and `.icon-card-status` styles in `static/style.css`.
- Confirmed the card buttons were vertically offset because descriptions have different line counts while the card body did not reserve flexible space above the button.

## Plan

- Keep the existing icon gallery structure.
- Make each icon card body fill the remaining card height.
- Push the action/status button to the bottom of the card body.
- Refresh the CSS asset cache key.

## Implementation

- Added `flex: 1 1 auto` to `.icon-card-body`.
- Changed `.icon-card-status` to use `margin-top: auto` so all icon action/status buttons align along the bottom edge of their cards.
- Updated the stylesheet cache key in `templates/index.html`.

## Check

- `git diff --check` passed.
- Browser verification on `http://127.0.0.1:7871` confirmed the updated stylesheet cache key loaded and all four icon action/status buttons had matching bottom positions (`buttonBottomSpread: 0`).
- Stopped the Flask verification service.
