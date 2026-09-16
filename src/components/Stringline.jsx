import React, { useState, useMemo, useRef, useCallback } from "react";
import { DAYS, STATIONS, TOTAL_MI, YARD_LIMITS, SPEED_LIMITS, SWITCHES, TYPES, ST } from "../data/network.js";
import { computeTrip, stringPts, findMeets, findPossibleMeets, effSpeed, fmt, fmtColon, zonesFor, jobRange, tolOf, hasTol, tolAllow, tolBand, tolQuads, tolLegs, tripName } from "../lib/schedule.js";
import { BRAND } from "../theme.js";

/* Fixed viewBox; the SVG scales to its container. Margins leave room for the
   station gutter on the left and the hour ruler on top. */
const VW = 1120;
const VH = 800;
const MG = { t: 50, r: 26, b: 46, l: 150 };
const PW = VW - MG.l - MG.r;
const PH = VH - MG.t - MG.b;

export default function Stringline({
  trips,
  restrictions,
  day,
  sel,
  onSel,
  onShift,
  onResize,
  onRelocate,
  onRange,
  onTol,
  win,
  showTimes,
  showSpeeds,
  showSwitches,
  slotWins = [],
}) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
  const [hov, setHov] = useState(null);
  const [cursor, setCursor] = useState(null); // { t, mile } under the pointer

  const span = win[1] - win[0];
  const X = (t) => MG.l + ((t - win[0]) / span) * PW;
  const Y = (mi) => MG.t + (mi / TOTAL_MI) * PH;

  // Layers: the PREVIOUS day's overnight tails always render (shifted -24 h,
  // so a run that left yesterday and is still on the road this morning shows
  // up — same convention findMeets already uses), and a window wider than
  // one day (the "Cycle" zoom) also renders the NEXT day's traffic.
  const nextDay = (day + 1) % 7;
  const prevDay = (day + 6) % 7;
  const twoDay = win[1] > 1440;
  const layers = useMemo(
    () => [
      { day: prevDay, off: -1440, tailOnly: true },
      { day, off: 0 },
      ...(twoDay ? [{ day: nextDay, off: 1440 }] : []),
    ],
    [day, prevDay, nextDay, twoDay]
  );
  const meets = useMemo(() => {
    const out = [...findMeets(trips, day, restrictions)];
    if (twoDay)
      out.push(...findMeets(trips, nextDay, restrictions).map((m) => ({ ...m, t: m.t + 1440 })));
    return out;
  }, [trips, day, nextDay, twoDay, restrictions]);
  // possible meets: ribbons overlapping with no nominal crossing — hollow amber
  const possible = useMemo(() => {
    const out = [...findPossibleMeets(trips, day, restrictions)];
    if (twoDay)
      out.push(...findPossibleMeets(trips, nextDay, restrictions).map((m) => ({ ...m, t: m.t + 1440 })));
    return out;
  }, [trips, day, nextDay, twoDay, restrictions]);

  /* Convert a client X coordinate to minutes, accounting for SVG scaling. */
  const toMin = useCallback(
    (cx) => {
      const r = ref.current.getBoundingClientRect();
      return ((((cx - r.left) * (VW / r.width)) - MG.l) / PW) * span + win[0];
    },
    [span, win]
  );

  /* Convert a client Y coordinate to a mile, then to the nearest station. */
  const toMile = useCallback((cy) => {
    const r = ref.current.getBoundingClientRect();
    return (((cy - r.top) * (VH / r.height) - MG.t) / PH) * TOTAL_MI;
  }, []);
  const nearestStation = (mile) =>
    STATIONS.reduce((best, s) => (Math.abs(s.mile - mile) < Math.abs(best.mile - mile) ? s : best), STATIONS[0]);

  const down = (e, t, mode = "move", extra = {}) => {
    e.stopPropagation();
    onSel(t.id);
    // location jobs (yard / local / MOW) drag in two dimensions: sideways
    // retimes, up/down relocates the base point to the nearest station
    const loc = !TYPES[t.type].moves;
    const rg = loc ? jobRange(t) : null;
    setDrag({
      id: t.id, at: toMin(e.clientX), acc: 0, mode, loc, st: t.waypoints[0].st, w: rg?.w ?? null, e: rg?.e ?? null,
      // tolerance handle: { wpIdx, tol0 } — the leg-end waypoint and the
      // allowance in force there when the drag started
      ...extra,
    });
  };

  const move = (e) => {
    // crosshair: track the time (and mile) under the pointer while inside the plot
    const r = ref.current.getBoundingClientRect();
    const t = toMin(e.clientX);
    const yv = (e.clientY - r.top) * (VH / r.height);
    const mile = ((yv - MG.t) / PH) * TOTAL_MI;
    if (t >= win[0] && t <= win[1] && mile >= 0 && mile <= TOTAL_MI) setCursor({ t, mile });
    else setCursor(null);

    if (!drag) return;

    // tolerance handle on a leg: drag ▸ right to widen how LATE the train
    // may be by the end of that leg, ◂ left for how early. 5-min steps; the
    // ribbon follows live and later legs inherit unless they have their own.
    if (drag.mode === "tolL" || drag.mode === "tolE") {
      const d = toMin(e.clientX) - drag.at;
      const side = drag.mode === "tolL" ? "late" : "early";
      const raw = side === "late" ? drag.tol0.late + d : drag.tol0.early - d;
      const v = Math.max(0, Math.round(raw / 5) * 5);
      const cur = drag.tolCur || drag.tol0;
      if (v !== cur[side]) {
        const next = { early: Math.round(cur.early), late: Math.round(cur.late), [side]: v };
        onTol?.(drag.id, drag.wpIdx, next);
        setDrag((p) => ({ ...p, tolCur: next }));
      }
      return;
    }

    // vertical: relocate a location job's base point, or its territory's
    // far end, to whichever station is under the pointer
    if (drag.loc && (drag.mode === "move" || drag.mode === "edgeW" || drag.mode === "edgeE")) {
      const near = nearestStation(toMile(e.clientY));
      const base = ST(drag.st);
      if (drag.mode === "move") {
        if (near.id !== drag.st) {
          onRelocate?.(drag.id, near.id);
          setDrag((p) => ({ ...p, st: near.id }));
        }
      } else {
        // stretch the coverage band: the west edge can only reach stations
        // west of the base, the east edge only east; pulling an edge back
        // onto (or past) the base collapses that side
        const w = drag.mode === "edgeW" ? (near.mile < base.mile ? near.id : null) : drag.w;
        const ev = drag.mode === "edgeE" ? (near.mile > base.mile ? near.id : null) : drag.e;
        if (w !== drag.w || ev !== drag.e) {
          onRange?.(drag.id, { w, e: ev });
          setDrag((p) => ({ ...p, w, e: ev }));
        }
        return; // edges only move vertically
      }
    }

    const d = toMin(e.clientX) - drag.at - drag.acc;
    if (Math.abs(d) < 0.5) return;
    // "resize" drags the right end of an occupancy bar — changes hours on
    // duty; "move" retimes the whole job / string.
    if (drag.mode === "resize") onResize?.(drag.id, d);
    else onShift(drag.id, d);
    setDrag((p) => ({ ...p, acc: p.acc + d }));
  };

  const hours = [];
  for (let h = Math.floor(win[0] / 60); h <= Math.ceil(win[1] / 60); h++) hours.push(h);
  const tickEvery = span > 900 ? 2 : 1;

  // Train-symbol label layout with collision stepping: each label wants to
  // sit at its string's first visible point; when two land within a text
  // width of each other (e.g. three Parallel departures 20 min apart), the
  // later one steps down a row until it's clear.
  const labelPlan = (() => {
    const want = [];
    for (const { day: ld, off, tailOnly } of layers) {
      for (const t of trips) {
        if (!t.days.includes(ld) || !TYPES[t.type].moves) continue;
        const sp = stringPts(computeTrip(t, ld, restrictions)).map((p) => ({ ...p, t: p.t + off }));
        if (sp.length < 2) continue;
        if (tailOnly && sp[sp.length - 1].t <= 0) continue;
        const lp = sp.find((p) => p.t >= win[0]) ?? sp[0];
        const key = `${t.id}@${off}`;
        want.push({
          key,
          text: lp.sym || t.symbol,
          x: X(lp.t) + 7,
          y: Math.max(Y(lp.mile) - 8, MG.t + 13),
          w: (lp.sym || t.symbol).length * 7 + 6,
        });
        // a crew change en route (Y120 → L782R at Collins) labels the new
        // symbol where it takes over, so each leg reads under its own name
        for (let i = 1; i < sp.length; i++) {
          if (sp[i].sym === sp[i - 1].sym || sp[i].t < win[0] || sp[i].t > win[1]) continue;
          want.push({ key, text: sp[i].sym, x: X(sp[i].t) + 7, y: Math.max(Y(sp[i].mile) - 8, MG.t + 13), w: sp[i].sym.length * 7 + 6 });
        }
      }
    }
    want.sort((a, b) => a.x - b.x || a.y - b.y);
    const placed = [];
    const out = {};
    for (const l of want) {
      let y = l.y;
      let guard = 0;
      while (guard++ < 8 && placed.some((p) => l.x < p.x + p.w && p.x < l.x + l.w && Math.abs(y - p.y) < 12)) y += 12;
      placed.push({ ...l, y });
      (out[l.key] ||= []).push({ x: l.x, y, text: l.text });
    }
    return out;
  })();

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${VW} ${VH}`}
      className="w-full"
      style={{ touchAction: "none", cursor: drag ? "grabbing" : "default", userSelect: "none" }}
      onPointerMove={move}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => {
        setDrag(null);
        setCursor(null);
      }}
      onClick={() => onSel(null)}
    >
      <rect x={MG.l} y={MG.t} width={PW} height={PH} fill="#fcfcfc" />

      {/* find-a-slot: departure windows that thread the plan without a meet */}
      {slotWins.map((w, i) => {
        const a = Math.max(w.from, win[0]);
        const b = Math.min(w.to, win[1]);
        if (b <= a) return null;
        return (
          <rect
            key={i}
            x={X(a)}
            y={MG.t}
            width={X(b) - X(a)}
            height={PH}
            fill={w.kind === "hold" ? BRAND.colors.yellow.base : BRAND.colors.green.base}
            opacity={w.kind === "hold" ? 0.1 : 0.08}
          />
        );
      })}

      {/* yard limits — shaded band, plain "YL" tag. The authorized speeds
          inside each band read from the LIMIT strip, where every zone is
          labeled in one consistent format (hover the band for the words). */}
      {YARD_LIMITS.map((y) => {
        const zones = SPEED_LIMITS.filter((z) => z.b > y.a && z.a < y.b);
        const speeds = zones.map((z) => z.mph).filter((v, i, arr) => i === 0 || v !== arr[i - 1]);
        return (
          <g key={y.id}>
            <title>{`${y.label} yard limits — authorized ${speeds.join(" then ")} MPH within (GO#3)`}</title>
            <rect x={MG.l} y={Y(y.a)} width={PW} height={Y(y.b) - Y(y.a)} fill="#0ea5e9" opacity={0.055} />
            <line x1={MG.l} y1={Y(y.a)} x2={MG.l + PW} y2={Y(y.a)} stroke="#0369a1" strokeWidth={0.5} strokeDasharray="2 4" opacity={0.5} />
            <line x1={MG.l} y1={Y(y.b)} x2={MG.l + PW} y2={Y(y.b)} stroke="#0369a1" strokeWidth={0.5} strokeDasharray="2 4" opacity={0.5} />
            <text x={MG.l + 5} y={Y((y.a + y.b) / 2) + 3} fontSize={9} fill="#075985" fontFamily="ui-monospace, monospace" letterSpacing={0.7} opacity={0.8}>
              YL
            </text>
          </g>
        );
      })}

      {/* main track switches — one tick per documented switch on the left
          edge of the plot (TT#4 Macon list + GO#3 Savannah list). Ticks,
          not labels: ~75 switches would bury the diagram in text, and the
          planning questions they answer ("is there a switch here?", "whose
          lead is that?") read fine from a tick + hover. OOS switches
          (Montrose) draw hollow red. */}
      {showSwitches &&
        SWITCHES.map((s, i) => (
          <g key={i}>
            <line
              x1={MG.l}
              y1={Y(s.mile)}
              x2={MG.l + 7}
              y2={Y(s.mile)}
              stroke={s.oos ? "#b91c1c" : "#525252"}
              strokeWidth={s.oos ? 1 : 1.4}
              strokeDasharray={s.oos ? "2 2" : undefined}
            >
              <title>{`${s.name} — MP ${s.mp}${s.oos ? " (OUT OF SERVICE, GO#3)" : ""}`}</title>
            </line>
          </g>
        ))}

      {/* track restrictions */}
      {layers.flatMap(({ day: ld, off }) =>
        restrictions
          .filter((r) => r.days.includes(ld))
          .map((r) => {
            const a = Math.min(ST(r.from).mile, ST(r.to).mile);
            const b = Math.max(ST(r.from).mile, ST(r.to).mile);
            const oos = r.kind === "oos";
            return (
              <g key={`${r.id}@${off}`}>
                <rect
                  x={X(r.t0 + off)}
                  y={Y(a)}
                  width={Math.max(X(r.t1 + off) - X(r.t0 + off), 2)}
                  height={Y(b) - Y(a)}
                  fill={oos ? "#dc2626" : "#a16207"}
                  opacity={0.16}
                  stroke={oos ? "#991b1b" : "#854d0e"}
                  strokeWidth={0.8}
                />
                <text x={X(r.t0 + off) + 6} y={Y(a) + 24} fontSize={9.5} fill="#713f12" fontFamily="ui-monospace, monospace" letterSpacing={0.5}>
                  {oos ? "OUT OF SERVICE" : `${r.mph} MPH`}
                </text>
              </g>
            );
          })
      )}

      {/* hour ruler — labels top and bottom so a time is always near an edge */}
      {hours.map((h) => {
        const t = h * 60;
        if (t < win[0] - 1 || t > win[1] + 1) return null;
        const major = h % 6 === 0;
        const label = `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;
        return (
          <g key={h}>
            <line x1={X(t)} y1={MG.t} x2={X(t)} y2={MG.t + PH} stroke={major ? "#8a8a8a" : "#e5e5e5"} strokeWidth={major ? 1.1 : 0.55} />
            {h % tickEvery === 0 && (
              <>
                <text
                  x={X(t)}
                  y={MG.t - 10}
                  textAnchor="middle"
                  fontSize={major ? 12 : 10.5}
                  fontWeight={major ? 700 : 400}
                  fill={major ? "#333333" : "#525252"}
                  fontFamily="ui-monospace, monospace"
                >
                  {label}
                </text>
                <text
                  x={X(t)}
                  y={MG.t + PH + 17}
                  textAnchor="middle"
                  fontSize={major ? 12 : 10.5}
                  fontWeight={major ? 700 : 400}
                  fill={major ? "#333333" : "#525252"}
                  fontFamily="ui-monospace, monospace"
                >
                  {label}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* station gutter — one label line per station, de-collided so close
          stations (Meldrim / Pooler / Plastic Express) never stack. The label
          may nudge off its exact tick; the tick line stays at true mile.
          "~" marks estimated chainage; the dot marks a siding/yard hold point.
          Full milepost is in the hover tooltip. */}
      {(() => {
        const minGap = 13.5;
        const ys = STATIONS.map((s) => Y(s.mile));
        const lab = [...ys];
        for (let i = 1; i < lab.length; i++) lab[i] = Math.max(lab[i], lab[i - 1] + minGap);
        lab[lab.length - 1] = Math.min(lab[lab.length - 1], MG.t + PH - 2);
        for (let i = lab.length - 2; i >= 0; i--) lab[i] = Math.min(lab[i], lab[i + 1] - minGap);
        return STATIONS.map((s, i) => (
          <g key={s.id}>
            <title>{`${s.name} — ${s.mp}, mile ${s.mile}${s.src === "est" ? " (estimated)" : ""}${s.hold ? ", siding/yard hold point" : ""}`}</title>
            <line x1={MG.l} y1={ys[i]} x2={MG.l + PW} y2={ys[i]} stroke="#d4d4d4" strokeWidth={0.65} />
            {s.hold && <circle cx={MG.l - 5} cy={ys[i]} r={2.3} fill="#8a8a8a" />}
            <text x={MG.l - 11} y={lab[i] + 3.5} textAnchor="end" fontSize={11} fill="#171717" fontWeight={600}>
              {s.name}
              <tspan fontSize={8.5} fontWeight={400} fill={s.src === "est" ? "#b45309" : "#a3a3a3"}>
                {" "}
                {/* G&W's printed milepost — their numbers; the chart's own
                    axis stays monotonic chainage (tooltip carries both) */}
                {s.src === "est" ? "~" : s.mp}
              </tspan>
            </text>
          </g>
        ));
      })()}

      {/* occupancy bars: yard / local / MOW — bars at the same station stack
          downward so co-located jobs (Y103 + MOW at Dublin) stay separate;
          labels alternate above / below the bar so they never merge */}
      {layers.map(({ day: ld, off, tailOnly }) => {
        if (tailOnly) return null; // location jobs never span midnight
        const list = trips
          .filter((t) => t.days.includes(ld) && !TYPES[t.type].moves)
          .map((t) => ({ t, p: computeTrip(t, ld, restrictions)[0] }))
          .sort((a, b) => a.p.mile - b.p.mile || a.p.arrive - b.p.arrive);
        let prevMile = null;
        let prevBottom = 0;
        let idx = 0;
        return (
          <g key={`bars@${off}`}>
            {list.map(({ t, p }) => {
              const on = sel === t.id;
              const hot = on || hov === t.id;
              const h = t.type === "mow" ? 7 : 13;
              idx = p.mile === prevMile ? idx + 1 : 0;
              let cy = idx === 0 ? Y(p.mile) : prevBottom + 3 + h / 2;
              cy = Math.min(Math.max(cy, MG.t + h / 2 + 1), MG.t + PH - h / 2 - 1);
              prevMile = p.mile;
              prevBottom = cy + h / 2;
              const above = cy - h / 2 - 5;
              const labelY = idx % 2 === 1 ? cy + h / 2 + 11 : above < MG.t + 12 ? cy + h / 2 + 12 : above;
              const rg = jobRange(t);
              const hasBand = rg.hi > rg.lo;
              const x0 = X(p.arrive + off);
              const bw = Math.max(X(p.depart + off) - X(p.arrive + off), 3);
              const color = TYPES[t.type].color;
              // edge handles: a wide invisible strip along each band edge plus a
              // visible tab when hovered; with no band both sit on the bar
              const yW = hasBand ? Y(rg.lo) : cy - h / 2;
              const yE = hasBand ? Y(rg.hi) : cy + h / 2;
              const Edge = ({ y, mode, label }) => (
                <g style={{ cursor: "ns-resize" }} onPointerDown={(e) => down(e, t, mode)} opacity={hot ? 1 : 0}>
                  <title>{label}</title>
                  <rect x={x0} y={y - 5} width={bw} height={10} fill="transparent" />
                  <line x1={x0} y1={y} x2={x0 + bw} y2={y} stroke={color} strokeWidth={2} />
                  <path
                    d={mode === "edgeW"
                      ? `M${x0 + bw / 2 - 5},${y - 2} L${x0 + bw / 2},${y - 8} L${x0 + bw / 2 + 5},${y - 2} Z`
                      : `M${x0 + bw / 2 - 5},${y + 2} L${x0 + bw / 2},${y + 8} L${x0 + bw / 2 + 5},${y + 2} Z`}
                    fill={color}
                  />
                </g>
              );
              return (
                <g
                  key={`${t.id}@${off}`}
                  onPointerDown={(e) => down(e, t)}
                  onPointerEnter={() => setHov(t.id)}
                  onPointerLeave={() => setHov(null)}
                  style={{ cursor: "move" }}
                >
                  <title>{`${t.symbol} — ${TYPES[t.type].label}, on duty ${fmt(p.arrive)}–${fmt(p.depart)}${t.unsourced ? " (UNSOURCED — placeholder hours)" : ""}${hasBand ? `. Works ${ST(rg.w ?? t.waypoints[0].st).name} ↔ ${ST(rg.e ?? t.waypoints[0].st).name}` : ""}. ${t.note}`}</title>
                  {/* working range: a faint band over the miles the job ranges
                      through (per G&W) — the solid bar marks only its base /
                      on-duty point. Drag the band's top or bottom edge to
                      stretch the coverage to another station. */}
                  {hasBand && (
                    <g>
                      <rect x={x0} y={Y(rg.lo)} width={bw} height={Y(rg.hi) - Y(rg.lo)} fill={color} opacity={hot ? 0.14 : 0.07} />
                      <line x1={x0} y1={Y(rg.lo)} x2={x0 + bw} y2={Y(rg.lo)} stroke={color} strokeWidth={0.8} strokeDasharray="3 3" opacity={hot ? 0.7 : 0.35} />
                      <line x1={x0} y1={Y(rg.hi)} x2={x0 + bw} y2={Y(rg.hi)} stroke={color} strokeWidth={0.8} strokeDasharray="3 3" opacity={hot ? 0.7 : 0.35} />
                    </g>
                  )}
                  {/* unsourced jobs (Y115: no schedule from G&W) draw hollow
                      with a dashed outline — a placeholder to plan AROUND,
                      not a job to plan ON */}
                  <rect
                    x={x0}
                    y={cy - h / 2}
                    width={bw}
                    height={h}
                    fill={t.unsourced ? "#ffffff" : color}
                    opacity={t.unsourced ? (hot ? 0.95 : 0.75) : hot ? 0.8 : 0.42}
                    stroke={color}
                    strokeWidth={on ? 1.5 : t.unsourced ? 1.1 : 0.7}
                    strokeDasharray={t.unsourced ? "3 3" : t.type === "mow" ? "4 2" : undefined}
                    rx={1.5}
                  />
                  {/* drag handle at the off-duty end: resizes hours on duty */}
                  <rect
                    x={X(p.depart + off) - 4}
                    y={cy - h / 2 - 2}
                    width={8}
                    height={h + 4}
                    fill={color}
                    opacity={hot ? 0.9 : 0}
                    rx={1}
                    style={{ cursor: "ew-resize" }}
                    onPointerDown={(e) => down(e, t, "resize")}
                  >
                    <title>{`Drag to change ${t.symbol}'s hours on duty (off duty ${fmt(p.depart)})`}</title>
                  </rect>
                  <Edge y={yW} mode="edgeW" label={`Drag up to extend ${t.symbol}'s coverage west${rg.w ? ` (now to ${ST(rg.w).name})` : ""}`} />
                  <Edge y={yE} mode="edgeE" label={`Drag down to extend ${t.symbol}'s coverage east${rg.e ? ` (now to ${ST(rg.e).name})` : ""}`} />
                  <text
                    x={X(p.arrive + off) + 5}
                    y={labelY}
                    fontSize={10.5}
                    fontWeight={700}
                    fill={t.unsourced ? "#737373" : "#171717"}
                    fontStyle={t.unsourced ? "italic" : undefined}
                    fontFamily="ui-monospace, monospace"
                  >
                    {t.symbol}
                    {t.unsourced ? " ?" : ""}
                  </text>
                  {showTimes && (
                    <text x={X(p.depart + off) + 5} y={cy + 3} fontSize={9} fill="#737373" fontFamily="ui-monospace, monospace">
                      {fmt(p.depart)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}

      {/* tolerance ribbons — a train with `tol` draws a translucent band from
          nominal-minus-early to nominal-plus-late, growing from the origin to
          the destination. It replaces phantom stops: the train is somewhere
          in here, and nothing about the band asserts the main is clear.
          Drawn under every string, and never a pointer target, so a wide
          ribbon can't hijack a drag on the string beneath it. */}
      {layers.flatMap(({ day: ld, off, tailOnly }) =>
        trips
          .filter((t) => t.days.includes(ld) && TYPES[t.type].moves && hasTol(t))
          .map((t) => {
            const pts = computeTrip(t, ld, restrictions);
            const sp = stringPts(pts).map((p) => ({ ...p, t: p.t + off }));
            const band = tolBand(sp, t);
            if (!band) return null;
            if (tailOnly && band.late[band.late.length - 1].t <= 0) return null;
            const quads = tolQuads(band);
            const d = quads.map((q) => `M${q.map((p) => `${X(p.t)},${Y(p.mile)}`).join("L")}Z`).join("");
            const edge = (e) => e.map((p) => `${X(p.t)},${Y(p.mile)}`).join(" ");
            const hot = sel === t.id || hov === t.id;
            const c = t.color || TYPES[t.type].color;
            const last = band.late[band.late.length - 1];
            const first = band.early[band.early.length - 1];
            const tol = tolOf(t) || { early: 0, late: 0 };
            return (
              <g key={`rib-${t.id}@${off}`} pointerEvents="none">
                <path d={d} fill={c} fillRule="nonzero" opacity={hot ? 0.22 : 0.12} />
                <polyline points={edge(band.early)} fill="none" stroke={c} strokeWidth={0.8} strokeDasharray="2 3" opacity={hot ? 0.7 : 0.4} />
                <polyline points={edge(band.late)} fill="none" stroke={c} strokeWidth={0.8} strokeDasharray="2 3" opacity={hot ? 0.7 : 0.4} />
                {/* the number the ribbon exists to show: the latest arrival */}
                {(showTimes || hot) && last.t >= win[0] && last.t <= win[1] && (
                  <text
                    x={X(last.t) + 5}
                    y={Y(last.mile) + (last.mile < TOTAL_MI / 2 ? -6 : 12)}
                    fontSize={9}
                    fontWeight={700}
                    fill={c}
                    opacity={0.85}
                    fontFamily="ui-monospace, monospace"
                  >
                    {tol.early ? `${fmt(first.t)}–${fmt(last.t)}` : `≤ ${fmt(last.t)}`}
                  </text>
                )}
              </g>
            );
          })
      )}

      {/* road strings — dwell segments at a siding, yard, or charge track
          draw DASHED: the unit is in the clear there, not blocking the main
          (e.g. the Vidalia yard/engine charge track). Moving segments stay solid. */}
      {layers.flatMap(({ day: ld, off, tailOnly }) =>
        trips
          .filter((t) => t.days.includes(ld) && TYPES[t.type].moves)
          .map((t) => {
            const pts = computeTrip(t, ld, restrictions);
            const sp = stringPts(pts).map((p) => ({ ...p, t: p.t + off }));
            if (sp.length < 2) return null;
            if (tailOnly && sp[sp.length - 1].t <= 0) return null; // no overnight tail

          const poly = sp.map((p) => `${X(p.t)},${Y(p.mile)}`).join(" ");
          const on = sel === t.id;
          const hot = on || hov === t.id;
          const c = t.color || TYPES[t.type].color;
          const holdAt = (mile) => STATIONS.some((s) => s.hold && Math.abs(s.mile - mile) < 1e-6);
          const lbl = labelPlan[`${t.id}@${off}`];

          return (
            <g
              key={`${t.id}@${off}`}
              onPointerDown={(e) => down(e, t)}
              onPointerEnter={() => setHov(t.id)}
              onPointerLeave={() => setHov(null)}
              style={{ cursor: "grab" }}
            >
              <title>{`${tripName(t)} — ${TYPES[t.type].label}, ${ST(t.waypoints[0].st).name} ${fmt(sp[0].t)} → ${ST(t.waypoints[t.waypoints.length - 1].st).name} ${fmt(sp[sp.length - 1].t)}${tolOf(t) ? ` (tolerance −${tolOf(t).early} / +${tolOf(t).late} min by the destination: arrives ${fmt(sp[sp.length - 1].t - tolOf(t).early)}–${fmt(sp[sp.length - 1].t + tolOf(t).late)})` : ""}. ${t.note} — While hovering, drag a leg's ◂ ▸ handle to set how early / late it may be by the end of that leg.`}</title>
              {/* fat invisible stroke widens the grab target */}
              <polyline points={poly} fill="none" stroke="transparent" strokeWidth={16} />
              {sp.slice(0, -1).map((p, i) => {
                const q = sp[i + 1];
                // a stop at a hold station draws dashed (in the clear) UNLESS
                // the stop is flagged as standing on the main — then it draws
                // solid and a little heavier: the track is occupied
                const onMain = p.mile === q.mile && p.block;
                const dwellClear = p.mile === q.mile && holdAt(p.mile) && !p.block;
                return (
                  <line
                    key={i}
                    x1={X(p.t)}
                    y1={Y(p.mile)}
                    x2={X(q.t)}
                    y2={Y(q.mile)}
                    stroke={c}
                    strokeWidth={onMain ? (hot ? 4.2 : 3) : hot ? 3.2 : 1.9}
                    opacity={dwellClear ? (hot ? 0.85 : 0.62) : hot ? 1 : 0.82}
                    strokeDasharray={dwellClear ? "5 4" : undefined}
                    strokeLinecap="round"
                  >
                    {onMain && <title>{`${t.symbol} standing ON THE MAIN at ${ST(p.st).name} ${fmt(p.t)}–${fmt(q.t)} — track occupied, nothing gets by`}</title>}
                  </line>
                );
              })}
              {sp.map((p, i) => (
                <circle key={`c${i}`} cx={X(p.t)} cy={Y(p.mile)} r={hot ? 3.2 : 2.2} fill="#fff" stroke={c} strokeWidth={1.4} />
              ))}
              {(lbl || []).map((l, i) => (
                <text key={`l${i}`} x={l.x} y={l.y} fontSize={11} fontWeight={700} fill={c} fontFamily="ui-monospace, monospace">
                  {l.text}
                </text>
              ))}

              {/* tolerance handles — one per LEG (departure to the next stop or
                  the destination), shown while the string is hovered or
                  selected, floating just above the leg's midpoint with a stem
                  down to the line so they never sit on another string's
                  path. The pill reads the allowance at the leg's end; drag
                  ◂ to widen "may be early", ▸ to widen "may be late". */}
              {onTol && hot && (() => {
                const allow = tolAllow(t, sp) || sp.map(() => ({ early: 0, late: 0 }));
                return tolLegs(t, sp).map(({ s: si, e: ei }) => {
                  const tMid = (sp[si].t + sp[ei].t) / 2;
                  if (tMid < win[0] || tMid > win[1]) return null;
                  let mile = sp[ei].mile;
                  for (let i = si; i < ei; i++) {
                    if (sp[i].t <= tMid && tMid <= sp[i + 1].t) {
                      const f = sp[i + 1].t === sp[i].t ? 0 : (tMid - sp[i].t) / (sp[i + 1].t - sp[i].t);
                      mile = sp[i].mile + f * (sp[i + 1].mile - sp[i].mile);
                      break;
                    }
                  }
                  const cx = X(tMid);
                  const cy = Y(mile);
                  const up = mile > TOTAL_MI * 0.12; // near the top edge, hang the pill below the line
                  const py = up ? cy - 22 : cy + 22;
                  const a = allow[ei];
                  const label = `−${Math.round(a.early)} / +${Math.round(a.late)}`;
                  const W = 46 + label.length * 5.2;
                  const endName = ST(sp[ei].st).name;
                  const extra = { wpIdx: sp[ei].wp, tol0: { early: Math.round(a.early), late: Math.round(a.late) } };
                  return (
                    <g key={`tol${si}`} style={{ cursor: "ew-resize" }}>
                      <line x1={cx} y1={cy} x2={cx} y2={py} stroke={c} strokeWidth={0.8} opacity={0.6} />
                      <rect x={cx - W / 2} y={py - 8} width={W} height={16} rx={8} fill="#ffffff" stroke={c} strokeWidth={1} />
                      <g onPointerDown={(e) => down(e, t, "tolE", extra)}>
                        <title>{`Drag left: ${sp[ei].sym || t.symbol} may reach ${endName} up to this much EARLY (now −${Math.round(a.early)} min)`}</title>
                        <rect x={cx - W / 2} y={py - 8} width={16} height={16} fill="transparent" />
                        <path d={`M${cx - W / 2 + 12},${py - 4.5} L${cx - W / 2 + 5},${py} L${cx - W / 2 + 12},${py + 4.5} Z`} fill={c} />
                      </g>
                      <text x={cx} y={py + 3} textAnchor="middle" fontSize={8} fontWeight={700} fill={c} fontFamily="ui-monospace, monospace" pointerEvents="none">
                        {label}
                      </text>
                      <g onPointerDown={(e) => down(e, t, "tolL", extra)}>
                        <title>{`Drag right: ${sp[ei].sym || t.symbol} may reach ${endName} up to this much LATE (now +${Math.round(a.late)} min)`}</title>
                        <rect x={cx + W / 2 - 16} y={py - 8} width={16} height={16} fill="transparent" />
                        <path d={`M${cx + W / 2 - 12},${py - 4.5} L${cx + W / 2 - 5},${py} L${cx + W / 2 - 12},${py + 4.5} Z`} fill={c} />
                      </g>
                    </g>
                  );
                });
              })()}

              {/* a run that continues past the window's right edge gets an
                  annotation at the exit point: where it's headed and when it
                  gets there ("+1" = after midnight, next calendar day) */}
              {(() => {
                const endT = sp[sp.length - 1].t;
                if (endT <= win[1]) return null;
                let exitMile = null;
                for (let i = 0; i < sp.length - 1; i++) {
                  if (sp[i].t <= win[1] && sp[i + 1].t > win[1]) {
                    const f = (win[1] - sp[i].t) / (sp[i + 1].t - sp[i].t);
                    exitMile = sp[i].mile + f * (sp[i + 1].mile - sp[i].mile);
                    break;
                  }
                }
                if (exitMile == null) return null;
                return (
                  <text
                    x={MG.l + PW - 5}
                    y={Y(exitMile) - 7}
                    textAnchor="end"
                    fontSize={9.5}
                    fontWeight={700}
                    fill={c}
                    fontFamily="ui-monospace, monospace"
                  >
                    {`→ ${ST(t.waypoints[t.waypoints.length - 1].st).name} ${fmt(endT)}${endT >= 2880 ? " +2 days" : endT >= 1440 ? " next day" : ""}`}
                  </text>
                );
              })()}

              {/* per-section speed labels render in a shared layer below,
                  so labels from trains running close together can de-collide */}
            </g>
          );
          })
      )}

      {/* per-section speeds, EXCEPTIONS ONLY: the LIMIT strip is the single
          source for authorized speeds, so a string gets a label only where
          this train runs BELOW the zone's limit (a restriction, or a slow
          waypoint speed) — bold red, at the zone's midpoint on the string.
          A train running track speed draws no label; the strip already
          says it. De-collision kept for multiple slowed trains. */}
      {showSpeeds &&
        (() => {
          const labels = [];
          layers.forEach(({ day: ld, off }) =>
            trips
              .filter((t) => t.days.includes(ld) && TYPES[t.type].moves)
              .forEach((t) => {
                const pts = computeTrip(t, ld, restrictions);
                for (let i = 1; i < pts.length; i++) {
                  const prev = pts[i - 1];
                  const p = pts[i];
                  const dep = prev.depart ?? prev.arrive;
                  const span = p.mile - prev.mile;
                  if (!span) continue;
                  const base = t.waypoints[i].speed || 25;
                  const lo = Math.min(prev.mile, p.mile);
                  const hi = Math.max(prev.mile, p.mile);
                  for (const z of zonesFor(t)) {
                    const a = Math.max(lo, z.a);
                    const b = Math.min(hi, z.b);
                    if (b - a < 1) continue;
                    const v = effSpeed(Math.min(base, z.mph), a, b, dep, ld, restrictions);
                    if (v <= 0 || v >= z.mph) continue; // at track speed: strip covers it
                    const mMid = (a + b) / 2;
                    const tOnLine = dep + off + (p.arrive - dep) * ((mMid - prev.mile) / span);
                    if (tOnLine < win[0] || tOnLine > win[1]) continue;
                    labels.push({ x: X(tOnLine), y: Y(mMid), v: Math.round(v), slow: true });
                  }
                }
              })
          );
          labels.sort((la, lb) => la.x - lb.x);
          const placed = [];
          for (const l of labels) {
            let y = l.y;
            let dup = false;
            for (let guard = 0; guard < 6; guard++) {
              const clash = placed.find((o) => Math.abs(o.x - l.x) < 42 && Math.abs(o.y - y) < 11);
              if (!clash) break;
              if (clash.v === l.v && clash.slow === l.slow) {
                dup = true;
                break;
              }
              y += 11;
            }
            if (!dup) placed.push({ ...l, y });
          }
          return placed.map((l, i) => (
            <text
              key={i}
              x={l.x - 5}
              y={l.y}
              textAnchor="end"
              fontSize={8.5}
              fontWeight={l.slow ? 700 : 400}
              fill={l.slow ? "#b91c1c" : "#7c7c7c"}
              fontFamily="ui-monospace, monospace"
            >
              {l.v} mph
            </text>
          ));
        })()}

      {/* waypoint times, drawn as one layer so labels near the same station
          can dodge each other instead of stacking (e.g. two trains through
          Magazine 20 min apart). Close labels drop to a second level. */}
      {showTimes &&
        (() => {
          const labels = [];
          layers.forEach(({ day: ld, off }) =>
            trips
              .filter((t) => t.days.includes(ld) && TYPES[t.type].moves)
              .forEach((t) => {
                computeTrip(t, ld, restrictions).forEach((p) => {
                  labels.push({ t: (p.arrive ?? p.depart) + off, mile: p.mile });
                });
              })
          );
          labels.sort((a, b) => a.mile - b.mile || a.t - b.t);
          const placed = [];
          for (const l of labels) {
            const used = new Set();
            for (const o of placed)
              if (o.mile === l.mile && Math.abs(X(o.t) - X(l.t)) < 38) used.add(o.lvl);
            let lvl = 0;
            while (used.has(lvl)) lvl++;
            placed.push({ ...l, lvl });
          }
          return placed.map((l, i) => {
            const nearBottom = Y(l.mile) > MG.t + PH - 30;
            const y = nearBottom
              ? Y(l.mile) - 8 - l.lvl * 11
              : Math.max(Y(l.mile) + 12, MG.t + 26) + l.lvl * 11;
            return (
              <text key={i} x={X(l.t) + 6} y={y} fontSize={8.5} fill="#525252" fontFamily="ui-monospace, monospace">
                {fmt(l.t)}
              </text>
            );
          });
        })()}

      {/* authorized track speed strip — shown with Speeds so the 10/20/25
          zone inputs are visible alongside the per-leg averages they produce */}
      {showSpeeds && (
        <g>
          <text
            x={MG.l + PW + 4}
            y={MG.t - 6}
            fontSize={7}
            fill="#8a8a8a"
            fontFamily="ui-monospace, monospace"
            letterSpacing={0.5}
          >
            LIMIT
          </text>
          {/* Every zone gets its number in the same format — the short
              10 MPH pockets at the yards are exactly the ones a reader
              must not miss. Labels nudge downward when a zone is thinner
              than a line of text. */}
          {(() => {
            let lastY = -Infinity;
            return SPEED_LIMITS.map((z, i) => {
              const y1 = Y(z.a);
              const y2 = Y(z.b);
              const shade = z.mph >= 25 ? "#e0e0e0" : z.mph >= 20 ? "#b5b5b5" : "#7a7a7a";
              const ty = Math.max((y1 + y2) / 2 + 2.5, lastY + 8.5);
              lastY = ty;
              return (
                <g key={i}>
                  <rect x={MG.l + PW + 3} y={y1} width={6} height={y2 - y1} fill={shade} />
                  <text
                    x={MG.l + PW + 12}
                    y={ty}
                    fontSize={8}
                    fill="#525252"
                    fontFamily="ui-monospace, monospace"
                  >
                    {z.mph}
                  </text>
                </g>
              );
            });
          })()}
        </g>
      )}

      {/* hover crosshair — the time under the pointer, hidden while dragging
          so it never fights the retime gesture */}
      {cursor && !drag && (() => {
        const cx = X(cursor.t);
        const label = `${fmt(cursor.t)}${cursor.t >= 1440 ? " (+1)" : ""}`;
        const boxW = cursor.t >= 1440 ? 62 : 42;
        const boxX = Math.min(Math.max(cx - boxW / 2, MG.l + 1), MG.l + PW - boxW - 1);
        return (
          <g pointerEvents="none">
            <line x1={cx} y1={MG.t} x2={cx} y2={MG.t + PH} stroke="#525252" strokeWidth={0.8} strokeDasharray="3 3" opacity={0.65} />
            <rect x={boxX} y={MG.t + 2} width={boxW} height={16} rx={2} fill="#262626" opacity={0.9} />
            <text x={boxX + boxW / 2} y={MG.t + 13.5} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#ffffff" fontFamily="ui-monospace, monospace">
              {label}
            </text>
          </g>
        );
      })()}

      {/* possible meets — ribbons overlap, nominal strings don't cross.
          Hollow amber, drawn under the real meets. Advisory. */}
      {possible.map((m, i) => (
        <g key={`p${i}`} pointerEvents="none">
          <title>{`Possible meet ${m.a} × ${m.b} ~${fmt(m.t)} — within a tolerance band, not a nominal crossing`}</title>
          <path
            d={`M${X(m.t) - 5.5},${Y(m.mile)} L${X(m.t)},${Y(m.mile) - 5.5} L${X(m.t) + 5.5},${Y(m.mile)} L${X(m.t)},${Y(m.mile) + 5.5} Z`}
            fill="#fff"
            stroke="#b45309"
            strokeWidth={1.4}
            strokeDasharray="2 1.5"
          />
        </g>
      ))}

      {/* meets — advisory markers only */}
      {meets.map((m, i) => (
        <g key={i} pointerEvents="none">
          <circle cx={X(m.t)} cy={Y(m.mile)} r={6.5} fill="#fff" stroke={BRAND.colors.accent} strokeWidth={1.4} />
          <path
            d={`M${X(m.t) - 3},${Y(m.mile)} L${X(m.t)},${Y(m.mile) - 3} L${X(m.t) + 3},${Y(m.mile)} L${X(m.t)},${Y(m.mile) + 3} Z`}
            fill={BRAND.colors.accent}
          />
        </g>
      ))}

      <rect x={MG.l} y={MG.t} width={PW} height={PH} fill="none" stroke="#333333" strokeWidth={1} />
      <text x={MG.l - 11} y={MG.t - 32} textAnchor="end" fontSize={9} fill="#8a8a8a" fontFamily="ui-monospace, monospace" letterSpacing={1}>
        LOCATION
      </text>
      <text x={MG.l + PW} y={MG.t - 32} textAnchor="end" fontSize={9} fill="#8a8a8a" fontFamily="ui-monospace, monospace" letterSpacing={1}>
        {twoDay
          ? `${DAYS[day].toUpperCase()} ${fmtColon(win[0])} → ${DAYS[nextDay].toUpperCase()} ${fmtColon(win[1] - 1440)}`
          : `${DAYS[day].toUpperCase()} · ${fmtColon(win[0])}–${fmtColon(win[1])}`}
      </text>
    </svg>
  );
}
