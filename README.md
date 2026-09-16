# G&C Traffic Planner

Stringline and timetable planning tool for the Macon — Savannah line. Waypoint-based
trip entry with **computed** running times, track restrictions that re-draw the plan,
and switchable stringline / timetable views.

Modeled on the FRA / Volpe *Railroad Traffic Planner* (RR 09-02), which established
the pattern: a planner enters waypoints, dwell, and speeds; the tool derives the times
and draws the strings.

## Run it

```bash
npm install
npm run dev
```

Opens on http://localhost:5173.

```bash
npm run build     # production bundle to dist/
npm run preview   # serve the built bundle
```

```bash
npm test          # pure-logic tests (node:test, no extra deps)
```

Requires Node 18+ (Node 20+ for `npm test`). Verified on Node 24 with Vite 6,
React 18, Tailwind 4.

## What it does

**Stringline view** — location (Macon at top, Savannah at bottom) against time.
Road trains draw as sloped strings; a dwell shows as a horizontal segment. Yard,
local, and MOW jobs draw as occupancy bars. Yard limits are banded. Drag any string
or bar horizontally to retime it.

**Timetable view** — traditional employee-timetable layout: stations as rows, trains
as columns, arrive/depart pairs, split eastbound and westbound and reading down in
the direction of travel. Both views read from the same computation, so they can't
disagree.

**Add / Update Trip** — Train ID, type, departure or on-duty time, days operated,
and an ordered waypoint list: add points in running order, mark stops, set dwell
and speed per segment, reorder or remove rows, and **+ Return leg** mirrors the
route back to the origin for a round trip. One-way, out-and-back, and mid-line
turns are all expressible. Arrive and depart fill in live as you edit. Yard, local,
and MOW jobs get a base point, an optional coverage range (west end and east end of
the territory they work), and hours on duty. On the stringline a bar drags in two
dimensions: sideways retimes it, up or down moves it to the nearest station. Its
right end drags to change hours, and the top and bottom edges of its coverage band
drag to stretch the coverage west or east to another station (pull an edge back onto
the base to collapse that side).

**Tolerance ribbons** — a road train can carry a schedule tolerance: how many
minutes early and how many late it may realistically run, measured at its
destination, or by any stop along the way. Every road train has it, leg by leg: hover a
string and a small **◂ −/+ ▸** handle floats above each leg; drag **▸** right for "may
be this late by the end of this leg", **◂** left for early. Later legs inherit the value
unless they have their own, and a crew change resets it. The **Table** view has the
minutes under every train (the destination value), and the trip dialog has a *Tol −/+*
column on each stop. Zero on both sides is the default sharp line. The stringline then draws the string as a
translucent ribbon in the train's colour, tight at the origin and widening along
the run to the full allowance at the destination, with the latest arrival printed
at the end. This is how unexplained running time is represented now: L782R is
modeled with only its confirmed stops (Vidalia and Dublin), computes to Macon at
16:33, and carries +85 min so the ribbon's late edge lands on the reported ~18:00.
Before, that time was parked as short "phantom" stops at sidings, which drew dashed
(the chart's own mark for "in the clear, main not blocked") and which meet detection
treated as planned passes. A ribbon asserts nothing about the main being clear.

**Contiguous trains and the Collins overnight stand** — G&W (Sep 2026) pointed out
that both Collins tracks are occupied overnight: L781's train ties down there at
23:33 and leaves as L781R at 06:30, and Y120's train arrives 20:00 and leaves as
L782R at 09:00, each waiting for its day crew. The seed plan models each pair as
**one trip with a long stop**, so the stand shows on the chart instead of vanishing
between two jobs. The stop is marked *continues as* with the new crew's symbol, so
the string is labelled Y120 up to Collins and L782R after it, and meets name the
leg they fall on. A stop can be flagged **main** in the trip dialog: it then draws as
a heavy solid flat line instead of dashed, and meet detection treats anything
crossing it as a conflict rather than an in-the-clear pass. L781's stand carries the
flag (it arrives second; the assumption is noted in the data file). Consequence: the
Night plan of record now shows three meets at Collins every night, which is the
point — it is to be revisited after the September site visit.

**Built-in views** — the app can ship views that appear at the top of the Views list
marked *built-in*, for everyone who opens the site; none ship at the moment. A planner's
own views stay in their browser.

**Fleet patterns** — the *Pattern* selector at the top of the Parallel vehicles panel
is the one place to choose how the vehicles run. Each pattern rewrites the seed units'
departures and routes and decides which units are in the plan. A one-line note sits
under the row; the caveats for G&W are in the button's tooltip. None of them is called
"clean": the model flagging no meets is not the railroad agreeing. **Two vehicles**
(default): one unit east out of Macon 05:30, a different one west out of Plastic
Express 19:00, already charged for the run home so it does not charge again — but no
evening westbound clears L781, which is on the road Macon to Collins 18:00–23:33, so it
waits in Vidalia yard 21:58–22:58 while L781 passes. **One vehicle, layover at PX**: the
same cycle as one unit, home 03:40, 110 min at Macon before the next run. **One vehicle,
fast turn**: Macon 04:15, home ~22:45 with one planned 30-min hold in the Dublin siding
for L781. **Three units, Night** (former plan of record, flagged at Collins) and **Three
units, Afternoon** (conflicted at Dublin) are kept for reference. Timings and the scan
behind them are in `data/network.js` under `PS_PATTERNS`.

**Track restrictions** — speed restriction or out of service, over a range of the
line for a time window. Because times are computed, adding one genuinely re-draws
affected strings and can create a new meet. None ship with the seed plan (every
input is sourced); add one from **+ Restriction**, turn on the **Speeds** toggle,
and watch the affected string flatten through the band and everything downstream slip.

**Meets and passes** — geometric detection of where the plan puts two road movements
at the same place at the same time. Flagged with red diamonds and listed with the
nearest station named. A second, softer grade — **possible meets**, hollow amber
diamonds — marks where one train's tolerance ribbon overlaps another string without
the nominal lines crossing: if that train runs at the edge of what we know, the two
are on the road together there. The **Find slot** scan treats ribbons as occupied, so
it advises conservatively.

**Saved views** — drag strings into an arrangement you want to keep, open **Save view**
in the toolbar, and name it. Or just stop: 1.2 seconds after a drag with no mouse
activity, a small *Save this view?* prompt offers to save, update the loaded view, or
be ignored until the next drag. A view captures the plan inputs (trips with their
retimed departures, restrictions, hidden units, schedule pattern, zoom, day) and
recomputes on load, so views stay consistent with the track model. A loaded view
shows in the toolbar with a `*` when the plan has drifted from it; **Update**
overwrites it in place. Views are stored in the browser (localStorage), so they
are per machine.

Also: Times / Speeds label toggles, AM / PM / Night / Day zoom on the time axis,
tab-delimited export for a spreadsheet (with *Earliest / Latest* columns from the
tolerance band), and reset.

## Layout

```
src/
  data/network.js        Stations, mileage, yard limits, job types, seed plan
  data/presets.js        Built-in views shipped with the app (none at present)
  lib/schedule.js        Pure computation: times, restrictions, meet detection
  components/
    Stringline.jsx       SVG diagram, drag-to-retime
    Timetable.jsx        Read-down arrive/depart columns
    TripDialog.jsx       Add / update trip, waypoint table
    RestrictionDialog.jsx
    SavedViews.jsx       Named plan snapshots — save / load / update / delete
  lib/views.js           Snapshot + localStorage for saved views (pure)
  App.jsx                State, toolbar, roster, view switching
```

`lib/schedule.js` is pure — no React, no side effects. That's deliberate: it's
testable in isolation and it's the natural seam for feeding real position data
through the same geometry later to compare planned against actual.

## Tests

`test/schedule.test.mjs` covers the pure computation in `lib/schedule.js`: time
formatting, zone-integrated running time, restriction slow-downs and out-of-service,
dwell as two points, round trips, the contiguous seed trains (Collins stand, L782R
leg and tolerance edge, the main-track flag), the G&W baseline being meet-free and
the Night pattern's meets being exactly the Collins stand, meet detection with
in-the-hole passes, tolerance geometry (band, quads, possible meets, ribbons
occupying the slot scan), built-in views, slot-window shape, and the
TSV export. `test/views.test.mjs`
covers saved-view snapshots, dirty-checking, and storage round-trips including
corrupt data. All pure — no DOM, no React, runs in well under a second.

## Repository notes

`src/assets/brand/Branding Assets/` and the brand-guidelines PDF are reference
material only (about 1.5 GB); nothing imports them and they are excluded from the
source bundle and `.gitignore`d. The operative railroad documents the data file cites
(General Order #3, the Timetable #4 templates, the drive-cycle workbooks, and the June
2026 G&W deck) are kept outside the repository, in the parent folder; the app never
loads them; that includes the Timetable #3 proof PDF that anchors the mileage model.
`dist/` is the build; `gc-planner-site.zip` is the Netlify drag-and-drop bundle,
regenerated after each build.

## Known caveats

**Distances are partly derived, partly estimated — and the file says which.**
The mainline is **171 mi** Macon–Savannah, per Genesee & Wyoming's published figure
for the railroad (RailroadfanWiki says 174; the 211 figure quoted elsewhere is total
trackage including the Riceboro Southern and branches).

The schematic's printed mileposts run in two series and are not monotonic along the
line — Macon 5 and Dublin 54 increase eastward, while Vidalia 576, Collins 557.5,
Pooler 511, and Plastic Express 508 decrease eastward. So `STATIONS[].mile` holds
monotonic chainage from Macon and `mp` carries the printed milepost as a label only.
Using the printed mileposts as the axis would draw strings backwards through Vidalia.

Four segments fall straight out of the mileposts within their own series — Macon–Dublin
49.0, Vidalia–Collins 18.5, Collins–Pooler 46.5, Pooler–Plastic Express 3.0, totaling
117.0 mi. The remaining 54.0 mi covers the two gaps the mileposts can't span
(Dublin–Vidalia and Plastic Express–Savannah), split 49 / 5 to match the geography and
close the total.

Every station carries a `src` tag: `"mp"` for milepost-derived, `"est"` for inferred.
Estimated ones render with a `~` in the stringline gutter. **Four stations are soft —
Vidalia, Lyons, Magazine, Savannah** (Lyons and Magazine have no printed milepost at
all). A real track chart or employee timetable would only need to fix those four.

**Segment speeds default to 25 mph.** The operating plan gives on-duty and departure
times but no running times or track speeds. Computed arrivals are therefore plausible,
not authoritative. Set real speeds per segment in the trip dialog, or in the seed data.

**Restriction overlap is tested at segment departure time** (with a 4-hour lookback),
not integrated along the run as the window opens and closes. Adequate for planning;
revisit before anyone treats output as authoritative.

**Persistence is views-only.** The live plan is in memory; a reload restores the seed
plan. Saved views persist in this browser's localStorage and can be reloaded, but they
don't travel between machines.

## Scope boundary

This is a **planning and decision-support tool**. It shows a planner where the plan
puts two movements in conflict so a human can resolve it. It does not, and must not,
gate or authorize any movement.

Anything that acts on live position to permit or prevent a move is a different
artifact with a different assurance level. The two can share this geometry and even
share a screen, but the enforcing path has to be separately rated. The FRA/Volpe tool
drew this same line explicitly — its GPS feature was labeled *not appropriate for
safety-critical applications; supplements existing data, but is not adequate to
replace existing safety processes.* Keep that boundary deliberate rather than
drifting across it one feature request at a time.
