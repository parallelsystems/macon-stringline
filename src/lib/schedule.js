/**
 * Schedule computation. Pure functions, no React, no side effects.
 *
 * The central idea, taken from the FRA/Volpe Railroad Traffic Planner: a
 * planner enters WAYPOINTS, DWELL, and SPEEDS. Arrival and departure times are
 * derived, never hand-entered. That's what makes a track restriction able to
 * genuinely re-draw the plan instead of just annotating it.
 *
 * Because this module is pure, it's also the natural place to hook in a
 * planned-vs-actual comparison later: feed real position reports through the
 * same geometry and diff against the computed plan.
 */

import { ST, STATIONS, TYPES, SPEED_LIMITS, YL10_SPEED_LIMITS } from "../data/network.js";

/** Speed zones a trip runs under: G&W trains run the authorized speeds
 *  (June 2026 slide 6); Parallel consists plan every yard-limit mile at
 *  10 MPH (ops guidance, Aug 2026) via TYPES[].yl10. */
export const zonesFor = (trip) => (TYPES[trip?.type]?.yl10 ? YL10_SPEED_LIMITS : SPEED_LIMITS);

/** True for job types that move over the road (draw strings, can conflict). */
const moves = (trip) => !!TYPES[trip.type]?.moves;

/* ------------------------------ time formatting ---------------------------- */

/** Minutes from midnight to display time, e.g. 1110 -> "18:30". Colon form
 *  by request — not everyone reads bare railroad time. parseHM accepts both. */
export function fmt(m) {
  if (m == null || !isFinite(m)) return "—";
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

/** Minutes from midnight to "18:30". Used for axis labels. */
export function fmtColon(m) {
  if (m == null || !isFinite(m)) return "—";
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

/** Parse "1830" or "18:30" to minutes. Returns null when unparseable. */
export function parseHM(s) {
  const t = String(s).replace(":", "").trim();
  if (!/^\d{3,4}$/.test(t)) return null;
  const h = Number(t.slice(0, t.length - 2));
  const mi = Number(t.slice(-2));
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}

/* -------------------------------- restrictions ----------------------------- */

/**
 * Effective speed for a segment given active restrictions.
 *
 * SIMPLIFICATION: overlap is tested against the segment's DEPARTURE time, with
 * a 4-hour lookback so a long segment entered before a restriction opens is
 * still caught. A rigorous version would integrate speed along the segment as
 * the restriction window opens and closes mid-run. Fine for planning; revisit
 * before anyone treats output as authoritative.
 *
 * Returns 0 for out-of-service, which the caller treats as "no running time"
 * rather than dividing by zero.
 */
export function effSpeed(base, mA, mB, t, day, restrictions) {
  const lo = Math.min(mA, mB);
  const hi = Math.max(mA, mB);
  let v = base;

  for (const r of restrictions) {
    if (!r.days.includes(day)) continue;

    const ra = Math.min(ST(r.from).mile, ST(r.to).mile);
    const rb = Math.max(ST(r.from).mile, ST(r.to).mile);
    if (hi <= ra || lo >= rb) continue; // no spatial overlap

    if (t > r.t1 || t < r.t0 - 240) continue; // no temporal overlap

    if (r.kind === "oos") return 0;
    v = Math.min(v, r.mph);
  }
  return v;
}

/**
 * Minutes to cover a leg, integrating across the track's SPEED_LIMITS zones.
 * `base` is the speed the trip asks for — it caps from above, never raises a
 * zone's limit. Restrictions cap each zone further (tested at the leg's
 * departure time; see effSpeed for that simplification).
 *
 * Returns { minutes, mph } where mph is the leg's effective average speed.
 * mph 0 means an out-of-service window blocks the leg.
 */
export function legTime(mA, mB, base, t, day, restrictions = [], zones = SPEED_LIMITS) {
  const lo = Math.min(mA, mB);
  const hi = Math.max(mA, mB);
  if (hi - lo < 1e-9) return { minutes: 0, mph: base };

  let minutes = 0;
  let covered = 0;
  for (const z of zones) {
    const a = Math.max(lo, z.a);
    const b = Math.min(hi, z.b);
    if (b <= a) continue;
    const v = effSpeed(Math.min(base, z.mph), a, b, t, day, restrictions);
    if (v === 0) return { minutes: 0, mph: 0 };
    minutes += ((b - a) / v) * 60;
    covered += b - a;
  }

  // any stretch the zone table doesn't cover runs at the trip's own speed
  const rest = hi - lo - covered;
  if (rest > 1e-9) {
    const v = effSpeed(base, lo, hi, t, day, restrictions);
    if (v === 0) return { minutes: 0, mph: 0 };
    minutes += (rest / v) * 60;
  }

  return { minutes, mph: (hi - lo) / (minutes / 60) };
}

/* ------------------------------ location jobs ------------------------------ */

/**
 * Working range of a location job (yard / local / MOW): the base point plus
 * however far it ranges west and east. `trip.range = { w, e }` holds the two
 * far-end station ids (either may be null). The older single-ended
 * `trip.territory` is still honored so saved views keep drawing.
 * Returns miles {lo, hi, base} and the station ids at each end (null when the
 * range doesn't extend that way).
 */
export function jobRange(trip) {
  const base = ST(trip.waypoints[0].st);
  let lo = base.mile;
  let hi = base.mile;
  const ends = [trip.range?.w, trip.range?.e, trip.territory].filter(Boolean).map((id) => ST(id).mile);
  for (const m of ends) {
    lo = Math.min(lo, m);
    hi = Math.max(hi, m);
  }
  const at = (m) => STATIONS_BY_MILE.get(m) ?? null;
  return { lo, hi, base: base.mile, w: lo < base.mile ? at(lo) : null, e: hi > base.mile ? at(hi) : null };
}
const STATIONS_BY_MILE = new Map(STATIONS.map((s) => [s.mile, s.id]));

/* ------------------------------ core calculation --------------------------- */

/**
 * Compute the timed points for one trip on one day.
 *
 * Returns [{ st, mile, arrive, depart, mph, dist }]. `arrive` is null at the
 * origin and `depart` is null at the destination, which is what makes the
 * timetable read correctly.
 *
 * Non-road jobs (yard, local, MOW) occupy a single location for `work` minutes.
 */
export function computeTrip(trip, day, restrictions = []) {
  if (!moves(trip)) {
    const s = ST(trip.waypoints[0].st);
    return [{
      st: s.id,
      mile: s.mile,
      arrive: trip.time,
      depart: trip.time + (trip.work || 0),
      sym: trip.symbol,
      symArr: trip.symbol,
      wp: 0,
    }];
  }

  const out = [];
  let t = trip.time;
  // `sym` is the train symbol in effect LEAVING each point. A stop with
  // `as: "L782R"` is a crew change: the same train continues under a new
  // symbol (Y120 brings it to Collins, L782R takes it on). `symArr` is the
  // symbol it arrived under, so labels, meets, and the timetable can name
  // each leg by its own crew.
  let sym = trip.symbol;

  trip.waypoints.forEach((w, i) => {
    const s = ST(w.st);

    if (i === 0) {
      out.push({ st: s.id, mile: s.mile, arrive: null, depart: t, sym, symArr: sym, wp: 0 });
      return;
    }

    const prev = ST(trip.waypoints[i - 1].st);
    const dist = Math.abs(s.mile - prev.mile);
    const base = trip.waypoints[i - 1].speed || 25;
    const { minutes: run, mph } = legTime(prev.mile, s.mile, base, t, day, restrictions, zonesFor(trip));

    const arrive = t + run;
    const isLast = i === trip.waypoints.length - 1;
    const depart = w.stop ? arrive + (w.dwell || 0) : arrive;

    // `block`: the train stands ON THE MAIN during this stop (e.g. two trains
    // tied down overnight at a two-track location) — drawn solid, and never
    // treated as an in-the-clear pass by meet detection
    const symArr = sym;
    if (w.stop && w.as) sym = w.as;
    out.push({ st: s.id, mile: s.mile, arrive, depart: isLast ? null : depart, mph, dist, block: !!(w.stop && w.block), sym, symArr, wp: i });
    t = depart;
  });

  return out;
}

/** Flatten computed points into polyline vertices. A dwell becomes two points. */
export function stringPts(pts) {
  const out = [];
  pts.forEach((p) => {
    if (p.arrive != null) out.push({ t: p.arrive, mile: p.mile, st: p.st, block: !!p.block, sym: p.symArr ?? p.sym, wp: p.wp, side: "arr" });
    if (p.depart != null) out.push({ t: p.depart, mile: p.mile, st: p.st, block: !!p.block, sym: p.sym, wp: p.wp, side: "dep" });
  });
  return out;
}

/** "Y120 → L782R": the trip's symbol plus every crew-change symbol along it. */
export function tripName(trip) {
  const more = (trip.waypoints || []).filter((w) => w.stop && w.as).map((w) => w.as);
  return [trip.symbol, ...more].join(" → ");
}

/* --------------------------------- tolerance -------------------------------- */

/**
 * Schedule tolerance: how far off the computed times a train may really run.
 * Minutes, asymmetric (early / late — trains run late far more than early),
 * and it lives on WAYPOINTS: a stop or the destination may carry
 * `tol: { early, late }`, meaning "by the time it gets HERE it may be this
 * early / this late". Between anchors the allowance interpolates linearly
 * with elapsed time; before the first anchor it grows from zero at the
 * origin; after the last it HOLDS (lateness persists). A crew-change stop
 * (`as`) resets it to zero on departure — the new crew leaves at its own
 * fixed time. So one string carries a different band on each leg: Y120's
 * run to Collins sharp, L782R's leg widening to 85 min at Macon. On the
 * stringline, hovering a string shows a handle on every leg; dragging it
 * sets the anchor at that leg's end.
 *
 * Legacy: a trip-level `tol: { early, late, from?, to? }` (views saved
 * before Sep 15 2026) reads as one anchor at `to` — default the first crew
 * change after `from`, else the destination — with a reset at `from`.
 *
 * This replaces the earlier practice of parking unexplained running time as
 * short "phantom" stops at sidings. Those drew dashed — the chart's own
 * convention for "in the clear, main not blocked" — and meet detection
 * treated every crossing through them as a planned siding pass. A ribbon
 * says what is actually known: the train is somewhere in this band, and
 * nothing here asserts it is clear of the main.
 */
export function tolValue(t) {
  const early = Math.max(0, Math.round(Number(t?.early) || 0));
  const late = Math.max(0, Math.round(Number(t?.late) || 0));
  return early || late ? { early, late } : null;
}

/** A legacy trip-level tol as { fromIdx, toIdx, tol } in waypoint indexes. */
function legacyAnchor(trip) {
  const tol = tolValue(trip?.tol);
  if (!tol) return null;
  const wps = trip.waypoints || [];
  let fromIdx = 0;
  if (trip.tol.from) {
    const k = wps.findIndex((w) => w.st === trip.tol.from);
    if (k >= 0) fromIdx = k;
  }
  let toIdx = wps.length - 1;
  if (trip.tol.to) {
    const k = wps.findIndex((w, i) => i > fromIdx && w.st === trip.tol.to);
    if (k >= 0) toIdx = k;
  } else {
    const k = wps.findIndex((w, i) => i > fromIdx && w.stop && w.as);
    if (k >= 0) toIdx = k;
  }
  return { fromIdx, toIdx, tol };
}

/** Every anchor on a trip as [{ wp, early, late }] in route order (a legacy
 *  trip-level tol included, unless that waypoint already has its own). */
export function tolAnchors(trip) {
  const wps = trip?.waypoints || [];
  const out = [];
  wps.forEach((w, i) => {
    const v = tolValue(w.tol);
    if (v && (i === wps.length - 1 || w.stop)) out.push({ wp: i, ...v });
  });
  const leg = legacyAnchor(trip);
  if (leg && !out.some((a) => a.wp === leg.toIdx)) out.push({ wp: leg.toIdx, ...leg.tol });
  return out.sort((a, b) => a.wp - b.wp);
}

export const hasTol = (trip) => tolAnchors(trip).length > 0;

/** The allowance in force at the destination — the last anchor, held — or
 *  null. What the timetable's per-train field shows and edits. */
export function tolOf(trip) {
  const a = tolAnchors(trip);
  return a.length ? { early: a[a.length - 1].early, late: a[a.length - 1].late } : null;
}

/**
 * Allowance at every point of a string: [{ early, late }] aligned with `sp`
 * (from stringPts, which carries each point's waypoint index and side), or
 * null when the trip has no tolerance at all.
 */
export function tolAllow(trip, sp) {
  const anchors = tolAnchors(trip);
  if (!anchors.length || sp.length < 2) return null;
  const wps = trip.waypoints || [];
  const leg = legacyAnchor(trip);
  const byWp = new Map(anchors.map((a) => [a.wp, a]));
  const ZERO = { early: 0, late: 0 };
  // known values: the origin and every crew-change departure are zero; an
  // anchor applies at its waypoint's ARRIVAL
  const known = new Map();
  sp.forEach((p, i) => {
    if (i === 0) known.set(0, ZERO);
    const w = wps[p.wp];
    const legacyReset = leg && leg.fromIdx > 0 && p.wp === leg.fromIdx;
    if (p.side === "dep" && p.wp > 0 && w?.stop && (w.as || legacyReset)) known.set(i, ZERO);
    if (p.side === "arr" && byWp.has(p.wp)) known.set(i, byWp.get(p.wp));
  });
  const isAnchor = (i) => sp[i].side === "arr" && byWp.has(sp[i].wp);
  const out = new Array(sp.length);
  let prev = 0; // index of the last known point at or before i
  let resetT = sp[0].t; // the early edge can never fold back past the last reset
  for (let i = 0; i < sp.length; i++) {
    if (known.has(i)) {
      prev = i;
      if (!isAnchor(i)) resetT = sp[i].t;
      out[i] = known.get(i);
    } else {
      const pv = known.get(prev);
      // aim at the next known point only if it is an anchor; if it is a
      // reset (a crew change with no anchor of its own before it), hold —
      // a leg nobody has put a value on stays where the last one left it
      let next = -1;
      for (let k = i + 1; k < sp.length; k++) if (known.has(k)) { next = isAnchor(k) ? k : -1; break; }
      if (next < 0) out[i] = pv; // hold
      else {
        const T = sp[next].t - sp[prev].t;
        const f = T > 0 ? (sp[i].t - sp[prev].t) / T : 1;
        const nv = known.get(next);
        out[i] = { early: pv.early + (nv.early - pv.early) * f, late: pv.late + (nv.late - pv.late) * f };
      }
    }
    out[i] = { early: Math.min(out[i].early, Math.max(0, sp[i].t - resetT)), late: out[i].late };
  }
  return out;
}

/**
 * Ribbon edges for a string: { early, late } — two polylines the length of
 * `sp`, each point shifted in time by its allowance — or null when there is
 * nothing to draw.
 */
export function tolBand(sp, trip) {
  const allow = tolAllow(trip, sp);
  if (!allow) return null;
  return {
    early: sp.map((p, i) => ({ ...p, t: p.t - allow[i].early })),
    late: sp.map((p, i) => ({ ...p, t: p.t + allow[i].late })),
  };
}

/** The trip with the anchor at waypoint `wpIdx` set to `tol` (null / zeros
 *  clear it). A legacy trip-level tol is materialised onto its waypoint
 *  first, so the two never fight. Pure. */
export function withTolAt(trip, wpIdx, tol) {
  const wps = (trip.waypoints || []).map((w) => ({ ...w }));
  const leg = legacyAnchor(trip);
  if (leg && wps[leg.toIdx] && !tolValue(wps[leg.toIdx].tol)) wps[leg.toIdx].tol = leg.tol;
  const v = tolValue(tol);
  if (wps[wpIdx]) {
    if (v) wps[wpIdx].tol = v;
    else delete wps[wpIdx].tol;
  }
  const out = { ...trip, waypoints: wps };
  delete out.tol;
  return out;
}

/** Legs of a string for the tolerance handles: [{ s, e }] indexes into `sp`,
 *  each running from a departure (origin or a stop) to the next STOP's
 *  arrival or the destination. Pass-through waypoints are mid-leg. */
export function tolLegs(trip, sp) {
  const wps = trip.waypoints || [];
  const legs = [];
  let start = 0;
  for (let i = 1; i < sp.length; i++) {
    const w = wps[sp[i].wp];
    if (sp[i].side === "arr" && (w?.stop || i === sp.length - 1)) {
      if (sp[i].t > sp[start].t) legs.push({ s: start, e: i });
      start = Math.min(i + 1, sp.length - 1);
    }
  }
  return legs;
}

/**
 * The ribbon as fillable quads in (time, mile) space — one per MOVING
 * segment (a dwell has no height; the edge lines carry it). Every quad is
 * wound the same way, so a single nonzero-rule fill of all of them is their
 * union: no seams between neighbours and no holes where a round trip's
 * return leg overlaps its outbound one.
 */
export function tolQuads(band) {
  if (!band) return [];
  const { early, late } = band;
  const out = [];
  for (let i = 0; i < early.length - 1; i++) {
    if (early[i].mile === early[i + 1].mile) continue;
    const q = [early[i], early[i + 1], late[i + 1], late[i]];
    let area = 0;
    for (let k = 0; k < 4; k++) {
      const a = q[k];
      const b = q[(k + 1) % 4];
      area += a.t * b.mile - b.t * a.mile;
    }
    out.push(area < 0 ? q.reverse() : q);
  }
  return out;
}

/* ------------------------------ meet detection ----------------------------- */

/** Segment intersection in (time, mile) space. Null when they don't cross. */
export function segInt(p1, p2, p3, p4) {
  const d = (p2.t - p1.t) * (p4.mile - p3.mile) - (p2.mile - p1.mile) * (p4.t - p3.t);
  if (Math.abs(d) < 1e-9) return null;

  const ua = ((p3.t - p1.t) * (p4.mile - p3.mile) - (p3.mile - p1.mile) * (p4.t - p3.t)) / d;
  const ub = ((p3.t - p1.t) * (p2.mile - p1.mile) - (p3.mile - p1.mile) * (p2.t - p1.t)) / d;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;

  return {
    t: p1.t + ua * (p2.t - p1.t),
    mile: p1.mile + ua * (p2.mile - p1.mile),
  };
}

/**
 * Find every meet or pass between road trains on a given day.
 *
 * ADVISORY ONLY. This flags where the plan puts two movements at the same
 * place at the same time so a planner can resolve it. It does not — and must
 * not — gate or authorize any movement. Anything that acts on live position to
 * permit or prevent a move belongs in a separate, assurance-rated artifact,
 * not in this planner.
 */
export function findMeets(trips, day, restrictions = []) {
  // A run longer than the remaining day spills past midnight, so today's
  // picture includes yesterday's departures still on the road (their strings
  // shifted back 24 h). Each meet is reported once, on the day it occurs.
  const prev = (day + 6) % 7;
  const sets = [];
  for (const t of trips) {
    if (!moves(t)) continue;
    if (t.days.includes(day)) {
      sets.push({ sym: t.symbol, segs: tripSegs(computeTrip(t, day, restrictions)) });
    }
    if (t.days.includes(prev)) {
      const segs = tripSegs(computeTrip(t, prev, restrictions))
        .map((s) => ({ ...s, a: { ...s.a, t: s.a.t - 1440 }, b: { ...s.b, t: s.b.t - 1440 } }))
        .filter((s) => s.b.t > 0);
      if (segs.length) sets.push({ sym: t.symbol, segs });
    }
  }

  const found = [];
  for (let i = 0; i < sets.length; i++) {
    for (let k = i + 1; k < sets.length; k++) {
      for (const sa of sets[i].segs) {
        if (sa.pass) continue;
        for (const sb of sets[k].segs) {
          if (sb.pass) continue;
          const x = segInt(sa.a, sa.b, sb.a, sb.b);
          if (!x || x.t < 0 || x.t >= 1440) continue;
          // a crossing exactly at a waypoint vertex is the end of one segment
          // and the start of the next — one meet, not two
          const a = sa.sym || sets[i].sym;
          const b = sb.sym || sets[k].sym;
          if (found.some((f) => f.a === a && f.b === b && Math.abs(f.t - x.t) < 1e-6 && Math.abs(f.mile - x.mile) < 1e-6)) continue;
          found.push({ ...x, a, b });
        }
      }
    }
  }
  return found;
}

/**
 * Segments of a computed trip with a `pass` flag: a dwell at a hold-capable
 * station means the train is in the hole there — an opposing move runs by on
 * the main, so a crossing through that segment is a planned siding/yard pass,
 * not a conflict. Used by both findMeets and findOpenWindows so the meet
 * count and the slot scan agree.
 */
export function tripSegs(pts) {
  const P = stringPts(pts);
  const segs = [];
  for (let i = 0; i < P.length - 1; i++)
    segs.push({ a: P[i], b: P[i + 1], sym: P[i].sym, pass: P[i].mile === P[i + 1].mile && !!ST(P[i].st).hold && !P[i].block });
  return segs;
}

/** Segments of a ribbon edge, carrying the pass flags of the nominal
 *  segments they shadow (stringPts and tripSegs walk the same points). */
function edgeSegs(edge, nominal) {
  const segs = [];
  for (let i = 0; i < edge.length - 1; i++) segs.push({ a: edge[i], b: edge[i + 1], sym: nominal[i]?.sym, pass: nominal[i]?.pass ?? false });
  return segs;
}

/** Nominal string plus ribbon edges for one trip on one day, shifted by
 *  `off` minutes. `lines` is [nominal, early, late] (just [nominal] when the
 *  trip has no tolerance). Null when nothing of it falls in the day. */
function tripLines(t, d, restrictions, off = 0) {
  const pts = computeTrip(t, d, restrictions);
  const nominal = tripSegs(pts);
  const band = tolBand(stringPts(pts), t);
  const shift = (segs) =>
    segs
      .map((s) => ({ ...s, a: { ...s.a, t: s.a.t + off }, b: { ...s.b, t: s.b.t + off } }))
      .filter((s) => off >= 0 || s.b.t > 0);
  const lines = [shift(nominal)];
  if (band) lines.push(shift(edgeSegs(band.early, nominal)), shift(edgeSegs(band.late, nominal)));
  const quads = tolQuads(band).map((q) => q.map((p) => ({ ...p, t: p.t + off })));
  return lines[0].length ? { sym: tripName(t), lines, quads, tol: !!band } : null;
}

/**
 * POSSIBLE meets: places where two trains' tolerance ribbons overlap but
 * their nominal strings do not cross. A crossing of nominal lines is a
 * meet (findMeets, red). This is the second, softer grade — "if this one
 * runs at the late edge of what we know, it is on the road with that one"
 * — drawn hollow amber so a planner can weigh it rather than resolve it.
 *
 * Detection: every crossing among {nominal, early edge, late edge} of one
 * train against the same three of the other, minus nominal × nominal.
 * Trains without tolerance contribute only a nominal line, so a plan with
 * no tolerances set produces no possible meets at all. Crossings within
 * 20 min / 3 mi of each other (or of a real meet of the same pair) merge
 * into one marker. A string lying wholly INSIDE another's ribbon without
 * touching an edge is not caught; it would need the nominal to cross an
 * edge, which is the common case. ADVISORY ONLY, like findMeets.
 */
export function findPossibleMeets(trips, day, restrictions = []) {
  const prev = (day + 6) % 7;
  const sets = [];
  for (const t of trips) {
    if (!moves(t)) continue;
    if (t.days.includes(day)) {
      const l = tripLines(t, day, restrictions, 0);
      if (l) sets.push(l);
    }
    if (t.days.includes(prev)) {
      const l = tripLines(t, prev, restrictions, -1440);
      if (l) sets.push(l);
    }
  }
  const near = (x, y) => Math.abs(x.t - y.t) <= 30 && Math.abs(x.mile - y.mile) <= 5;
  // a string that ENTERS a ribbon through a siding dwell (a pass, so the
  // crossing is skipped) then runs on inside it never touches an edge —
  // catch it by testing its moving vertices for containment in the quads
  const inQuad = (pt, q) => {
    for (let k = 0; k < 4; k++) {
      const a = q[k];
      const b = q[(k + 1) % 4];
      // strictly inside: a vertex sitting ON an edge (a station the band's
      // edge is just passing) is not a shared stretch of road
      if ((b.t - a.t) * (pt.mile - a.mile) - (b.mile - a.mile) * (pt.t - a.t) <= 1e-9) return false;
    }
    return true;
  };
  // the symbol a train is running under at time t (crew changes en route)
  const symAt = (S, t) => {
    const segs = S.lines[0];
    const hit = segs.find((sg) => sg.a.t <= t && t <= sg.b.t);
    return (hit || (t > segs[segs.length - 1].b.t ? segs[segs.length - 1] : segs[0])).sym || S.sym;
  };
  const inside = (A, B) => {
    if (!A.quads.length) return [];
    const found = [];
    B.lines[0].forEach((s, i, segs) => {
      // vertex s.a of a moving segment, not the end of a hold dwell
      if (s.pass || (i > 0 && segs[i - 1].pass)) return;
      if (s.a.t < 0 || s.a.t >= 1440) return; // reported on the day it happens
      if (A.quads.some((q) => inQuad(s.a, q))) found.push({ t: s.a.t, mile: s.a.mile, symA: symAt(A, s.a.t), symB: s.sym || B.sym });
    });
    return found;
  };
  // crossings tagged with the segment pair they lie on (edge segments index
  // the same as the nominal ones they shadow)
  const cross = (A, B) => {
    const found = [];
    A.forEach((sa, ia) => {
      if (sa.pass) return;
      B.forEach((sb, ib) => {
        if (sb.pass) return;
        const x = segInt(sa.a, sa.b, sb.a, sb.b);
        if (x && x.t >= 0 && x.t < 1440) found.push({ ...x, ia, ib, symA: sa.sym, symB: sb.sym });
      });
    });
    return found;
  };

  const out = [];
  for (let i = 0; i < sets.length; i++) {
    for (let k = i + 1; k < sets.length; k++) {
      const A = sets[i];
      const B = sets[k];
      if (!A.tol && !B.tol) continue;
      const real = cross(A.lines[0], B.lines[0]);
      // a real meet on a segment pair owns that pair: the late edge crossing
      // the same two segments is the same meet shifted, not a second one
      const owned = new Set(real.map((r) => `${r.ia}:${r.ib}`));
      const cands = [];
      A.lines.forEach((la, ia) =>
        B.lines.forEach((lb, ib) => {
          if (ia === 0 && ib === 0) return;
          cands.push(...cross(la, lb));
        })
      );
      cands.push(...inside(A, B), ...inside(B, A).map((c) => ({ ...c, symA: c.symB, symB: c.symA })));
      cands.sort((x, y) => x.t - y.t);
      const kept = [];
      for (const c of cands) {
        if (c.ia != null && owned.has(`${c.ia}:${c.ib}`)) continue;
        if (real.some((r) => near(c, r))) continue;
        if (kept.some((r) => near(c, r))) continue;
        kept.push(c);
      }
      kept.forEach((c) => out.push({ t: c.t, mile: c.mile, a: c.symA || A.sym, b: c.symB || B.sym }));
    }
  }
  return out;
}

/**
 * Scan departure times for a proposed road movement and return the windows
 * where it can thread the existing plan — either nonstop, or by planning
 * meets the way a dispatcher would: hold at the last siding or yard before
 * a conflict and let the opposing train by.
 *
 * `candidate` needs `waypoints`; `time` is supplied by the scan. For each
 * crossing found, the run is re-planned with added dwell at the last
 * hold-capable station (STATIONS[].hold — sidings and yards from the ETT)
 * reached before the meet, waiting `buffer` minutes past the opposing
 * train clearing that point, then recomputed. A dwell at a hold station —
 * the candidate's own planned hold, or another train's scheduled work stop —
 * counts as being in the hole, so movements crossing it are planned siding
 * meets, not conflicts. Overtakes of a slower train ahead are not resolved
 * (holding doesn't fix them), and — like findMeets — no headway is enforced
 * between same-direction trains that never cross.
 *
 * Returns [{ from, to, kind, maxHold }]: departures in [from, to) work;
 * kind "clear" runs nonstop, kind "hold" needs planned holds of up to
 * maxHold minutes. ADVISORY ONLY — a planner confirms, nothing is authorized.
 */
export function findOpenWindows(candidate, trips, day, restrictions = [], opts = {}) {
  // buffer default 15, not 10 (ops review, Aug 2026): even with perfect
  // coordination, hand-throw switch mechanics at a siding cost 5-10 min
  // on top of clearing time — a planned meet is never zero-dwell.
  const { step = 5, maxHold = 180, buffer = 15 } = opts;

  // Traffic is three days deep: yesterday's departures still on the road
  // (shifted -24 h), today's, and tomorrow's (shifted +24 h) for candidate
  // runs that themselves spill past midnight.
  const prev = (day + 6) % 7;
  const next = (day + 1) % 7;
  const otherSegs = [];
  // A train with a tolerance occupies its whole ribbon here, not just its
  // nominal string: the scan advises Parallel departures and should be
  // conservative, so the early and late edges join the nominal segments
  // (nominal first, late edge last — clearedAt's fallback reads the tail).
  const occupied = (t, d, by) => {
    const l = tripLines(t, d, restrictions, by);
    return l ? l.lines.flat() : [];
  };
  for (const t of trips) {
    if (!moves(t) || t.id === candidate.id) continue;
    if (t.days.includes(day)) otherSegs.push(occupied(t, day, 0));
    if (t.days.includes(prev)) {
      const s = occupied(t, prev, -1440);
      if (s.length) otherSegs.push(s);
    }
    if (t.days.includes(next)) otherSegs.push(occupied(t, next, 1440));
  }

  /* Last time an opposing string is at `mile`; if it never reaches it, the
     train ties down before getting there and is clear after its final time. */
  const clearedAt = (B, mile) => {
    let latest = -Infinity;
    for (const s of B) {
      const lo = Math.min(s.a.mile, s.b.mile);
      const hi = Math.max(s.a.mile, s.b.mile);
      if (mile < lo || mile > hi) continue;
      const f = hi === lo ? 1 : (mile - s.a.mile) / (s.b.mile - s.a.mile);
      latest = Math.max(latest, s.a.t + f * (s.b.t - s.a.t));
    }
    return latest === -Infinity ? B[B.length - 1].b.t : latest;
  };

  const firstCrossing = (A) => {
    let best = null;
    for (const B of otherSegs)
      for (const sa of A) {
        if (sa.pass) continue;
        for (const sb of B) {
          if (sb.pass) continue;
          const x = segInt(sa.a, sa.b, sb.a, sb.b);
          if (x && (!best || x.t < best.t)) best = { ...x, B };
        }
      }
    return best;
  };

  /* Total hold minutes needed to run at t0, or null when infeasible. */
  const tryRun = (t0) => {
    const wps = candidate.waypoints.map((w) => ({ ...w }));
    let hold = 0;
    for (let iter = 0; iter < 12; iter++) {
      const pts = computeTrip({ ...candidate, type: "road", waypoints: wps, time: t0 }, day, restrictions);
      if (pts.some((p) => p.mph === 0)) return null; // out-of-service window
      const x = firstCrossing(tripSegs(pts));
      if (!x) return hold;

      // last hold-capable station reached before the meet (never the origin —
      // waiting there is just a later departure, which the scan already covers)
      let hi = -1;
      for (let i = 1; i < pts.length; i++) {
        if ((pts[i].arrive ?? pts[i].depart) <= x.t && ST(pts[i].st).hold) hi = i;
      }
      if (hi < 0) return null;

      const extra = clearedAt(x.B, pts[hi].mile) + buffer - (pts[hi].depart ?? pts[hi].arrive);
      if (extra <= 0) return null; // opposer already past: an overtake, not a meet
      if (hold + extra > maxHold) return null;
      wps[hi] = { ...wps[hi], stop: true, dwell: (wps[hi].dwell || 0) + extra };
      hold += extra;
    }
    return null;
  };

  const windows = [];
  let cur = null;
  for (let t0 = 0; t0 <= 1440; t0 += step) {
    const r = t0 < 1440 ? tryRun(t0) : null;
    const kind = r == null ? null : r === 0 ? "clear" : "hold";
    if (cur && kind !== cur.kind) {
      windows.push(cur);
      cur = null;
    }
    if (kind && !cur) cur = { from: t0, to: Math.min(t0 + step, 1440), kind, maxHold: r };
    else if (cur) {
      cur.to = Math.min(t0 + step, 1440);
      cur.maxHold = Math.max(cur.maxHold, r);
    }
  }
  if (cur) windows.push(cur);
  return windows;
}

/** True when a road trip runs west (toward Macon). Used to split the timetable. */
export function isWestbound(trip) {
  if (!moves(trip) || trip.waypoints.length < 2) return false;
  const first = ST(trip.waypoints[0].st).mile;
  const last = ST(trip.waypoints[trip.waypoints.length - 1].st).mile;
  return last < first;
}

/** Export the current day's plan as tab-delimited text for a spreadsheet. */
export function toTSV(trips, day, restrictions = []) {
  // Earliest / Latest: the tolerance band at each point (blank when the
  // trip carries no tolerance) — the same numbers the ribbon draws.
  const rows = [["Train", "Type", "Waypoint", "Mile", "Arrive", "Depart", "MPH", "Earliest", "Latest"]];
  trips
    .filter((t) => t.days.includes(day))
    .forEach((t) => {
      const pts = computeTrip(t, day, restrictions);
      const band0 = moves(t) ? tolBand(stringPts(pts), t) : null;
      pts.forEach((p) => {
        const at = p.arrive ?? p.depart;
        // the band at this point's arrival (origin: its departure), read off
        // the same edges the ribbon draws
        let band = null;
        if (band0) {
          const i = band0.early.findIndex((q) => q.st === p.st && q.t === at);
          if (i >= 0) band = { early: at - band0.early[i].t, late: band0.late[i].t - at };
        }
        rows.push([
          p.symArr && p.symArr !== p.sym ? `${p.symArr} → ${p.sym}` : p.sym || t.symbol,
          t.type,
          ST(p.st).name,
          String(p.mile),
          p.arrive == null ? "" : fmt(p.arrive),
          p.depart == null ? "" : fmt(p.depart),
          p.mph == null ? "" : String(Math.round(p.mph)),
          band ? fmt(at - band.early) : "",
          band ? fmt(at + band.late) : "",
        ]);
      });
    });
  return rows.map((r) => r.join("\t")).join("\n");
}
