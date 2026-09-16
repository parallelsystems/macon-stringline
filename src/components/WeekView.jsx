import React, { useMemo } from "react";
import { STATIONS, TYPES, DAYS, TOTAL_MI } from "../data/network.js";
import { computeTrip, stringPts, findMeets, findPossibleMeets, tolBand, tolQuads, tripName } from "../lib/schedule.js";
import { BRAND } from "../theme.js";

/**
 * Week-summary stringline: Monday through Sunday on one continuous time
 * axis, every visible trip on every day it runs, overnight tails spilling
 * into the next day's column. Read-only — built for the "what does the
 * week look like" conversation (and the screenshot of it).
 *
 * Same computation as the daily view: computeTrip per (trip, day), plus
 * findMeets per day so planned-meet diamonds appear exactly where the
 * daily view would flag them.
 */

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // columns Mon..Sun
const WEEK = 7 * 1440;

export default function WeekView({ trips, restrictions, sel, onSel }) {
  const W = 1460;
  const H = 620;
  const ML = 78;
  const MR = 12;
  const MT = 26;
  const MB = 30;
  const PW = W - ML - MR;
  const PH = H - MT - MB;
  const x = (t) => ML + (Math.min(Math.max(t, 0), WEEK) / WEEK) * PW;
  const y = (m) => MT + (m / TOTAL_MI) * PH;

  const { strings, bars, meets, possible, ribbons, labels } = useMemo(() => {
    const strings = [];
    const bars = [];
    const meets = [];
    const possible = [];
    const ribbons = [];
    // location jobs sharing a station stack into lanes so bars don't cover
    // each other (Y103 and MOW both work Dublin)
    const lanes = {};
    for (const t of trips) {
      if (!TYPES[t.type]?.moves) {
        const st = t.waypoints[0].st;
        if (!(`${st}:${t.id}` in lanes)) {
          lanes[`${st}:${t.id}`] = Object.keys(lanes).filter((k) => k.startsWith(`${st}:`)).length;
        }
      }
    }
    for (const t of trips) {
      const moves = !!TYPES[t.type]?.moves;
      for (const d of t.days) {
        const col = ORDER.indexOf(d);
        if (col < 0) continue;
        const off = col * 1440;
        if (!moves) {
          const s = STATIONS.find((st) => st.id === t.waypoints[0].st) || STATIONS[0];
          const lane = lanes[`${t.waypoints[0].st}:${t.id}`] || 0;
          bars.push({ id: `${t.id}@${d}`, trip: t, x1: t.time + off, x2: t.time + (t.work || 0) + off, mile: s.mile, lane });
          continue;
        }
        // clip segments to the week window so Sunday tails don't overshoot
        const pts = stringPts(computeTrip(t, d, restrictions)).map((p) => ({ ...p, t: p.t + off }));
        // tolerance ribbon (x() clamps to the week, so a Sunday tail just flattens)
        const quads = tolQuads(tolBand(pts, t));
        if (quads.length) ribbons.push({ id: `R${t.id}@${d}`, trip: t, quads });
        const out = [];
        for (let i = 0; i < pts.length - 1; i++) {
          let a = { ...pts[i] };
          let b = { ...pts[i + 1] };
          if (b.t < 0 || a.t > WEEK) continue;
          if (b.t > WEEK) {
            const f = (WEEK - a.t) / (b.t - a.t);
            b = { t: WEEK, mile: a.mile + f * (b.mile - a.mile) };
          }
          if (!out.length) out.push(a);
          out.push(b);
        }
        if (out.length > 1) strings.push({ id: `${t.id}@${d}`, trip: t, pts: out });
      }
    }
    for (const d of ORDER) {
      const off = ORDER.indexOf(d) * 1440;
      for (const m of findMeets(trips, d, restrictions)) meets.push({ ...m, t: m.t + off });
      for (const m of findPossibleMeets(trips, d, restrictions)) possible.push({ ...m, t: m.t + off });
    }
    return { strings, bars, meets, possible, ribbons, labels: null };
  }, [trips, restrictions]);

  // Label layout with collision resolution: every label wants to sit by its
  // departure point; when two land within a text-width of each other, the
  // later one steps down in 10px rows until it's clear.
  const placedLabels = useMemo(() => {
    const want = [];
    for (const s of strings) {
      const sx = x(s.pts[0].t);
      const sy = y(s.pts[0].mile);
      const text = s.pts[0].sym || s.trip.symbol;
      want.push({
        key: s.id,
        x: sx + 3,
        y: sy < MT + 16 ? sy + 12 : sy - 5,
        text,
        color: s.trip.color || TYPES[s.trip.type].color,
        tripId: s.trip.id,
        w: text.length * 6.2,
      });
      // crew change en route: label the new symbol where it takes over
      for (let i = 1; i < s.pts.length; i++) {
        if (!s.pts[i].sym || s.pts[i].sym === s.pts[i - 1].sym) continue;
        const py = y(s.pts[i].mile);
        want.push({
          key: `${s.id}#${i}`,
          x: x(s.pts[i].t) + 3,
          y: py < MT + 16 ? py + 12 : py - 5,
          text: s.pts[i].sym,
          color: s.trip.color || TYPES[s.trip.type].color,
          tripId: s.trip.id,
          w: s.pts[i].sym.length * 6.2,
        });
      }
    }
    for (const b of bars) {
      // jobs stacked at one station stack their labels vertically above it
      want.push({
        key: `L${b.id}`,
        x: x(b.x1) + 2,
        y: y(b.mile) - 5 - b.lane * 10,
        text: b.trip.symbol,
        color: b.trip.color || TYPES[b.trip.type].color,
        tripId: b.trip.id,
        dim: true,
        nudged: true, // keep bar labels anchored; only strings shift sideways
        w: b.trip.symbol.length * 6.2,
      });
    }
    want.sort((a, b) => a.x - b.x || a.y - b.y);
    const placed = [];
    const collide = (a, b) => a.x < b.x + b.w + 4 && b.x < a.x + a.w + 4 && Math.abs(a.y - b.y) < 10;
    for (const l of want) {
      const cur = { ...l };
      let guard = 0;
      while (guard++ < 8) {
        const hit = placed.find((p) => collide(cur, p));
        if (!hit) break;
        // first choice: nudge the earlier label left so both sit on their
        // own line (e.g. L781R slides left of L782R at Collins)
        if (!hit.nudged) {
          const need = hit.x + hit.w + 4 - cur.x;
          const moved = { ...hit, x: hit.x - need, nudged: true };
          hit.nudged = true;
          if (need <= 40 && !collide(cur, moved) && !placed.some((p) => p !== hit && collide(moved, p))) {
            hit.x = moved.x;
            continue;
          }
        }
        // fall back: step the later label down a row
        cur.y += 10;
      }
      placed.push(cur);
    }
    return placed;
  }, [strings, bars]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label="Week summary stringline, Monday through Sunday">
      {/* station gridlines */}
      {STATIONS.map((s) => (
        <g key={s.id}>
          <line x1={ML} y1={y(s.mile)} x2={W - MR} y2={y(s.mile)} stroke="#e5e5e5" strokeWidth="1" />
          <text x={ML - 6} y={y(s.mile) + 3} textAnchor="end" fontSize="9" fill="#737373" fontFamily="ui-monospace, monospace">
            {s.name}
          </text>
        </g>
      ))}
      {/* day columns */}
      {ORDER.map((d, i) => (
        <g key={d}>
          <line x1={x(i * 1440)} y1={MT} x2={x(i * 1440)} y2={H - MB} stroke="#d4d4d4" strokeWidth="1" />
          <text
            x={x(i * 1440 + 720)}
            y={MT - 9}
            textAnchor="middle"
            fontSize="10"
            fontWeight="700"
            fill="#525252"
            fontFamily="ui-monospace, monospace"
          >
            {DAYS[d].toUpperCase()}
          </text>
          {[360, 720, 1080].map((hh) => (
            <line
              key={hh}
              x1={x(i * 1440 + hh)}
              y1={MT}
              x2={x(i * 1440 + hh)}
              y2={H - MB}
              stroke="#f0f0f0"
              strokeWidth="1"
            />
          ))}
          {[[360, "06"], [720, "12"], [1080, "18"]].map(([hh, lab]) => (
            <text key={hh} x={x(i * 1440 + hh)} y={H - MB + 14} textAnchor="middle" fontSize="8" fill="#a3a3a3" fontFamily="ui-monospace, monospace">
              {lab}:00
            </text>
          ))}
        </g>
      ))}
      <line x1={W - MR} y1={MT} x2={W - MR} y2={H - MB} stroke="#d4d4d4" strokeWidth="1" />

      {/* location jobs as occupancy bars, stacked into lanes per station */}
      {bars.map((b) => (
        <line
          key={b.id}
          x1={x(b.x1)}
          y1={y(b.mile) + b.lane * 7}
          x2={x(b.x2)}
          y2={y(b.mile) + b.lane * 7}
          stroke={b.trip.color || TYPES[b.trip.type].color}
          strokeWidth={b.trip.unsourced ? 2 : 5}
          strokeDasharray={b.trip.unsourced ? "4 3" : undefined}
          opacity={b.trip.unsourced ? 0.55 : 0.3}
        />
      ))}

      {/* tolerance ribbons, under the strings */}
      {ribbons.map((r) => {
        const on = sel === r.trip.id;
        const c = r.trip.color || TYPES[r.trip.type].color;
        return (
          <path
            key={r.id}
            d={r.quads.map((q) => `M${q.map((p) => `${x(p.t).toFixed(1)},${y(p.mile).toFixed(1)}`).join("L")}Z`).join("")}
            fill={c}
            fillRule="nonzero"
            opacity={sel && !on ? 0.05 : 0.14}
            pointerEvents="none"
          />
        );
      })}

      {/* road strings */}
      {strings.map((s) => {
        const on = sel === s.trip.id;
        const c = s.trip.color || TYPES[s.trip.type].color;
        return (
          <polyline
            key={s.id}
            points={s.pts.map((p) => `${x(p.t).toFixed(1)},${y(p.mile).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={c}
            strokeWidth={on ? 3 : s.trip.type === "parallel" ? 1.8 : 1.2}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={sel && !on ? 0.3 : 1}
            style={{ cursor: "pointer" }}
            onClick={() => onSel?.(on ? null : s.trip.id)}
          >
            <title>{`${tripName(s.trip)} — ${s.trip.note || ""}`}</title>
          </polyline>
        );
      })}

      {/* train symbols, collision-resolved */}
      {placedLabels.map((l) => {
        const on = sel === l.tripId;
        return (
          <text
            key={l.key}
            x={l.x}
            y={l.y}
            fontSize="9"
            fontWeight="700"
            fill={l.color}
            opacity={l.dim ? 0.75 : sel && !on ? 0.3 : 1}
            fontFamily="ui-monospace, monospace"
            style={{ cursor: "pointer" }}
            onClick={() => onSel?.(on ? null : l.tripId)}
          >
            {l.text}
          </text>
        );
      })}

      {/* possible meets — hollow amber */}
      {possible.map((m, i) => (
        <rect
          key={`p${i}`}
          x={x(m.t) - 3}
          y={y(m.mile) - 3}
          width="6"
          height="6"
          transform={`rotate(45 ${x(m.t)} ${y(m.mile)})`}
          fill="#fff"
          stroke="#b45309"
          strokeWidth="1.2"
          strokeDasharray="1.5 1"
        >
          <title>{`Possible meet ${m.a} × ${m.b} (within a tolerance band)`}</title>
        </rect>
      ))}

      {/* meets */}
      {meets.map((m, i) => (
        <rect
          key={i}
          x={x(m.t) - 3}
          y={y(m.mile) - 3}
          width="6"
          height="6"
          transform={`rotate(45 ${x(m.t)} ${y(m.mile)})`}
          fill="#fff"
          stroke={BRAND.colors?.accent || "#dc2626"}
          strokeWidth="1.6"
        >
          <title>{`${m.a} × ${m.b}`}</title>
        </rect>
      ))}
    </svg>
  );
}
