# Context for Claude Code

Working notes for anyone (human or agent) picking up this codebase. Read before
changing behavior.

## What this is

A traffic planner for a shortline railroad: stringline diagram plus traditional
timetable, with waypoint-based trip entry. Patterned on the FRA / Volpe *Railroad
Traffic Planner* (RR 09-02).

## The one architectural rule

**Times are computed, never stored.** A trip stores waypoints, dwell, and segment
speeds; `computeTrip()` in `src/lib/schedule.js` derives every arrival and departure
from distance ÷ speed. This is what makes a track restriction able to genuinely
re-draw the plan rather than just annotate it.

Do not add `arrive` / `depart` fields to the trip model. If a time needs to change,
change what produces it — the departure anchor, a segment speed, or a dwell.

## Domain conventions that matter

- **Times are minutes from midnight** internally, displayed as `18:30` via
  `fmt()` (colon form everywhere, by user request — bare railroad time `1830`
  was too opaque for non-rail readers). `parseHM()` accepts both forms.
- **West is Macon, east is Savannah.** Mile 0 is Macon. The stringline draws Macon
  at the top, so increasing mile goes downward.
- **A dwell is two points at the same location**, which is what renders the
  horizontal segment on a string. Don't collapse it to one.
- **A stop may carry `block: true`** — the train stands ON THE MAIN there.
  Draws solid (not the dashed in-the-clear convention) and `tripSegs()` does
  not mark it as a pass, so a crossing is a meet. Use it for tied-down trains
  at two-track locations (L781 at Collins overnight). Flag = "main" in the
  trip dialog's dwell cell.
- **A train that ties down and leaves with a new crew is ONE trip** with a
  long stop, not two jobs: `L781 → L781R` (Macon 18:00 → Collins 23:33–06:30 →
  Pooler) and `Y120 → L782R` (Pooler 18:00 → Collins 20:00–09:00 → Macon).
  The trip's `symbol` is the first crew's; the stop carries `as: "L782R"`
  (dialog: "continues as"). `computeTrip()` gives every point `sym` /
  `symArr`, so labels, meets, the timetable, and the export name each leg
  by its own crew — never show a merged "Y120/L782R" label.
  G&W (Sep 2026) told us both Collins tracks are occupied overnight; two
  separate jobs hid that. Which train is on the main is an ASSUMPTION
  (L781's, the second to arrive) — see the data file.
- **Built-in views** live in `data/presets.js` (`builtIn: true`, same snapshot
  shape as `lib/views.js`). Read-only in the roster; App merges them ahead of
  the planner's own. "Feedback" (Sep 2026) is the G&W Collins finding laid
  under Ethan's 22:00 two-vehicle idea. Fleet PATTERNS are not views: they
  live in `PS_PATTERNS` (network.js) and are picked in the Parallel panel
  (`applyPattern()` rewrites the seed units; `units` says which are in the
  plan). The user asked for patterns as a selector, explicitly NOT as saved
  views. Read the scan notes above `PS_PATTERNS` before moving any timing.
- **Job types** live in `TYPES` in `network.js`. `road` draws a sloped string;
  `local` / `yard` / `mow` draw occupancy bars. When adding a new kind of movement
  (e.g. an autonomous consist), add a type there rather than special-casing in
  components.
- **Tolerance lives on WAYPOINTS**: a stop or the destination may carry
  `tol: { early, late }` (minutes ≥ 0) — "by the time it gets here it may be
  this early / late". `tolAllow()` interpolates linearly by elapsed time
  between anchors, grows from zero at the origin, HOLDS after the last anchor
  (lateness persists), and RESETS to zero at a crew-change departure (`as`);
  a leg with no anchor before a crew change stays at the previous value. So
  each leg of a string can have its own band — that was the user's ask
  ("only one leg has it"). Stringline: hover a string and a ◂ −/+ ▸ handle
  floats above each leg (`tolLegs()`); dragging sets the anchor at that
  leg's end via `withTolAt()` (`onTol(id, wpIdx, tol)`). Timetable's
  per-train field edits the destination anchor. `tolOf()` = last anchor.
  Legacy trip-level `tol: { early, late, from?, to? }` (pre Sep-15 views)
  still reads as one anchor at `to` (default first crew change after
  `from`, else destination) with a reset at `from`; `withTolAt()`
  materialises it. `tolBand(sp, trip)` / `tolQuads()` are the geometry; the
  stringline and week view draw the ribbon, `findPossibleMeets()` flags
  ribbon overlaps (hollow amber), and `findOpenWindows()` treats ribbons as
  occupied. This is HOW UNEXPLAINED TIME IS REPRESENTED. Do not park it as
  short dwells at sidings ("phantom stops"): those draw dashed = "in the
  clear", and meet detection treats them as passes, so the tool ends up
  asserting a clearance nobody confirmed. Dashed is for stops someone has
  actually said are in the hole. Zero tolerance draws a sharp line and
  produces no possible meets, so plans without it are unchanged.
  SOURCE CAVEAT: G&W's deck (slide 7) gives job START times — L781 18:00 is
  on-duty, not wheels-rolling — which is exactly what a late anchor on the
  G&W trains should carry once G&W says how long a crew takes to leave.
- **"Annul"** is the right word for removing a scheduled trip, not "delete."
- **Waypoints are an ordered list, and stations may repeat.** That's what lets a
  route go out and back (every Parallel trip) or run one way. The trip dialog
  edits them in running order — never re-introduce a checkbox-per-station table
  that sorts by mile; it made round trips impossible and destroyed them on edit.
- **Location jobs carry `range: { w, e }`** (optional): the far station the job
  works to on each side of its base, drawn as a faint band; either side may be
  null. `jobRange()` in `lib/schedule.js` resolves it (and still reads the
  retired single-ended `territory` so old saved views draw). `unsourced: true` on a
  trip draws it hollow/dashed as a placeholder (Y115 — G&W has never given us
  its hours). Keep that flag until a real schedule arrives.

## The mileage caveat — don't "fix" this wrong

`STATIONS[].mile` is **chainage from Macon**, not the printed milepost. The line
carries two milepost series, anchored to GC Timetable #3 (2016, the proof PDF in
`src/assets/brand/`): Macon Sub MP 0.0→92.3 increasing eastward, Savannah Sub
MP 577.8→499.0 *decreasing* eastward, meeting at Vidalia (Macon 92.3 = Savannah
577.8). Conversion: Savannah-sub chainage = `92.3 + (577.8 − MP)`, which puts
Savannah at 171.1 — matching G&W's published 171. If someone "corrects" `mile` to
match printed mileposts, strings draw backwards through Vidalia. Don't.

**The June 2026 G&W slide deck's mileposts are approximate — the timetable
governs.** Slide 9 ("Layout of Jobs and Yard Limits") prints Dublin MP 54,
Collins Siding MP 557.5, Pooler Siding MP 511, B&W Lead MP 5; the deck is a
schematic, not to scale, and its numbers are rounded or refer to a different
point in the same yard. Station points here come from Timetable #3 / TT#4 /
GO#3 and stay where they are (Dublin 49.5 = West Dublin siding, Collins 556.6,
Pooler 510.2). Use the deck for job names, start times, days, and *which*
territory a job covers — never for where a station sits.

Each station carries `src: "mp" | "est"`. Keep that tag accurate when you change a
number — the stringline gutter renders `~` for estimated ones. The only soft station
left is **Magazine** (schematic bracket position). Note: the ETT's only "Magazine"
is Magazine Avenue *inside Savannah Yard*; if the operating plan means that point,
Magazine belongs at ~mile 170 and the L782/Y120 routes read differently. Confirm
with the railroad before moving it. Pooler and Plastic Express aren't ETT stations
either — their MPs come from the operating-plan schematic, anchored into the
Savannah-sub series.

## Also currently approximate

- Track speeds, yard limits, and the station roster (`SPEED_LIMITS` /
  `YARD_LIMITS` / `STATIONS` in network.js) are from **GC General Order #3
  (eff. June 20 2026) and the GCLP Timetable #4 template (Savannah Sub)** —
  both in `docs/`, the operative sources of truth, formally revising
  Timetable #3 (2016). The ETT remains the anchor for mileposts/chainage
  only. Notable deltas from 2016: Macon MP 6–49 upgraded 10→25 mph, 20 mph
  tiers at Macon MP 2–6 and Savannah MP 504–521.5 (official maximum speeds,
  per GO#3), Savannah YL extended to MP 521.5, Lyons YL gone, Pooler siding
  added (MP 510.2–512.3, crew-usable), Ellabell station/siding added
  (4880 ft). GO#3/TT#4 OSI notes not modeled: EB 5-MPH approaches at two
  Vidalia YL crossings, stop-and-proceed at two island-circuit crossings.
  DOB/bulletins still change things day to day. A trip waypoint's `speed`
  caps below the track limit, never raises it (`legTime()` integrates zones
  per leg; `zonesFor()` can give a type its own zone table — see the retired
  `yl10` flag). The June 2026 G&W presentation remains the source for job
  start times, Y115, and candidate charging sites (Macon Yard, B&W Lead MP 5,
  MP 79.5 customer, Vidalia, Pembroke, Old Interfor, Plastic Express).
- L782R's en-route work: Dublin is ~1 h (Joe/Rob, Sep 2026). Only the confirmed
  stops (Vidalia, Dublin) are modeled; the leg computes to Macon 16:33 and the
  remaining ~1.5 h to the reported ~18:00 is a tolerance anchor on the Macon
  waypoint (`tol: { early: 0, late: 85 }`, growing from the Collins crew
  change) — 85 not 87 so the late edge (17:58) stays
  clear of L781's 18:00 departure from the same yard. Where the time really
  goes is unknown and the ribbon says exactly that. The point is still to stop
  the plan relying on a 2-hour pass window at Dublin. Consequences: the
  Afternoon Parallel pattern is conflicted (all three units cross L782R west of
  Dublin) and kept only as a what-if; the Night pattern's returns (PS5, PS2,
  PS3) follow L782R west the next afternoon and show as POSSIBLE meets — they
  pass it at Dublin only if L782R is on time.
- THE NIGHT PLAN OF RECORD IS FLAGGED (Sep 2026): the eastbound parade
  reaches Collins 04:53–06:03 while both Collins tracks are occupied by the
  tied-down L781 and Y120 trains (23:33–06:30). Three meets every night. Not
  quietly fixed here — it is to be revisited after the site visit; the tool's
  job is to show it. `PS_PATTERNS.night` is marked `flagged` and its note
  says so. The default pattern is now `two` (one unit each way), for which
  the model flags no meets — the user's instruction: never call a pattern
  "clean all week", the railroad has not agreed to any of them. The plan of
  record itself has not been formally changed.
- Restriction overlap is tested at segment departure time with a 4-hour lookback,
  not integrated along the run.
- `findPossibleMeets()` tests edge-vs-line crossings plus vertex containment
  in the ribbon quads; a string lying wholly inside a ribbon with no vertex
  inside it (rare) is not caught. Markers within 30 min / 5 mi merge.
- `findMeets()` and `findOpenWindows()` span day boundaries: the previous day's
  overnight tails (and, for scans, the next day's departures) are included,
  shifted ±1440. Still no headway to same-direction trains, and a restriction's
  time window only matches trips departing the same day.

All flagged in the UI. Don't quietly remove those notes — they're the difference
between a planning aid and a thing someone mistakes for authoritative.

## Scope boundary — important

This is **advisory**. Meet detection tells a planner where the plan conflicts so a
human resolves it. Nothing here gates, authorizes, or enforces a movement.

If a feature request would make this act on live position to permit or prevent a
move, that belongs in a separate artifact with its own assurance level — it does not
belong in this codebase, even behind the same UI. The FRA/Volpe tool drew this line
explicitly and it's worth keeping deliberate.

## Conventions

- Tailwind 4 (`@import "tailwindcss"` in `index.css`, `@tailwindcss/vite` plugin).
  No `tailwind.config.js` — v4 needs none for this.
- Colors for SVG are inline style props; Tailwind classes for DOM.
- `lib/schedule.js` stays pure — no React imports, no side effects. It's the seam for
  future planned-vs-actual comparison and it should stay independently testable.
- Persistence is limited to **saved views** (`lib/views.js`, `components/SavedViews.jsx`):
  named snapshots of the plan *inputs* — trips (incl. drag-retimed anchors),
  restrictions, hidden set, schedule pattern, zoom, day — kept in `localStorage`
  under `gc-planner.views.v1`. Per-browser, per-machine, deliberately: this is a
  planner's scratch set of alternatives, not a shared plan of record. Times are
  still never stored; loading a view recomputes. The live plan itself does not
  auto-persist — a reload restores the seed plan unless you load a view. If views
  ever need to be shared, `views.js` is the seam (serialize/parse is already
  separate from storage).

## Good next steps

- Real chaining and real segment speeds (biggest accuracy win, smallest diff)
- Share / export saved views (JSON file or URL) so alternatives can travel
  between planners — the storage seam in `lib/views.js` is ready for it
- Per-segment speed limits on the track model itself, so trips inherit rather than
  each carrying their own numbers
- Re-time the Parallel plan of record around the Collins overnight stand
  (after the Sep 2026 site visit): the clean corridors are before ~23:30 and
  after 06:30 at Collins, or a hold east of Collins with a route around it.
  Joint scan (Sep 15, 2026) of one-way legs vs the G&W baseline: eastbound
  Macon departures clean 04:00–06:00 (also 00:00–02:10); westbound PX
  departures 18:30–19:45 work ONLY with a planned pass of L781 (which holds
  the Macon–Collins road 18:00–23:33) — no nonstop evening westbound clears
  it. The patterns take that pass in Vidalia yard (a wait, not a charge: the
  unit is charged at PX for the whole return, per the user). No clean
  weekday round trip for ONE unit without that pass; Friday night from 18:00
  and all Saturday are clean.
- Grow the tests (`npm test`, node:test, zero dependencies — `test/*.test.mjs`)
  as the computation grows. They pin the load-bearing behaviors: computed
  times, dwell-as-two-points, restrictions re-drawing, seed plan meet-free,
  saved-view round-trip. Run them before handing anyone a build.

## Repository hygiene (for anyone cloning or reviewing)

- `src/assets/brand/Branding Assets/` (~1.4 GB of video, fonts, banners) and
  the 90 MB brand-guidelines PDF are **reference material, not source**. Nothing
  imports them; the app uses only `parallel-logo-black.svg`. They are
  git-ignored and excluded from the source bundle. The Timetable #3 proof PDF
  stays — it is the anchor for the mileage model above.
- `docs/` holds the operative sources (GO#3, TT#4 templates, drive-cycle
  workbooks). Read-only inputs; the app does not load them at runtime.
- `dist/` is a build product. `gc-planner-site.zip` is the Netlify drag-and-drop
  bundle and must be regenerated after every build (`npm run build`, then zip
  `dist/`).
- No git history ships with the folder. If you `git init`, the `.gitignore` is
  already set up to keep the heavy assets out.

## Branding

Brand tokens live in `src/theme.js` (`BRAND`); assets go in `src/assets/brand/`.
The masthead already reads product name, railroad name, line name, and optional
logo from `BRAND`. When applying company branding, change `theme.js` — don't
scatter brand colors through components. Operational job-type colors stay in
`data/network.js` because they encode meaning (road/yard/MOW), not brand.
