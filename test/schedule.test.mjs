/**
 * Tests for the pure schedule computation. Run with `npm test` (node:test,
 * no extra dependencies). These pin down the behaviors CLAUDE.md calls out
 * as load-bearing: times are computed, dwell is two points, restrictions
 * re-draw the plan, and the seed plan is meet-free.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fmt,
  parseHM,
  legTime,
  computeTrip,
  stringPts,
  findMeets,
  findOpenWindows,
  isWestbound,
  toTSV,
  tolOf,
  hasTol,
  tolAnchors,
  tolAllow,
  tolBand,
  tolQuads,
  tolLegs,
  withTolAt,
  tripSegs,
  tripName,
  findPossibleMeets,
} from "../src/lib/schedule.js";
import { SEED_TRIPS, SEED_RESTRICTIONS, STATIONS, ST, wp, PS_SCHEDULES, PS_PATTERNS, DEFAULT_PATTERN, applyPattern, SPEED_LIMITS, TOTAL_MI } from "../src/data/network.js";
import { PRESET_VIEWS } from "../src/data/presets.js";
import { loadViews, storeViews } from "../src/lib/views.js";

test("fmt / parseHM round-trip in both colon and bare forms", () => {
  assert.equal(fmt(1110), "18:30");
  assert.equal(fmt(0), "00:00");
  assert.equal(fmt(1440), "00:00"); // wraps past midnight
  assert.equal(fmt(null), "—");
  assert.equal(parseHM("18:30"), 1110);
  assert.equal(parseHM("1830"), 1110);
  assert.equal(parseHM("630"), 390);
  assert.equal(parseHM("24:00"), null);
  assert.equal(parseHM("abc"), null);
});

test("station chainage is monotonic west to east and ends at the published 171.1", () => {
  for (let i = 1; i < STATIONS.length; i++) {
    assert.ok(STATIONS[i].mile > STATIONS[i - 1].mile, `${STATIONS[i].id} must be east of ${STATIONS[i - 1].id}`);
  }
  assert.equal(STATIONS.at(-1).mile, TOTAL_MI);
  // every id is unique and ST() resolves it
  const ids = new Set(STATIONS.map((s) => s.id));
  assert.equal(ids.size, STATIONS.length);
  for (const s of STATIONS) assert.equal(ST(s.id), s);
});

test("speed zones tile the whole line with no gaps or overlaps", () => {
  const z = [...SPEED_LIMITS].sort((a, b) => a.a - b.a);
  assert.equal(z[0].a, 0);
  for (let i = 1; i < z.length; i++) assert.equal(z[i].a, z[i - 1].b);
  assert.equal(z.at(-1).b, TOTAL_MI);
});

test("legTime integrates across zones and a waypoint speed caps from above only", () => {
  // Macon MP 0-2 is 10 mph, 2-6 is 20 mph: 6 miles at track speed
  const { minutes } = legTime(0, 6, 25, 0, 1);
  assert.ok(Math.abs(minutes - (2 / 10 + 4 / 20) * 60) < 1e-9);
  // asking for 60 mph never beats the zone limit
  assert.equal(legTime(0, 6, 60, 0, 1).minutes, minutes);
  // asking for 5 mph slows everything to 5
  assert.ok(Math.abs(legTime(0, 6, 5, 0, 1).minutes - (6 / 5) * 60) < 1e-9);
  // zero-length leg costs nothing
  assert.equal(legTime(10, 10, 25, 0, 1).minutes, 0);
});

test("a restriction slows the leg; out-of-service blocks it", () => {
  const slow = [{ id: "r", days: [1], from: "macon", to: "agile", t0: 0, t1: 600, mph: 5, kind: "speed" }];
  const base = legTime(0, 5.4, 25, 60, 1).minutes;
  const slowed = legTime(0, 5.4, 25, 60, 1, slow).minutes;
  assert.ok(slowed > base);
  // same restriction on a different day does nothing
  assert.equal(legTime(0, 5.4, 25, 60, 2, slow).minutes, base);
  const oos = [{ ...slow[0], kind: "oos" }];
  assert.equal(legTime(0, 5.4, 25, 60, 1, oos).mph, 0);
});

test("computeTrip: origin has no arrive, destination has no depart, dwell splits arrive/depart", () => {
  const trip = { type: "road", time: 600, waypoints: [wp("macon"), wp("dublin", 25, true, 30), wp("vidalia")] };
  const pts = computeTrip(trip, 1);
  assert.equal(pts.length, 3);
  assert.equal(pts[0].arrive, null);
  assert.equal(pts[0].depart, 600);
  assert.equal(pts[1].depart - pts[1].arrive, 30);
  assert.equal(pts[2].depart, null);
  // a dwell is two polyline points at the same mile — never collapsed
  const sp = stringPts(pts);
  assert.equal(sp.length, 4);
  assert.equal(sp[1].mile, sp[2].mile);
  assert.equal(sp[2].t - sp[1].t, 30);
});

test("computeTrip: a location job is one point spanning its hours on duty", () => {
  const job = { type: "yard", time: 480, work: 420, waypoints: [wp("macon")] };
  const [p] = computeTrip(job, 1);
  assert.equal(p.mile, 0);
  assert.equal(p.arrive, 480);
  assert.equal(p.depart, 900);
});

test("computeTrip supports round trips — a station may repeat", () => {
  const trip = { type: "road", time: 0, waypoints: [wp("macon"), wp("dublin", 25, true, 10), wp("macon")] };
  const pts = computeTrip(trip, 1);
  assert.equal(pts[0].st, "macon");
  assert.equal(pts[2].st, "macon");
  assert.ok(pts[2].arrive > pts[1].depart);
  assert.equal(isWestbound(trip), false); // ends where it started: not westbound
  assert.equal(isWestbound({ type: "road", waypoints: [wp("savannah"), wp("macon")] }), true);
});

test("seed Y120 → L782R is one contiguous train: Pooler 18:00, stands at Collins 20:00-09:00 in the siding, L782R leg with confirmed stops only", () => {
  const t9 = SEED_TRIPS.find((t) => t.id === "t9");
  assert.equal(t9.symbol, "Y120");
  assert.equal(tripName(t9), "Y120 → L782R");
  const pts = computeTrip(t9, 1);
  // each leg under its own crew's symbol: arrives Collins as Y120, leaves as L782R
  assert.equal(pts[0].sym, "Y120");
  assert.equal(pts.find((p) => p.st === "collins").symArr, "Y120");
  assert.equal(pts.find((p) => p.st === "collins").sym, "L782R");
  assert.equal(pts.at(-1).sym, "L782R");
  const sp = stringPts(pts);
  assert.equal(sp.filter((p) => p.sym === "Y120").length, 4); // Pooler, Magazine arr+dep, Collins arrive
  assert.equal(sp.find((p) => p.st === "collins" && p.sym === "L782R").t, pts.find((p) => p.st === "collins").depart);
  const collins = pts.find((p) => p.st === "collins");
  assert.equal(fmt(collins.arrive), "20:00");
  assert.equal(fmt(collins.depart), "09:00"); // next day: the L782R crew
  assert.equal(collins.block, false); // in the siding — dashed, a pass
  // after Collins only the two confirmed work stops — no phantom stops parking unexplained time
  const stops = pts.filter((p) => p.arrive != null && p.depart != null && p.depart - p.arrive > 0).map((p) => p.st);
  assert.deepEqual(stops, ["collins", "vidalia", "dublin"]);
  assert.equal(pts.find((p) => p.st === "dublin").depart - pts.find((p) => p.st === "dublin").arrive, 60);
  const macon = pts.at(-1);
  assert.ok(macon.arrive - 1440 >= 16 * 60 + 25 && macon.arrive - 1440 <= 16 * 60 + 40, `Macon nominal ${fmt(macon.arrive)}`);
  // the tolerance anchor sits on the Macon waypoint; the Collins crew change
  // resets the band, so it grows from the FIXED 09:00 departure, not from
  // Pooler the evening before, and its late edge is the reported ~18:00
  // tie-down — clear of L781's 18:00 departure from the same yard
  assert.deepEqual(tolOf(t9), { early: 0, late: 85 });
  assert.deepEqual(tolAnchors(t9), [{ wp: t9.waypoints.length - 1, early: 0, late: 85 }]);
  const band = tolBand(sp, t9);
  const dep = sp.findIndex((p) => p.st === "collins" && p.side === "dep");
  for (let i = 0; i <= dep; i++) assert.equal(band.late[i].t, sp[i].t, `${sp[i].st}/${sp[i].side} sharp before the L782R leg`);
  assert.ok(band.late[dep + 1].t > sp[dep + 1].t);
  const late = band.late[sp.length - 1].t;
  assert.ok(Math.abs(late - (macon.arrive + 85)) < 1e-9);
  assert.ok(late - 1440 >= 17 * 60 + 50 && late - 1440 < 18 * 60, `late edge ${fmt(late)}`);
});

test("seed L781 → L781R stands ON THE MAIN at Collins 23:33-06:30: solid, and a conflict for anything crossing", () => {
  const t10 = SEED_TRIPS.find((t) => t.id === "t10");
  const pts = computeTrip(t10, 1);
  const collins = pts.find((p) => p.st === "collins");
  assert.equal(fmt(collins.arrive), "23:33");
  assert.equal(fmt(collins.depart), "06:30");
  assert.equal(collins.block, true);
  const segs = tripSegs(pts);
  const stand = segs.find((sg) => sg.a.st === "collins" && sg.a.mile === sg.b.mile);
  assert.equal(stand.pass, false); // would be a pass at a hold station without `block`
  // a westbound movement through Collins at 02:00 is a meet, not a pass
  const wb = { symbol: "X", type: "road", days: [2], time: 60, waypoints: [wp("pooler"), wp("collins"), wp("vidalia")] };
  const meets = findMeets([t10, wb], 2);
  assert.equal(meets.length, 1);
  assert.equal(meets[0].mile, ST("collins").mile);
  // the same stop without the flag is in the clear
  const clear = { ...t10, waypoints: t10.waypoints.map((w) => ({ ...w, block: false })) };
  assert.deepEqual(findMeets([clear, wb], 2), []);
});

test("tolerance: none when unset; a destination anchor grows linearly from zero at the origin; legacy trip-level tol still reads", () => {
  const plain = { type: "road", time: 600, waypoints: [wp("macon"), wp("dublin"), wp("vidalia")] };
  assert.equal(tolOf(plain), null);
  assert.equal(hasTol(plain), false);
  assert.equal(tolAllow(plain, stringPts(computeTrip(plain, 1))), null);
  const anchored = { ...plain, waypoints: [wp("macon"), wp("dublin"), { ...wp("vidalia"), tol: { early: 10, late: 60 } }] };
  const sp = stringPts(computeTrip(anchored, 1));
  const a = tolAllow(anchored, sp);
  assert.deepEqual(a[0], { early: 0, late: 0 });
  assert.deepEqual(a[a.length - 1], { early: 10, late: 60 });
  const f = (sp[1].t - sp[0].t) / (sp[sp.length - 1].t - sp[0].t);
  assert.ok(Math.abs(a[1].late - 60 * f) < 1e-9);
  // early can never fold back past the origin
  const big = { ...plain, waypoints: [wp("macon"), wp("dublin"), { ...wp("vidalia"), tol: { early: 5000, late: 0 } }] };
  const ab = tolAllow(big, sp);
  assert.ok(ab[ab.length - 1].early <= sp[sp.length - 1].t - sp[0].t);
  // zeros and junk are "no tolerance"; legacy trip-level values still count
  assert.equal(tolOf({ ...plain, waypoints: [wp("macon"), { ...wp("vidalia"), tol: { early: 0, late: 0 } }] }), null);
  assert.deepEqual(tolOf({ ...plain, tol: { early: -5, late: "30" } }), { early: 0, late: 30 });
});

test("per-leg tolerance: an anchor at Collins is full on arrival, zero once L781R leaves, and legs interpolate by time", () => {
  const seed = SEED_TRIPS.find((t) => t.id === "t10");
  const t10 = { ...seed, waypoints: seed.waypoints.map((w) => (w.st === "collins" ? { ...w, tol: { early: 0, late: 60 } } : w)) };
  assert.ok(hasTol(t10));
  assert.deepEqual(tolOf(t10), { early: 0, late: 60 }); // the last anchor, held
  const sp = stringPts(computeTrip(t10, 2));
  const allow = tolAllow(t10, sp);
  const arr = sp.findIndex((p) => p.st === "collins" && p.side === "arr");
  assert.equal(allow[arr].late, 60, "full allowance at the Collins arrival");
  assert.equal(allow[arr + 1].late, 0, "the 06:30 L781R departure is fixed — crew change resets");
  for (let i = arr + 1; i < sp.length; i++) assert.equal(allow[i].late, 0);
  // Dublin is ~40% of the way Macon -> Collins by time
  const dub = sp.findIndex((p) => p.st === "dublin");
  const f = (sp[dub].t - sp[0].t) / (sp[arr].t - sp[0].t);
  assert.ok(Math.abs(allow[dub].late - 60 * f) < 1e-9 && f > 0.35 && f < 0.45);
  // a leg with no anchor before a crew change stays where the last value left it
  const t9 = SEED_TRIPS.find((t) => t.id === "t9");
  const sp9 = stringPts(computeTrip(t9, 1));
  const a9 = tolAllow(t9, sp9);
  const cdep = sp9.findIndex((p) => p.st === "collins" && p.side === "dep");
  for (let i = 0; i <= cdep; i++) assert.equal(a9[i].late, 0, "Y120 leg sharp");
  // ... and pinning +20 at Collins gives the Y120 leg its own band without touching L782R's
  const pinned = withTolAt(t9, 2, { early: 0, late: 20 });
  const ap = tolAllow(pinned, stringPts(computeTrip(pinned, 1)));
  assert.equal(ap[cdep - 1].late, 20);
  assert.equal(ap[cdep].late, 0);
  assert.equal(ap[ap.length - 1].late, 85);
  // after the last anchor the allowance HOLDS: a round trip anchored at the turnaround keeps it home
  const rt = { type: "road", time: 600, waypoints: [wp("macon"), wp("vidalia", 25, true, 30), wp("macon")] };
  rt.waypoints[1].tol = { early: 0, late: 40 };
  const ar = tolAllow(rt, stringPts(computeTrip(rt, 1)));
  assert.equal(ar[1].late, 40);
  assert.equal(ar[2].late, 40);
  assert.equal(ar[3].late, 40);
  // legs: departure -> next stop / destination
  assert.deepEqual(tolLegs(t9, sp9), [{ s: 0, e: 3 }, { s: 4, e: 5 }, { s: 6, e: 7 }, { s: 8, e: 9 }]);
  // withTolAt materialises a legacy trip-level tol before pinning, and clears with zeros
  const legacy = { ...seed, tol: { early: 0, late: 30 } };
  const mat = withTolAt(legacy, 1, { early: 0, late: 10 });
  assert.equal(mat.tol, undefined);
  assert.deepEqual(mat.waypoints.find((w) => w.st === "collins").tol, { early: 0, late: 30 }); // legacy `to` = first crew change
  assert.deepEqual(mat.waypoints[1].tol, { early: 0, late: 10 });
  assert.equal(withTolAt(mat, 1, { early: 0, late: 0 }).waypoints[1].tol, undefined);
});

test("tolBand / tolQuads: edges shadow the string point for point, dwells make no quad, quads wind one way", () => {
  const trip = { type: "road", time: 600, waypoints: [wp("macon"), wp("dublin", 25, true, 30), { ...wp("vidalia"), tol: { early: 0, late: 60 } }] };
  const sp = stringPts(computeTrip(trip, 1));
  assert.equal(tolBand(sp, { ...trip, waypoints: trip.waypoints.map((w) => ({ ...w, tol: undefined })) }), null);
  const band = tolBand(sp, trip);
  assert.equal(band.early.length, sp.length);
  assert.equal(band.late.length, sp.length);
  sp.forEach((p, i) => {
    assert.equal(band.early[i].mile, p.mile);
    assert.equal(band.early[i].t, p.t); // early = 0
    assert.ok(band.late[i].t >= p.t);
  });
  assert.equal(band.late[0].t, sp[0].t);
  assert.ok(Math.abs(band.late.at(-1).t - (sp.at(-1).t + 60)) < 1e-9);
  // 3 segments: run, dwell, run -> two quads
  const quads = tolQuads(band);
  assert.equal(quads.length, 2);
  const area = (q) => q.reduce((a, p, k) => a + p.t * q[(k + 1) % 4].mile - q[(k + 1) % 4].t * p.mile, 0);
  for (const q of quads) assert.ok(area(q) > 0);
  assert.deepEqual(tolQuads(null), []);
});

test("findPossibleMeets: nothing without tolerances; flags a ribbon overlap that the nominal lines miss", () => {
  // eastbound leaves Macon at 10:00 nominal; westbound leaves Vidalia late
  // enough that the nominal strings never cross, but a 90-min-late
  // eastbound is still on the road when the westbound comes through
  const east = { symbol: "E", type: "road", days: [1], time: 600, waypoints: [wp("macon"), wp("vidalia")] };
  const eastPts = computeTrip(east, 1);
  const west = { symbol: "W", type: "road", days: [1], time: eastPts.at(-1).arrive + 20, waypoints: [wp("vidalia"), wp("macon")] };
  assert.deepEqual(findMeets([east, west], 1), []);
  assert.deepEqual(findPossibleMeets([east, west], 1), []);
  const loose = { ...east, tol: { early: 0, late: 90 } };
  assert.deepEqual(findMeets([loose, west], 1), []); // nominal unchanged
  const pm = findPossibleMeets([loose, west], 1);
  assert.equal(pm.length, 1);
  assert.equal(pm[0].a, "E");
  assert.equal(pm[0].b, "W");
  assert.ok(pm[0].mile < ST("vidalia").mile && pm[0].mile > 0);
  assert.ok(pm[0].t > west.time, "the overlap is on the road after W departs, not at W's origin");
  // a real nominal crossing is reported by findMeets, not duplicated here
  const head = { ...west, time: 600 };
  assert.equal(findMeets([loose, head], 1).length, 1);
  assert.equal(findPossibleMeets([loose, head], 1).length, 0);
});

test("seed plan: the G&W baseline has no possible meets; the Night pattern's only ones are Parallel returns following L782R", () => {
  const gw = SEED_TRIPS.filter((t) => t.type !== "parallel");
  for (let d = 0; d < 7; d++) assert.deepEqual(findPossibleMeets(gw, d, SEED_RESTRICTIONS), [], `G&W day ${d}`);
  for (let d = 0; d < 7; d++) {
    const pm = findPossibleMeets(SEED_TRIPS, d, SEED_RESTRICTIONS);
    for (const m of pm) {
      assert.equal(m.a, "L782R", `day ${d}: ${m.a} × ${m.b}`); // all after the Collins crew change
      assert.match(m.b, /^PS/);
      assert.ok(m.t >= 0 && m.t < 1440);
    }
    // every marker once: a return that is inside the ribbon on Tuesday is not
    // also reported from Tuesday's own late-departing copy of the train
    const keys = pm.map((m) => `${m.b}@${Math.round(m.t)}@${m.mile.toFixed(1)}`);
    assert.equal(new Set(keys).size, keys.length, `day ${d} duplicates: ${keys}`);
  }
});

test("fleet patterns: two / oneLayover / oneFast are clean of every G&W train all week; night is flagged at Collins, afternoon conflicted at Dublin", () => {
  const gw = SEED_TRIPS.filter((t) => t.type !== "parallel");
  const plan = (key) => {
    const p = PS_PATTERNS[key];
    return applyPattern(SEED_TRIPS, key).filter((t) => t.type !== "parallel" || p.units.includes(t.id));
  };
  const week = (trips) => {
    let meets = [];
    let possible = 0;
    for (let d = 0; d < 7; d++) {
      meets.push(...findMeets(trips, d, SEED_RESTRICTIONS));
      possible += findPossibleMeets(trips, d, SEED_RESTRICTIONS).length;
    }
    return { meets, possible };
  };
  assert.equal(PS_PATTERNS[DEFAULT_PATTERN].status, "clean");
  for (const key of ["two", "oneLayover", "oneFast"]) {
    const { meets, possible } = week(plan(key));
    assert.deepEqual(meets, [], `${key} meets`);
    assert.equal(possible, 0, `${key} possible`);
    assert.equal(PS_PATTERNS[key].status, "clean");
  }
  // two vehicles: PS2 east from Macon 05:30, PS5 west from Plastic Express 19:00
  const two = plan("two");
  assert.deepEqual(two.filter((t) => t.type === "parallel").map((t) => t.symbol).sort(), ["PS2", "PS5"]);
  const e = computeTrip(two.find((t) => t.symbol === "PS2"), 2);
  const w = computeTrip(two.find((t) => t.symbol === "PS5"), 2);
  assert.equal(fmt(e[0].depart), "05:30");
  assert.equal(fmt(e.at(-1).arrive), "14:25");
  assert.equal(fmt(w[0].depart), "19:00");
  assert.equal(fmt(w.at(-1).arrive), "03:40");
  assert.ok(e.find((p) => p.st === "collins").arrive > 6 * 60 + 30); // after L781R leaves
  assert.ok(w.find((p) => p.st === "collins").arrive < 23 * 60 + 33); // before L781 arrives
  // the return is charged at PX: its only stop is a WAIT in Vidalia yard while L781 passes
  const wv = w.find((p) => p.st === "vidalia");
  const l781v = computeTrip(SEED_TRIPS.find((t) => t.id === "t10"), 2).find((p) => p.st === "vidalia").arrive;
  assert.ok(wv.arrive < l781v && l781v < wv.depart, "L781 passes Vidalia while the unit is in the yard");
  assert.ok(l781v - wv.arrive >= 15 && wv.depart - l781v >= 15, "at least the 15-min hand-throw buffer each side");
  assert.equal(w.filter((p) => p.arrive != null && p.depart != null && p.depart - p.arrive > 0).length, 1);
  // one unit, layover: the same cycle end to end, 110 min at Macon before the next departure
  const lay = computeTrip(plan("oneLayover").find((t) => t.type === "parallel"), 2);
  assert.equal(fmt(lay[0].depart), "05:30");
  assert.equal(fmt(lay.find((p) => p.st === "plastic").depart), "19:00");
  assert.equal(Math.round(1440 + lay[0].depart - lay.at(-1).arrive), 110);
  // one unit, fast turn: 82-min PX charge, a planned 30-min hold in the Dublin siding for L781
  const fast = plan("oneFast").find((t) => t.type === "parallel");
  const fp = computeTrip(fast, 2);
  assert.equal(fmt(fp[0].depart), "04:15");
  const px = fp.find((p) => p.st === "plastic");
  assert.equal(px.depart - px.arrive, 82);
  const dub = fp.filter((p) => p.st === "dublin")[1];
  assert.equal(dub.depart - dub.arrive, 30);
  assert.ok(ST("dublin").hold);
  const l781 = computeTrip(SEED_TRIPS.find((t) => t.id === "t10"), 2).find((p) => p.st === "dublin");
  assert.ok(dub.arrive < l781.arrive && l781.arrive < dub.depart, "L781 passes Dublin while the unit is in the hole");
  // the legacy three-unit patterns keep showing their problems
  const night = week(plan("night"));
  assert.ok(night.meets.length > 0 && night.meets.every((m) => m.a === "L781" && m.mile === ST("collins").mile));
  assert.equal(PS_PATTERNS.night.status, "flagged");
  const aft = week(plan("afternoon"));
  assert.ok(aft.meets.some((m) => m.a === "L782R"));
  assert.equal(PS_PATTERNS.afternoon.status, "conflicted");
  // seed times ARE the night pattern, so applying it is a no-op on the seed
  assert.deepEqual(applyPattern(SEED_TRIPS, "night"), SEED_TRIPS);
});

test("built-in views: every preset (if any) is a valid, loadable snapshot", () => {
  const mem = new Map();
  storeViews(PRESET_VIEWS, { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) });
  assert.equal(loadViews({ getItem: (k) => mem.get(k) ?? null }).length, PRESET_VIEWS.length);
  for (const v of PRESET_VIEWS) assert.ok(v.builtIn && Array.isArray(v.snap.trips));
});

test("findOpenWindows treats a tolerance ribbon as occupied", () => {
  const gw = SEED_TRIPS.filter((t) => t.type !== "parallel");
  const sharp = gw.map((t) => (t.id === "t9" ? { ...t, tol: null, waypoints: t.waypoints.map((w) => ({ ...w, tol: undefined })) } : t));
  const cand = { waypoints: [wp("macon"), wp("plastic")] };
  const total = (wins) => wins.reduce((a, w) => a + (w.to - w.from), 0);
  assert.ok(total(findOpenWindows(cand, gw, 1)) < total(findOpenWindows(cand, sharp, 1)));
});

test("seed plan: the G&W baseline is meet-free; the NIGHT pattern's only meets are the Collins overnight stand G&W flagged", () => {
  const gw = SEED_TRIPS.filter((t) => t.type !== "parallel");
  for (let d = 0; d < 7; d++) assert.deepEqual(findMeets(gw, d, SEED_RESTRICTIONS), [], `G&W day ${d}`);
  // seed times ARE the night pattern
  const night = PS_SCHEDULES.night.times;
  for (const [id, time] of Object.entries(night)) assert.equal(SEED_TRIPS.find((t) => t.id === id).time, time);
  // Sep 2026 (Joe Underwood): both Collins tracks are occupied 23:33-06:30,
  // and the eastbound parade reaches Collins 04:53 / 05:33 / 06:03. Three
  // meets there Tue-Fri mornings (L781 runs Sun-Thu nights, the parade
  // Mon-Fri nights), nothing anywhere else, each reported once.
  for (let d = 0; d < 7; d++) {
    const meets = findMeets(SEED_TRIPS, d, SEED_RESTRICTIONS);
    if (d < 2 || d === 6) assert.deepEqual(meets, [], `night day ${d}`);
    else {
      assert.equal(meets.length, 3, `night day ${d}: ${JSON.stringify(meets)}`);
      for (const m of meets) {
        assert.equal(m.a, "L781"); // the stand is the tied-down L781; it leaves as L781R
        assert.equal(m.mile, ST("collins").mile);
        assert.ok(m.t >= 4 * 60 + 50 && m.t <= 6 * 60 + 5, fmt(m.t));
      }
      assert.deepEqual(meets.map((m) => m.b).sort(), ["PS2", "PS3", "PS5"]);
    }
  }
});

test("findMeets flags a head-on crossing and ignores a dwell-in-the-hole pass", () => {
  const east = { symbol: "E", type: "road", days: [1], time: 600, waypoints: [wp("macon"), wp("vidalia")] };
  const west = { symbol: "W", type: "road", days: [1], time: 600, waypoints: [wp("vidalia"), wp("macon")] };
  const meets = findMeets([east, west], 1);
  assert.equal(meets.length, 1);
  assert.ok(meets[0].mile > 0 && meets[0].mile < ST("vidalia").mile);
  // park the eastbound at Dublin (a hold point) long enough for the westbound to pass
  const parked = { ...east, waypoints: [wp("macon"), wp("dublin", 25, true, 600), wp("vidalia")] };
  assert.equal(findMeets([parked, west], 1).length, 0);
});

test("findOpenWindows returns ordered, non-overlapping windows within the day", () => {
  const wins = findOpenWindows({ waypoints: [wp("macon"), wp("plastic")] }, SEED_TRIPS.filter((t) => t.type !== "parallel"), 1);
  assert.ok(wins.length > 0);
  for (const w of wins) {
    assert.ok(w.from < w.to);
    assert.ok(w.from >= 0 && w.to <= 1440);
    assert.ok(w.kind === "clear" || w.kind === "hold");
  }
  for (let i = 1; i < wins.length; i++) assert.ok(wins[i].from >= wins[i - 1].to);
});

test("toTSV has a header row and one row per computed point, with the tolerance band as Earliest / Latest", () => {
  const t = [{ symbol: "X", type: "road", days: [1], time: 0, waypoints: [wp("macon"), wp("dublin")] }];
  const rows = toTSV(t, 1).split("\n");
  assert.equal(rows.length, 3);
  const head = rows[0].split("\t");
  assert.equal(head[0], "Train");
  assert.deepEqual(head.slice(-2), ["Earliest", "Latest"]);
  assert.deepEqual(rows[2].split("\t").slice(-2), ["", ""]);
  const loose = toTSV([{ ...t[0], tol: { early: 0, late: 60 } }], 1).split("\n");
  const [origin, dest] = [loose[1].split("\t"), loose[2].split("\t")];
  assert.equal(origin.at(-1), origin[5]); // origin: latest = depart
  assert.equal(dest.at(-2), dest[4]); // early 0: earliest = arrive
  assert.equal(dest.at(-1), fmt(computeTrip(t[0], 1).at(-1).arrive + 60));
});

test("jobRange: base plus west/east far ends; legacy single-ended territory still honored", async () => {
  const { jobRange } = await import("../src/lib/schedule.js");
  const base = { waypoints: [wp("dublin")] };
  assert.deepEqual(jobRange(base), { lo: 49.5, hi: 49.5, base: 49.5, w: null, e: null });
  const both = { ...base, range: { w: "dudley", e: "tarrytown" } };
  const r = jobRange(both);
  assert.equal(r.w, "dudley");
  assert.equal(r.e, "tarrytown");
  assert.equal(r.lo, ST("dudley").mile);
  assert.equal(r.hi, ST("tarrytown").mile);
  // a far end on the wrong side of the base is harmless — min/max sorts it out
  assert.equal(jobRange({ ...base, range: { w: "tarrytown", e: null } }).e, "tarrytown");
  // pre-range saved views
  assert.equal(jobRange({ waypoints: [wp("savannah")], territory: "pooler" }).w, "pooler");
});
