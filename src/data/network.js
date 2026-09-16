/**
 * Network and operating-plan data.
 *
 * This is the file to edit when the railroad changes. Everything else derives
 * from it. Times are minutes from midnight; distances are miles.
 *
 * DISTANCE MODEL — read this before trusting a slope.
 *
 * Anchored to Georgia Central Railway TIMETABLE #3 (eff. 2016-09-15), the
 * proof PDF in src/assets/brand/. The territory carries two milepost series:
 *
 *   Macon Sub    (increasing eastward):  Macon MP 0.0 -> Vidalia MP 92.3
 *   Savannah Sub (DECREASING eastward):  Vidalia MP 577.8 -> Savannah MP 499.0
 *
 * The subs meet at Vidalia: Macon MP 92.3 = Savannah MP 577.8, the same
 * physical point. A stringline needs one monotonic axis, so `mile` below is
 * chainage from Macon:
 *
 *   Macon Sub stations:     mile = MP
 *   Savannah Sub stations:  mile = 92.3 + (577.8 - MP)
 *
 * That conversion puts Savannah (MP 499.0) at 171.1 mi — matching G&W's
 * published 171-mile mainline. `mp` carries the timetable milepost as a
 * display label only; using printed MPs as the axis would draw strings
 * backwards through Vidalia.
 *
 * The June 2026 G&W deck (slide 9) prints rounded / schematic mileposts —
 * Dublin MP 54, Collins Siding 557.5, Pooler Siding 511, B&W Lead MP 5.
 * Those are NOT the station points used here; the timetable is. Do not
 * "correct" `mile` toward the slide.
 *
 * Each station is tagged `src` so soft numbers stay visible:
 *   "mp"  — straight from Timetable #3 (or, for Pooler / Plastic Express,
 *           the operating-plan schematic's MP anchored into the same series)
 *   "est" — inferred; the only one left is Magazine, placed by its bracket
 *           position on the operating-plan schematic. (The ETT's only
 *           "Magazine" is Magazine Avenue *inside Savannah Yard* — if the
 *           operating plan means that point, Magazine belongs at ~mile 170
 *           and the L782/Y120 routes read differently. Unresolved; confirm
 *           with the railroad before moving it.)
 */

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * `hold: true` marks places a movement can wait for an opposing train to
 * pass — a passing siding or a yard. Sidings per the TT#4 templates
 * (Macon + Savannah subs) and GO#3: Smithsonia (MP 4.7-5.2), Fitzpatrick
 * (15.6-16.0), Jeffersonville (23.0-23.2), West Dublin 6300' (49.5-50.8;
 * TT#3 said 5590'), Tarrytown 5100' (81.6-82.0), Collins 4400' (TT#4) or
 * 4750' (GO#3), Groveland 4224', Ellabell 4880', Meldrim 2820', Pooler
 * (MP 510.2-512.3 + crossovers, crew-usable), Plastic Express (ESS 507.4 /
 * WSS 508.4). Yards: Macon, Vidalia, Savannah. NOT hold points: Lyons
 * (yard limits eliminated) and Montrose (siding OUT OF SERVICE per GO#3
 * OSI - spiked and locked, even though the TT#4 draft still tables it).
 * East Dublin yard tracks (MP 57.0-57.4) sit inside the Dublin YL the
 * `dublin` station already covers. findOpenWindows() plans meets only at
 * these stations.
 */
export const STATIONS = [
  // `mpW` = the Savannah Sub milepost (the series westbound crews read,
  // counting DOWN from Vidalia 577.8 to Savannah 499.0). Reference data
  // only — not currently rendered.
  // Station roster per GC General Order #3 (eff. June 20 2026) and the
  // Timetable #4 template (2025, Savannah Sub) — the current sources of
  // truth, superseding Timetable #3 (2016).
  { id: "macon", name: "Macon", mp: "MP 0.0", mile: 0, src: "mp", hold: true },
  // Macon Sub sidings from the TT#4 template (Macon Sub) station table.
  { id: "smithsonia", name: "Smithsonia", mp: "MP 4.7", mile: 4.7, src: "mp", hold: true },
  // Agile Cold Storage — the Parallel origin customer. Lead switch at
  // MP 5.4 (TT#4 Macon switch list), inside the Macon YL. Routed as a
  // waypoint in every PS trip: the traffic runs Agile <-> Plastic
  // Express; Macon Yard is the charge base bracketing it. Not a hold
  // point (single customer lead, loading ops).
  { id: "agile", name: "Agile", mp: "MP 5.4", mile: 5.4, src: "mp" },
  { id: "fitzpatrick", name: "Fitzpatrick", mp: "MP 15.6", mile: 15.6, src: "mp", hold: true },
  { id: "jeffersonville", name: "Jeffersonville", mp: "MP 23.0", mile: 23, src: "mp", hold: true },
  // Montrose siding is OUT OF SERVICE per GO#3 OSI (spiked and locked) —
  // listed in the TT#4 draft's station table, but NOT a hold point.
  { id: "montrose", name: "Montrose", mp: "MP 37.4", mile: 37.4, src: "mp" },
  // Dudley house track, MP 42.0 (TT#4 Macon switch list) — the west end of
  // Y103's daily work out of Dublin (ops review, Sep 2026). A customer
  // spot, not a passing point.
  { id: "dudley", name: "Dudley", mp: "MP 42.0", mile: 42, src: "mp" },
  { id: "dublin", name: "Dublin", mp: "MP 49.5", mile: 49.5, src: "mp", hold: true },
  // Tarrytown siding 5100 ft (TT#4), MP 81.6-82.0.
  { id: "tarrytown", name: "Tarrytown", mp: "MP 81.6", mile: 81.6, src: "mp", hold: true },
  // Vidalia labels with its Savannah Sub milepost (ops preference) — the
  // station point is the yard/charge-track end at MP 575.6 = chainage 94.5.
  // Same physical spot also answers to Macon Sub MP 92.3 at the junction
  // proper (Savannah 577.8). TT#4 switch list places the yard tracks at
  // MP 575.9-576.3 and the engine track at 576.3.
  { id: "vidalia", name: "Vidalia", mp: "MP 575.6", mpW: "577.8", mile: 94.5, src: "mp", hold: true },
  // Lyons Shop siding switches at MP 569.1/569.5 (GO#3) — shop lead, not
  // a passing point; Lyons itself carries no yard limits and no siding.
  { id: "lyons", name: "Lyons", mp: "MP 568.0", mpW: "568.0", mile: 102.1, src: "mp" },
  // Collins siding: GO#3 station table says 4750 ft, the TT#4 template
  // says 4400 ft — carry the discrepancy until TT#4 issues.
  { id: "collins", name: "Collins", mp: "MP 556.6", mpW: "556.6", mile: 113.5, src: "mp", hold: true },
  // Bellville and Hagan: in the TT#4 station table (no siding footage, no
  // timetable characters; E/W switch pairs ~0.4-0.5 mi apart). Listed for
  // fidelity to the source; not hold points.
  { id: "bellville", name: "Bellville", mp: "MP 548.5", mpW: "548.5", mile: 121.6, src: "mp" },
  { id: "hagan", name: "Hagan", mp: "MP 547.3", mpW: "547.3", mile: 122.8, src: "mp" },
  { id: "groveland", name: "Groveland", mp: "MP 535.0", mpW: "535.0", mile: 135.1, src: "mp", hold: true },
  { id: "magazine", name: "Magazine", mp: "—", mile: 141.5, src: "est" },
  // Ellabell — NEW in GO#3/TT#4: 4880 ft siding (longest on the sub),
  // switches MP 519.7/520.7, inside the Savannah yard limits.
  { id: "ellabell", name: "Ellabell", mp: "MP 519.7", mpW: "519.7", mile: 150.4, src: "mp", hold: true },
  { id: "meldrim", name: "Meldrim", mp: "MP 513.9", mpW: "513.9", mile: 156.2, src: "mp", hold: true },
  // Pooler — now a real SIDING, MP 510.2-512.3 with crossovers at 511.15
  // and 511.45 (GO#3/TT#4; OSI: "available for use by transportation
  // crews", derails in place, crossovers normal when not in use). Station
  // point is the EE siding switch, MP 510.2.
  { id: "pooler", name: "Pooler", mp: "MP 510.2", mpW: "510.2", mile: 159.9, src: "mp", hold: true },
  // Plastic Express is a switch-confirmed siding in GO#3: ESS MP 507.4 /
  // WSS MP 508.4. Station point mid-siding. The yard holds more than one
  // consist (Parallel ops, Aug 2026), so it is a hold point; the CHARGER
  // is still singular — schedule charge starts >= ~100 min apart.
  { id: "plastic", name: "Plastic Express", mp: "MP 508", mpW: "508", mile: 162.1, src: "mp", hold: true },
  { id: "savannah", name: "Savannah", mp: "MP 499.0", mpW: "499.0", mile: 171.1, src: "mp", hold: true },
];

/** Mainline length, Macon to Savannah, from the Timetable #3 conversion. */
export const TOTAL_MI = 171.1;

/** Look up a station by id. Falls back to the west end rather than throwing. */
export const ST = (id) => STATIONS.find((s) => s.id === id) || STATIONS[0];

/**
 * Main track switch locations — every switch the current documents list,
 * Macon Sub from the TT#4 template (Macon Sub), Savannah Sub from GC
 * General Order #3 (matching the TT#4 Savannah template). The corridor
 * between Agile (MP 5.4) and Plastic Express (ESS 507.4 / WSS 508.4) is
 * the Parallel operating environment: hand-throw switch operations are a
 * Parallel utility-person responsibility, so where the switches are IS
 * operating knowledge. `mp` is the printed milepost; `mile` (chainage)
 * is COMPUTED from it, never hand-converted. Flags: `oos` = out of
 * service per GO#3 Other Specific Instructions.
 * Source discrepancies carried, not resolved: W Tarrytown prints 81.6 in
 * TT#4 (and TT#3) but 81.2 in GO#3; MP 532.6 is "Midsouth Aggregates" in
 * TT#4 but "Southern Metals" in GO#3. Dry Branch (MP 8.9/9.2) is dropped
 * from both current switch lists (lead OOS, private locks).
 */
const SW = (mp, name, sub, oos = false) => ({
  mp,
  name,
  mile: sub === "sav" ? +(92.3 + (577.8 - mp)).toFixed(2) : mp,
  oos,
});
export const SWITCHES = [
  // Macon Sub (TT#4 template switch list)
  SW(4.7, "WE Smithsonia", "mac"), SW(5.2, "EE Smithsonia", "mac"),
  SW(5.4, "Agile Lead", "mac"), SW(5.9, "Saddle Creek Lead", "mac"),
  SW(15.6, "WE Fitzpatrick", "mac"), SW(16.0, "EE Fitzpatrick", "mac"),
  SW(23.0, "WE Jeffersonville", "mac"), SW(23.2, "EE Jeffersonville", "mac"),
  SW(37.4, "WE Montrose", "mac", true), SW(37.6, "EE Montrose", "mac", true),
  SW(40.9, "WE Gilman", "mac"), SW(41.2, "EE Gilman", "mac"),
  SW(42.0, "Dudley House Track", "mac"),
  SW(49.5, "WE West Dublin", "mac"), SW(50.8, "EE West Dublin", "mac"),
  SW(51.4, "Sunpet", "mac"),
  SW(53.5, "WE Dublin Engine Track", "mac"), SW(53.7, "EE Dublin Engine Track", "mac"),
  SW(54.0, "Dublin Construction", "mac"),
  SW(57.0, "WE East Dublin", "mac"), SW(57.2, "Mohawk Lead", "mac"),
  SW(57.4, "EE East Dublin", "mac"), SW(57.4, "Westrock Lead", "mac"),
  SW(57.7, "WE Brunswick Chip", "mac"), SW(58.1, "EE Brunswick Chip", "mac"),
  SW(73.9, "Gen Fiber", "mac"),
  SW(75.1, "WE Runaround", "mac"), SW(75.2, "EE Runaround", "mac"),
  SW(79.3, "East Coast Asphalt", "mac"),
  SW(81.6, "WE Tarrytown", "mac"), SW(82.0, "EE Tarrytown", "mac"),
  SW(91.9, "Wye Track", "mac"), SW(92.3, "HOG Lead", "mac"),
  // Savannah Sub (GO#3 revised list; chainage = 92.3 + (577.8 - MP))
  SW(576.8, "CityLine/Midville", "sav"),
  SW(576.3, "Vidalia Engine Track", "sav"), SW(576.3, "WE Vidalia Track 1", "sav"),
  SW(576.2, "WE Vidalia Yard", "sav"), SW(576.0, "EE Vidalia Yard", "sav"),
  SW(575.9, "EE Vidalia Track 1", "sav"),
  SW(569.5, "WSS Lyons Shop", "sav"), SW(569.1, "ESS Lyons Shop", "sav"),
  SW(557.5, "WSS Collins", "sav"), SW(556.6, "ESS Collins", "sav"),
  SW(548.9, "W Bellville", "sav"), SW(548.5, "E Bellville", "sav"),
  SW(547.85, "Hagan Industrial", "sav"), SW(547.8, "W Hagan", "sav"), SW(547.3, "E Hagan", "sav"),
  SW(535.9, "WSS Groveland", "sav"), SW(535.0, "ESS Groveland", "sav"),
  SW(532.6, "Midsouth Aggregates", "sav"),
  SW(524.6, "W Global", "sav"), SW(524.3, "E Global", "sav"),
  SW(520.7, "WSS Ellabell", "sav"), SW(519.7, "ESS Ellabell", "sav"),
  SW(518.1, "WE Aggregates USA", "sav"), SW(517.3, "EE Aggregates USA", "sav"),
  SW(516.9, "WE Hyundai Wye", "sav"), SW(516.6, "EE Hyundai Wye", "sav"),
  SW(514.8, "SMT Industry", "sav"), SW(514.5, "WSS Meldrim", "sav"),
  SW(514.1, "Interfor", "sav"), SW(513.9, "ESS Meldrim", "sav"),
  SW(512.9, "Faulkville Lead", "sav"),
  SW(512.3, "WE Pooler Siding", "sav"),
  SW(511.45, "Pooler Crossover #4", "sav"), SW(511.15, "Pooler Crossover #1", "sav"),
  SW(510.2, "EE Pooler Siding", "sav"),
  SW(508.4, "WSS Plastic Express", "sav"), SW(507.4, "ESS Plastic Express", "sav"),
  SW(504.9, "Heniff", "sav"), SW(504.1, "Mitsubishi", "sav"),
  SW(501.3, "WE DSI", "sav"), SW(501.0, "EE DSI", "sav"),
];

/**
 * Yard limits per GC General Order #3 (eff. June 20 2026), which formally
 * revises Timetable #3 — the same boundaries the June 2026 presentation
 * showed, now in an operative document. Macon YL to MP 6, Savannah YL to
 * MP 521.5 (covering Meldrim / Pooler / Ellabell / Plastic Express),
 * Lyons YL eliminated, Vidalia YL spans both subs (Macon MP 91.3 to
 * Savannah MP 575.6).
 */
export const YARD_LIMITS = [
  { id: "yl-mac", label: "Macon", a: 0, b: 6 },
  { id: "yl-dub", label: "Dublin", a: 49, b: 58.6 },
  { id: "yl-vid", label: "Vidalia", a: 91.3, b: 94.5 },
  { id: "yl-col", label: "Collins", a: 112.1, b: 114.1 },
  { id: "yl-sav", label: "Savannah", a: 148.6, b: 171.1 },
];

/**
 * Maximum authorized speeds per GC General Order #3 (eff. June 20 2026),
 * the operative revision of Timetable #3, matching the TT#4 template —
 * ALL trains, Parallel included, plan on this table. GO#3 RESOLVES the
 * old open question: the 20 MPH tiers inside the extended yard limits
 * (Macon MP 2-6, Savannah MP 504-521.5) are printed as MAXIMUM SPEEDS in
 * the order itself — official track speed, not presentation shorthand.
 * The 2016 10-MPH pockets (MP 75.9-77.0, Old Scales, 544.8-546.5, Lyons
 * Yard 568-571, 573.6-575.6) are formally gone. Converted to chainage.
 * computeTrip() integrates a leg's run time across these zones; a trip's
 * own waypoint speed caps from above, never raises.
 *
 * Not modeled (advisory notes, from GO#3/TT#4 Other Specific
 * Instructions) — point restrictions, not zones; carry a few minutes
 * of slack per trip for them:
 *   - Macon Sub MP 57.5, SR 199 crossing at the Westrock Lead
 *     (DOT# 641038R), inside Dublin YL: EB approach max 5 MPH, WB max
 *     10 MPH — crossed EVERY trip, both directions.
 *   - EB moves approach Broadfoot Blvd (MP 575.8) and Thompson St
 *     (MP 576.7) inside Vidalia YL at max 5 MPH; stop-and-proceed at
 *     the Hwy 297 (Vidalia Yard) and Brinson Rd (MP 577.3)
 *     island-circuit crossings.
 * Speed changes are also instantaneous (no accel/decel ramps — the
 * workbook DRIVE CYCLE carries the kinematics). Verify against the
 * current DOB before treating an arrival as authoritative.
 */
export const SPEED_LIMITS = [
  // Macon Sub (MP = chainage)
  { a: 0, b: 2, mph: 10 }, // Macon yard
  { a: 2, b: 6, mph: 20 },
  { a: 6, b: 49, mph: 25 },
  { a: 49, b: 58.6, mph: 10 }, // Dublin Yard
  { a: 58.6, b: 91.3, mph: 25 },
  { a: 91.3, b: 92.3, mph: 10 }, // Vidalia approach
  // Savannah Sub (chainage = 92.3 + (577.8 - MP))
  { a: 92.3, b: 94.5, mph: 10 }, // Vidalia (MP 577.8-575.6)
  { a: 94.5, b: 112.1, mph: 25 }, // MP 575.6-558
  { a: 112.1, b: 114.1, mph: 10 }, // Collins Yard (MP 558-556)
  { a: 114.1, b: 148.6, mph: 25 }, // MP 556-521.5
  // GO#3 prints MP 504-521.5 as four contiguous 20 MPH rows (504-507.2 /
  // 507.2-507.8 / 507.8-517 / 517-521.5 Ellabell Yard) — one zone here
  // since the value never changes across them.
  { a: 148.6, b: 166.1, mph: 20 }, // MP 521.5-504 (Savannah YL)
  { a: 166.1, b: 171.1, mph: 10 }, // Savannah (MP 504-499)
];

/**
 * RETIRED (kept for reference / easy re-enable): the Aug 2026 "plan all
 * yard limits at 10" table, from verbal ops guidance that predated GO#3.
 * GO#3 settled the question — 20 MPH in the extended YLs is the official
 * maximum — so TYPES.parallel no longer sets yl10 and the fleet plans on
 * SPEED_LIMITS. To restore conservative planning, set yl10: true on the
 * parallel type and re-run the departure scan.
 */
export const YL10_SPEED_LIMITS = [
  { a: 0, b: 6, mph: 10 }, // Macon YL
  { a: 6, b: 49, mph: 25 },
  { a: 49, b: 58.6, mph: 10 }, // Dublin Yard
  { a: 58.6, b: 91.3, mph: 25 },
  { a: 91.3, b: 92.3, mph: 10 }, // Vidalia approach
  { a: 92.3, b: 94.5, mph: 10 }, // Vidalia
  { a: 94.5, b: 112.1, mph: 25 },
  { a: 112.1, b: 114.1, mph: 10 }, // Collins Yard
  { a: 114.1, b: 148.6, mph: 25 },
  { a: 148.6, b: 171.1, mph: 10 }, // Savannah YL (authorized shows 20 to MP 504)
];

/**
 * Job types. `moves: true` means line-of-road movement — drawn as a sloped
 * string, included in meet detection and slot scans. Types without it work
 * one location and draw an occupancy bar. Components key off `moves`, so a
 * new kind of movement only needs an entry here.
 */
export const TYPES = {
  road: { label: "Road train", color: "#1e40af", moves: true },
  // yl10 (off since GO#3 confirmed the 20 MPH tiers): set yl10: true to
  // plan Parallel consists on YL10_SPEED_LIMITS instead of SPEED_LIMITS.
  parallel: { label: "Parallel consist", color: "#7c3aed", moves: true },
  local: { label: "Local", color: "#15803d" },
  yard: { label: "Yard / interchange", color: "#b45309" },
  mow: { label: "MOW", color: "#7c2d12" },
};

/** Waypoint helper. `speed` is the speed LEAVING this waypoint, in mph.
 *  A stop may also carry `block: true` — the train stands on the MAIN
 *  there (not in the siding/yard), so the dwell draws solid and is a
 *  conflict, not a pass, for anything crossing it — and `as: "L782R"`, a
 *  crew change: the same train continues under that symbol. */
export const wp = (st, speed = 25, stop = false, dwell = 0) => ({ st, speed, stop, dwell });

/**
 * Seed trips, from the Jobs by Location and Route Scheduling slides.
 *
 * NOTE ON SPEEDS: a waypoint's `speed` is the speed the TRIP asks for leaving
 * that waypoint; the track's SPEED_LIMITS cap it zone by zone, so the default
 * 25 means "as fast as the track allows, up to 25". The operating plan gives
 * on-duty and departure times but no running times — arrivals are computed
 * from the 2016 timetable speeds and are plausible, not authoritative.
 */
export const SEED_TRIPS = [
  {
    // G&W meeting (Aug 2026): Y104 is BASED at Savannah (CSX interchange,
    // the on-duty point from the Jobs-by-Location slide) but WORKS the
    // territory from the Pooler siding to the end of the railroad,
    // passing Plastic Express twice a day. `territory` draws that range
    // as a band on the stringline — a single-station bar under-represents
    // where this job actually is.
    id: "t1", symbol: "Y104", note: "Interchange with CSX — based Savannah, works Pooler siding to end of RR (passes PX 2x/day)",
    type: "yard", days: [0, 1, 2, 3, 4, 5], time: 330, work: 450, range: { w: "pooler", e: null },
    waypoints: [wp("savannah")],
  },
  {
    // Y115 — named in the June 2026 presentation, confirmed at the Aug
    // 2026 meeting: works the same Pooler <-> end-of-RR territory as
    // Y104, passing Plastic Express twice a day. WE HAVE NO SOURCE FOR
    // WHEN IT WORKS (ops review, Sep 2026): base point and hours below
    // simply mirror Y104. `unsourced: true` draws it as a hollow
    // placeholder bar, not a scheduled job, so nobody plans a PX charge
    // around hours G&W never gave us. Replace when G&W provides them.
    id: "t1b", symbol: "Y115", note: "Works Pooler siding to end of RR (passes PX 2x/day) — NO SOURCE for hours; placeholder mirrors Y104",
    type: "yard", days: [1, 2, 3, 4, 5], time: 330, work: 450, range: { w: "pooler", e: null }, unsourced: true,
    waypoints: [wp("savannah")],
  },
  {
    // Ops review (Sep 2026): Y103 ranges WEST of Dublin to the Dudley
    // house track (MP 42) — `range.w` draws that reach. The G&W deck also
    // brackets it EAST toward the East Dublin industries (MP 57-58); there
    // is no station there yet, so the east side is unset.
    id: "t2", symbol: "Y103", note: "Work local customers around Dublin — ranges west to Dudley (MP 42)",
    type: "local", days: [1, 2, 3, 4, 5], time: 360, work: 480, range: { w: "dudley", e: null },
    waypoints: [wp("dublin")],
  },
  {
    id: "t3", symbol: "MOW", note: "Working various locations across GC",
    type: "mow", days: [1, 2, 3, 4, 5], time: 390, work: 510,
    waypoints: [wp("dublin")],
  },
  {
    // G&W meeting (Aug 2026): Y204 switches WITHIN Vidalia yard, only
    // going beyond when there is a work train — relocated from Lyons.
    id: "t4", symbol: "Y204", note: "Switching within Vidalia yard",
    type: "local", days: [1, 2, 3, 4, 5], time: 420, work: 510,
    waypoints: [wp("vidalia")],
  },
  {
    // Ops review (Sep 2026): Y101 works the Macon YL out to the Agile
    // lead (MP 5.4) — the same lead the Parallel consists load on, so
    // the band matters for PS departure/return planning at Agile.
    id: "t5", symbol: "Y101", note: "Interchange with NS & work local customers — works out to Agile (MP 5.4)",
    type: "yard", days: [1, 2, 3, 4, 5], time: 480, work: 420, range: { w: null, e: "agile" },
    waypoints: [wp("macon")],
  },
  {
    id: "t8", symbol: "L782", note: "Roundtrip Magazine to Pooler",
    type: "road", days: [0, 1, 2, 3, 4], time: 960,
    waypoints: [wp("magazine"), wp("pooler", 25, true, 60), wp("magazine")],
  },
  {
    // CONTIGUOUS TRAIN (G&W, Sep 2026). The Pooler-to-Collins evening job
    // (Y120, on duty 18:00) brings the train to Collins ~20:00 and ties
    // down; the L782R day crew takes THE SAME TRAIN out at 09:00 for
    // Collins-Vidalia-Dublin-Macon. Modeled as one trip so the overnight
    // stand at Collins shows on the chart instead of vanishing between two
    // separate jobs. ASSUMPTION: this train, the first to arrive, is in
    // the Collins SIDING (dashed — in the clear); L781's, arriving second at
    // 23:33, is on the MAIN. G&W has not said which is which; flip `block`
    // on the two Collins stops if they tell us otherwise. Either way both
    // tracks are occupied 23:33-06:30.
    // L782R leg: Dublin ~1 h (Joe/Rob, Sep 2026); only the confirmed stops
    // (Vidalia ~1 h, Dublin ~1 h) are modeled and the run computes to Macon
    // 16:33. The ~1.5 h between that and the reported ~18:00 is carried as
    // a TOLERANCE anchor on the Macon waypoint (see lib/schedule.js), and the
    // Collins crew change resets the band, so it grows FROM the fixed 09:00
    // Collins departure: a ribbon widening to an 85-min-late edge at Macon
    // (17:58 — just clear of L781's 18:00 departure from the same yard).
    // We used to park that time as short "phantom" stops at Tarrytown,
    // Jeffersonville, and Fitzpatrick; those drew dashed — the chart's
    // convention for "in the clear" — and meet detection treated every
    // crossing through them as a planned siding pass, i.e. the tool was
    // asserting a clearance nobody had confirmed. The ribbon says only
    // what is known: L782R is somewhere in this band, main NOT assumed
    // clear. Planning consequence stands: DO NOT count on a 2-hour
    // passing window at Dublin, and a road train working a customer
    // lead can still block the main (Joe's warning).
    id: "t9", symbol: "Y120", note: "Pooler to Collins 18:00; the train stands at Collins overnight (siding) and goes on at 09:00 as L782R to Macon — Dublin ~1 h; Macon 16:33 nominal, ~18:00 at the late edge",
    type: "road", days: [0, 1, 2, 3, 4], time: 1080,
    waypoints: [
      wp("pooler"),
      wp("magazine"),
      { ...wp("collins", 25, true, 780), as: "L782R" }, // 20:00 -> 09:00 next day, in the siding; leaves as L782R
      wp("vidalia", 25, true, 60),
      wp("dublin", 25, true, 60),
      // the tolerance anchor: by Macon L782R may be 85 late; the band grows
      // from the fixed 09:00 Collins departure (crew change = reset)
      { ...wp("macon"), tol: { early: 0, late: 85 } },
    ],
  },
  {
    // CONTIGUOUS TRAIN (G&W, Sep 2026): L781 leaves Macon 18:00, reaches
    // Collins 23:33 and ties down; the L781R day crew takes the same train
    // on to Pooler at 06:30. Modeled WITHOUT en-route work (slides give
    // start times only). `block: true` on the Collins stop: this train is
    // the SECOND to arrive and stands on the MAIN (assumption — see
    // Y120 → L782R above), so the stop draws SOLID, and meet detection treats
    // any movement through Collins 23:33-06:30 as a conflict, not a pass.
    // G&W's point (Joe Underwood, Sep 2026): Collins has two tracks, both
    // are occupied overnight, so nothing gets through until the day crews
    // come on. That busts any Parallel departure that reaches Collins
    // between ~23:30 and 06:30 — including the Night plan of record
    // (eastbound parade at Collins 04:53-06:03). Revisit after the site
    // visit.
    id: "t10", symbol: "L781", note: "Macon to Collins 18:00; the train stands on the Collins MAIN overnight and goes on at 06:30 as L781R to Pooler",
    type: "road", days: [0, 1, 2, 3, 4], time: 1080,
    waypoints: [
      wp("macon"),
      wp("dublin"),
      wp("vidalia"),
      { ...wp("collins", 25, true, 417), block: true, as: "L781R" }, // 23:33 -> 06:30 next day, ON THE MAIN; leaves as L781R
      wp("magazine"),
      wp("pooler"),
    ],
  },

  /**
   * Parallel consists PSYX0002/0003/0005, shorthand PS2/PS3/PS5 — Agile Cold
   * Storage (Macon end) to Pooler, then Plastic Express (MP 508) to charge,
   * and back empty. Runs the track limit (25 mph waypoint speed; zones cap).
   *
   * WORKING PLAN (Aug 2026, re-based on GO#3 speeds + meeting facts):
   * 120 kW charging with TWO charge positions per site — four 60 kW
   * chargers per site, paired 2x60=120 (Macon, Vidalia yard/engine
   * track MP 576.3, Plastic Express; G&W confirmed 4 chargers/site with
   * 2 more purchasable). NOTE the "Loco Shop" is actually near LYONS
   * (shop switches MP 569.1/569.5) — Vidalia charging is on Vidalia's
   * own yard/engine track, off the main either way. Vidalia's mainline
   * switches are normally lined for the Sav-Macon route (Joe, Aug 2026)
   * — we throw them only for charge moves. Departures Mon-Fri, weekend
   * dark (Agile ships M-F; Friday's returns tie down Saturday morning).
   * All trains plan on the GO#3 authorized speeds — the Aug 2026 YL=10
   * detour is retired (GO#3 prints 20 MPH in the extended yard limits
   * as official maximum speed; see SPEED_LIMITS). The user's 40-min
   * PS5 lead gap spaces the returns — the westbound parade passes
   * Pooler 25 / 45 min apart, no unit standing at Plastic to
   * manufacture space.
   *
   * Charge legs: Vidalia EB dwell 75 (45 charge + 15+15 track moves —
   * yard/engine track, OFF the main; drawn dashed), Plastic Express 82 min
   * of charge (banks the empty return — the workbook ledger sizes it as
   * the 162.1 kWh empty return EXACTLY, so it cannot be trimmed without
   * breaching the floor), Macon top-up ~120. Pack 265 kWh, 10% floor.
   * The Vidalia charge is 45 min, not the rounded 43, ON PURPOSE: 43
   * lands PS3 at Plastic 0.3 kWh above the reserve floor; 45 buys 4.3.
   *
   * Two bays: PS5+PS2 charge together, PS3 takes the bay PS5 frees
   * (~12 min wait after re-lining, off the main). Back at Macon
   * 09:22 / 09:47 / 10:44; topped up by ~11:22 / ~11:47 / ~13:22.
   *
   * ZERO flagged crossings all 7 days, ZERO holds on the main, ZERO
   * staffed siding switches. Margins: Macon 37 min behind L782R
   * (1433 -> 1510), Vidalia charge track clear 25 min before L781
   * passes (2217 vs 2242), returns clear Collins 79+ min before L781R
   * (PS3 0511 vs 0630). NEW OPTION from GO#3: the Pooler siding
   * (MP 510.2-512.3, crossovers, crew-usable per OSI) and the 4880-ft
   * Ellabell siding are hold points inside the Savannah YL if a late
   * day ever needs one.
   *
   * NIGHT (2205/2245/2315) IS VIABLE AGAIN under GO#3 speeds — the
   * YL=10 assumption was what killed it. Zero crossings, whole week,
   * re-verified with the current dwells.
   *
   * FALLBACKS (verified under the same authorized speeds GO#3 now
   * makes official): 3x100 kW/site -> 1530/1600/1630 all-parallel;
   * 1x100 kW/site -> 1650/1855/2105 with 60 min/day of siding holds;
   * 80 kW -> 1600/1815/2030 with one Macon yard-limits pass. If a unit
   * drops out, the remaining two run unchanged.
   */
  // Plastic Express dwells carry the hand-throw switches at the PX
  // siding ends (ESS MP 507.4 / WSS MP 508.4 per GO#3; still no charge
  // stop at Pooler): PS5 lines the lead (+15), PS2 follows through the
  // lined switch 40 min behind, PS3 re-lines it on arrival (~15) and
  // waits ~12 min for the bay PS5 frees, so its 109 = 15 re-line +
  // 12 wait + 82 charge, ending exactly at departure.
  // Seed times are the NIGHT pattern (22:05/22:45/23:15) — the working
  // recommendation since the Aug 2026 meeting moved L782R's Macon arrival
  // to ~18:00, which the afternoon slot cannot clear without open-ended
  // siding holds (see PS_SCHEDULES / PS_PATTERNS). The Pattern selector in
  // the Parallel panel swaps patterns.
  ...[
    ["t11", "PS5", "PSYX0005", 1325, 75, 97, "lead — incl. 15 min lining the PX switch"],
    ["t12", "PS2", "PSYX0002", 1365, 75, 82, "2nd — follows PS5 through the lined switch"],
    ["t13", "PS3", "PSYX0003", 1395, 75, 109, "3rd — re-lines the switch + waits for a freed charger"],
  ].map(([id, symbol, mark, time, vidaliaDwell, plasticDwell, phase]) => ({
    id, symbol, note: `${mark} — Agile (Macon) to Pooler / Plastic Express turn (${phase}, Mon-Fri)`,
    type: "parallel", days: [1, 2, 3, 4, 5], time,
    waypoints: [
      // Agile (MP 5.4) is the pickup/traffic origin; the trip anchors at
      // the Macon Yard charge base that brackets it. Zero time impact —
      // Agile sits on the path — but its passing times now print in the
      // timetable and gutter.
      wp("macon", 25), wp("agile", 25), wp("dublin", 25), wp("vidalia", 25, true, vidaliaDwell), wp("lyons", 25), wp("collins", 25),
      wp("groveland", 25), wp("magazine", 25), wp("meldrim", 25),
      // no charge stop at Pooler; the switch work happens at Plastic
      // Express, inside the PX dwells below
      wp("pooler", 25),
      wp("plastic", 25, true, plasticDwell),
      wp("meldrim", 25), wp("magazine", 25), wp("groveland", 25),
      wp("collins", 25), wp("lyons", 25), wp("vidalia", 25), wp("dublin", 25), wp("agile", 25), wp("macon", 25),
    ],
  })),
];

/**
 * No restrictions ship with the plan — every input is sourced. Real slow
 * orders come from the dispatcher's Daily Operating Bulletins and are entered
 * through the + Restriction dialog as issued (which also makes a good live
 * demo of the re-computation).
 */
export const SEED_RESTRICTIONS = [];

/**
 * The two verified departure patterns for the Parallel fleet — both zero
 * meets, zero holds, whole-week checked. AFTERNOON is the recommended plan
 * (largest G&W margins; out of Plastic Express before its trucker gate
 * opens). NIGHT delivers straight into the trucker window (containers on
 * trucks by ~08:00, nothing waits) at the cost of a standing 21-min
 * separation to L781R at Pooler (31 min if shifted 10 min earlier) and
 * charging at Plastic during their morning. Cycle view windows are framed
 * per schedule: open just after L782R clears into Macon (afternoon) or
 * just before the parade departs (night), and close before the next
 * day's first departure.
 */
export const PS_SCHEDULES = {
  // Afternoon = 12:20/13:00/13:30 — FALLBACK, NOW CONFLICTED (Sep 2026):
  // it was verified against a 2.5-hour L782R Dublin stop (13:23-15:50),
  // inside which all three units passed in yard limits. With the Dublin
  // stop corrected to ~1 hour (13:23-14:23) and the rest of L782R's
  // lateness carried as a tolerance ribbon, all three units now cross it
  // on the road WEST of Dublin (~14:27 / ~14:47 / ~15:03) — the planner
  // flags all three, plus a possible meet at the ribbon's late edge. The
  // pattern is kept as a what-if; it is not a plan until re-timed against
  // real L782R work times. Original notes: all three units pass L782R at
  // Dublin, then the Vidalia dwell extends to 130 (45 charge
  // + standing, off the main, cycle-free) to let L782/Y120's evening
  // runs clear. Zero crossings whole week; PX 22:10-01:09; Macon
  // returns 07:27-08:49; departs Vidalia ~2h20 ahead of L781.
  // CONDITIONS before adopting: (1) confirm L782R's REAL Dublin work
  // window with G&W — ours is a calibrated estimate, the viable
  // departure band is only ~11:30-12:20, and PS3's pass lands 10 min
  // before L782R's modeled departure; (2) accept a pass at their work
  // site (Joe's block-the-main caveat); (3) PX unloads overnight again;
  // (4) Agile loading must finish by ~noon.
  afternoon: { times: { t11: 740, t12: 780, t13: 810 }, vidaliaDwell: 130, cycleWin: [700, 2190] },
  // Night = 22:05/22:45/23:15 — PLAN OF RECORD & default, BUT FLAGGED
  // (Sep 2026): it was clean under GO#3 speeds (window 21:55-22:35, clean
  // of L782R, PX charge 07:00-09:59). G&W then pointed out that BOTH
  // Collins tracks are occupied overnight by the tied-down L781 and Y120
  // trains (23:33-06:30, waiting for the L781R / L782R day crews). The
  // eastbound parade reaches Collins 04:53 / 05:33 / 06:03 — inside that
  // window — so the planner now shows three meets at Collins every night.
  // The plan of record is to be revisited after the Sep 2026 site visit;
  // see the built-in "Feedback" view (data/presets.js).
  night: { times: { t11: 1325, t12: 1365, t13: 1395 }, vidaliaDwell: 75, cycleWin: [1280, 2760] },
};

/**
 * Parallel fleet PATTERNS — how the vehicles run. One selector in the
 * Parallel panel; picking one rewrites the seed units' departure, route,
 * and note, and decides which units are part of the plan (`units`). The
 * seed trips ARE the three-unit Night pattern; the others are built here.
 *
 * All timings verified with the slot scan against the G&W baseline WITH the
 * Collins overnight stand (L781 on the main 23:33-06:30, Y120's train in
 * the siding to 09:00) and L782R's tolerance ribbon, Sep 15 2026. Charge
 * dwells: Vidalia 75 (45 charge + track moves), Plastic Express 82.
 *
 *  two          One unit east out of Macon 05:30 (Vidalia 10:12-11:27
 *               charge, Collins 12:18, PX 14:25), a different unit west out
 *               of PX 19:00 already charged for the whole run (Collins
 *               21:07, Macon 03:40). NO charge on the return — but it still
 *               has to get past L781, which is on the road Macon-Collins
 *               18:00-23:33 every evening: no nonstop westbound departure
 *               clears it (scan, Sep 15 2026). So the return WAITS in
 *               Vidalia yard 21:58-22:58 while L781 passes at 22:42 (44 min
 *               before, 16 after; the geometric minimum is 45 min of wait,
 *               60 carries the hand-throw buffer). Zero meets, zero
 *               possible meets, all week. Eastbound departures are clean
 *               04:00-06:00. G&W caveats: the eastbound Vidalia charge shares
 *               the yard with L782R's stop (09:51-10:51), and the evening
 *               wait is a planned pass at Vidalia.
 *  oneLayover   The same cycle as ONE unit: reach PX 14:25, stay on the
 *               charger, leave 19:00, wait out L781 at Vidalia, back at
 *               Macon 03:40 — 110 min before the next 05:30 departure (plan
 *               budgets ~120 for the Macon top-up).
 *  oneFast      One unit, quick turn: Macon 04:15, PX 13:10-14:32 (82
 *               charge), back through Collins 16:39, a PLANNED 30-min hold
 *               in the Dublin siding while L781 passes ~20:06, Macon ~22:45.
 *               Departures 04:10-04:20 work; by 04:25 the hold no longer
 *               fits. Zero meets/possible meets; 10 min of hold is the
 *               geometric minimum, 30 gives the hand-throw buffer.
 *  night        Three units 22:05/22:45/23:15 — former plan of record,
 *               FLAGGED: the parade reaches Collins 04:53-06:03 inside the
 *               overnight stand. Three meets every night.
 *  afternoon    Three units 12:20/13:00/13:30 — CONFLICTED: crosses L782R
 *               on the road west of Dublin.
 */
const PS_EAST = (vidalia = 75, plastic = 0) => [
  wp("macon"), wp("agile"), wp("dublin"), wp("vidalia", 25, true, vidalia), wp("lyons"), wp("collins"),
  wp("groveland"), wp("magazine"), wp("meldrim"), wp("pooler"), plastic ? wp("plastic", 25, true, plastic) : wp("plastic"),
];
// west: `vidalia` minutes at Vidalia is a WAIT for L781 (in the yard, off the
// main), not a charge — the unit left Plastic Express charged for the run
const PS_WEST = (vidalia = 75, dublinHold = 0) => [
  wp("plastic"), wp("pooler"), wp("meldrim"), wp("magazine"), wp("groveland"), wp("collins"), wp("lyons"),
  wp("vidalia", 25, true, vidalia), dublinHold ? wp("dublin", 25, true, dublinHold) : wp("dublin"), wp("agile"), wp("macon"),
];
const PS_ROUND = (time, plastic, vidaliaWB, dublinHold) => ({
  time,
  waypoints: [...PS_EAST(75, plastic), ...PS_WEST(vidaliaWB, dublinHold).slice(1)],
});
const threeUnits = (times, vidaliaDwell) =>
  Object.fromEntries(
    SEED_TRIPS.filter((t) => t.type === "parallel").map((t) => [
      t.id,
      { time: times[t.id], waypoints: t.waypoints.map((w) => (w.st === "vidalia" && w.stop ? { ...w, dwell: vidaliaDwell } : w)), note: t.note },
    ])
  );
export const PS_PATTERNS = {
  two: {
    label: "Two vehicles", short: "2 units", status: "clean",
    note: "East from Macon 05:30, a second unit west from Plastic Express 19:00. Waits at Vidalia for L781.",
    caveat: "The return is charged at PX and does not charge again, but no evening westbound clears L781 (on the road Macon–Collins 18:00–23:33), so it waits in Vidalia yard 21:58–22:58 while L781 passes at 22:42. No meets flagged in the model; G&W still has to accept that pass, and the eastbound Vidalia charge shares the yard with L782R 10:12–10:51. G&W's slide times are job starts, not departures.",
    units: ["t12", "t11"], cycleWin: [240, 1680],
    trips: {
      t12: { time: 330, waypoints: PS_EAST(75), note: "PSYX0002 — east: Macon 05:30, charge Vidalia 10:12–11:27, Collins 12:18, Plastic Express 14:25" },
      t11: { time: 1140, waypoints: PS_WEST(60), note: "PSYX0005 — west, charged at PX: Plastic Express 19:00, Collins 21:07, waits in Vidalia yard 21:58–22:58 for L781 (passes 22:42), no charge, Macon 03:40" },
    },
  },
  oneLayover: {
    label: "One vehicle — layover at PX", short: "1 unit · layover", status: "clean",
    note: "One unit, out 05:30, home 03:40 after a layover at Plastic Express.",
    caveat: "Same cycle as the two-unit pattern run by one vehicle: Plastic Express 14:25–19:00 on the charger, waits in Vidalia yard 21:58–22:58 for L781, Macon 03:40 — 110 min before the next 05:30 departure, against a ~120-min Macon top-up budget. No meets flagged in the model; the Vidalia pass still needs G&W's OK.",
    units: ["t11"], cycleWin: [240, 1680],
    trips: {
      t11: { ...PS_ROUND(330, 275, 60, 0), note: "PSYX0005 — round trip: Macon 05:30, charge Vidalia 10:12–11:27, PX 14:25–19:00 (charge + layover), wait Vidalia 21:58–22:58 for L781 (no charge), Macon 03:40" },
    },
  },
  oneFast: {
    label: "One vehicle — fast turn", short: "1 unit · fast", status: "clean",
    note: "One unit, out 04:15, home 22:45, one planned hold at Dublin for L781.",
    caveat: "Macon 04:15, Vidalia charge 08:57–10:12, Plastic Express 13:10–14:32 (82-min charge), then a planned 30-min hold in the Dublin siding while L781 passes (~20:06), Macon ~22:45. Departures 04:10–04:20 work; by 04:25 the hold no longer fits. No meets flagged in the model; the Dublin hold is a hand-throw meet G&W must agree to.",
    units: ["t11"], cycleWin: [180, 1620],
    trips: {
      t11: { ...PS_ROUND(255, 82, 0, 30), note: "PSYX0005 — fast turn: Macon 04:15, Vidalia 08:57–10:12, PX 13:10–14:32, hold at Dublin ~20:02–20:32 for L781, Macon ~22:45" },
    },
  },
  night: {
    label: "Three units — Night", short: "3 units · night", status: "flagged",
    note: "Former plan of record. Flagged: hits the Collins overnight stand.",
    caveat: "Depart 22:05 / 22:45 / 23:15. G&W (Sep 2026): the parade reaches Collins 04:53–06:03 while both Collins tracks are occupied by the tied-down L781 and Y120 trains. Three meets every night. To be revisited after the site visit.",
    units: ["t11", "t12", "t13"], cycleWin: [1280, 2760],
    trips: threeUnits({ t11: 1325, t12: 1365, t13: 1395 }, 75),
  },
  afternoon: {
    label: "Three units — Afternoon", short: "3 units · afternoon", status: "conflicted",
    note: "Fallback. Conflicted with L782R at Dublin.",
    caveat: "Depart 12:20 / 13:00 / 13:30. It relied on passing L782R inside a 2.5-hour Dublin stop; with Dublin at ~1 hour and the rest of L782R's lateness as a tolerance band, all three units cross it on the road west of Dublin. Kept as a what-if.",
    units: ["t11", "t12", "t13"], cycleWin: [700, 2190],
    trips: threeUnits({ t11: 740, t12: 780, t13: 810 }, 130),
  },
};
export const DEFAULT_PATTERN = "two";

/** Apply a pattern to a trip list: rewrite the seed units it defines. */
export function applyPattern(trips, key) {
  const p = PS_PATTERNS[key];
  if (!p) return trips;
  return trips.map((t) => (p.trips[t.id] ? { ...t, ...p.trips[t.id] } : t));
}

/** Agile Cold Storage weekly activity, from the Route Scheduling grid. */
export const AGILE = {
  Sun: "Closed", Mon: "Ship", Tue: "Ship", Wed: "Ship",
  Thu: "Ship", Fri: "Ship", Sat: "Load",
};
