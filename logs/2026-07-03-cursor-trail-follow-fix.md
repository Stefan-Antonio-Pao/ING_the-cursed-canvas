# Cursor Trail Follow Fix

## Research
- Re-examined the "Chasing Light" cursor trail after the follow-up report.
- The problem was not only broken continuity between short trail pieces. The old implementation generated independent DOM streaks behind the pointer, so the visual model could become `---------        >` instead of a single curve whose head is the pointer.
- The old implementation also created many short-lived DOM nodes during fast movement, which made the effect more likely to stutter.

## Plan
- Replace the DOM streak model with a single canvas-backed laser trail.
- Store trail samples newest-first, so the current pointer position is always the first point of the curve.
- Use browser coalesced pointer samples when available, and bridge large event gaps with bounded intermediate points.
- Draw the trail in one animation loop with a short lifetime, bounded point count, bounded length, and tapered alpha/width.
- Keep "Starlight Sparks" on the existing DOM particle path so its visual style is unchanged.

## Implementation
- Added a `.cursor-trail-canvas` overlay inside the existing trail layer.
- Removed the old Catmull-Rom/DOM streak generation path for "Chasing Light".
- Added canvas drawing helpers for glow, body, core highlight, and pointer-head glow.
- The laser trail now renders from `cursorTrailLaserPoints[0]`, which is always the current pointer sample, backward through recent history.
- Performance is bounded by a single canvas element, a maximum of 34 laser points, 185px trail length, and a 230ms trail lifetime.

## Check
- `node --check static/game.js`
- `git diff --check -- static/game.js static/style.css`
- Confirmed no old `cursor-trail-streak` DOM generation code remains.
- A follow-up local browser runtime load was not rerun because the required elevated local server command was unavailable in the current environment.
