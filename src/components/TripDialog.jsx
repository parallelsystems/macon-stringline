import React, { useState } from "react";
import { DAYS, STATIONS, TYPES, ST, wp } from "../data/network.js";
import { computeTrip, fmt, parseHM, jobRange } from "../lib/schedule.js";

/**
 * Add / Update Trip.
 *
 * Modeled on the RTP "Add Trip" dialog: the planner builds an ORDERED list of
 * waypoints, marks which are stops, sets dwell and segment speeds. Arrive and
 * depart are COMPUTED and shown live as the form changes — never typed in.
 *
 * The waypoint list is ordered, not a checkbox-per-station set, on purpose:
 * a station may appear more than once, so a route can go out and back
 * (Agile → Plastic Express → Agile), run one way, or turn mid-line. The
 * earlier checkbox table silently sorted every route into one direction,
 * which made round trips impossible to build and destroyed them on edit.
 *
 * Location jobs (yard / local / MOW) get a base point, an optional working
 * territory (the far end of the range the job works), and hours on duty.
 */
export default function TripDialog({ initial, day, restrictions, onSave, onDelete, onClose }) {
  const blank = { symbol: "", note: "", type: "road", days: [day], time: 480, work: 480, waypoints: [] };
  const [d, setD] = useState(initial ? structuredClone(initial) : blank);
  const [timeText, setTimeText] = useState(fmt(initial ? initial.time : 480));

  const isRoad = !!TYPES[d.type].moves;

  /* ---- ordered waypoint list (road / parallel) ---- */
  const setWpAt = (i, patch) =>
    setD((p) => ({ ...p, waypoints: p.waypoints.map((w, k) => (k === i ? { ...w, ...patch } : w)) }));

  const removeAt = (i) => setD((p) => ({ ...p, waypoints: p.waypoints.filter((_, k) => k !== i) }));

  const moveAt = (i, dir) =>
    setD((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.waypoints.length) return p;
      const next = [...p.waypoints];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...p, waypoints: next };
    });

  /* Append a waypoint. Default: the next station along the route's current
     heading (so building Macon → Savannah is repeated clicks), or Macon when
     the list is empty. */
  const addWp = () =>
    setD((p) => {
      const n = p.waypoints.length;
      let st = STATIONS[0].id;
      if (n >= 1) {
        const lastIdx = STATIONS.findIndex((s) => s.id === p.waypoints[n - 1].st);
        let dir = 1;
        if (n >= 2) {
          const prevIdx = STATIONS.findIndex((s) => s.id === p.waypoints[n - 2].st);
          dir = lastIdx >= prevIdx ? 1 : -1;
        }
        const nextIdx = Math.min(Math.max(lastIdx + dir, 0), STATIONS.length - 1);
        st = STATIONS[nextIdx === lastIdx ? lastIdx - dir : nextIdx].id;
      }
      return { ...p, waypoints: [...p.waypoints, wp(st)] };
    });

  /* Round trip: mirror the path back to the origin. The turnaround point
     becomes a stop (dwell 0 until the planner sets it). */
  const addReturn = () =>
    setD((p) => {
      if (p.waypoints.length < 2) return p;
      const n = p.waypoints.length;
      const back = p.waypoints
        .slice(0, n - 1)
        .reverse()
        .map((w) => wp(w.st, w.speed, false, 0));
      const turn = { ...p.waypoints[n - 1], stop: true, dwell: p.waypoints[n - 1].dwell || 0 };
      return { ...p, waypoints: [...p.waypoints.slice(0, n - 1), turn, ...back] };
    });

  const flip = () => setD((p) => ({ ...p, waypoints: [...p.waypoints].reverse() }));

  /* ---- location jobs ---- */
  const setBase = (id) => setD((p) => ({ ...p, waypoints: [wp(id)] }));
  // Coverage range: { w, e } far-station ids (null = doesn't extend that
  // way). Always write the key so App's merge knows the planner set it; a
  // partial save from the timetable never carries it and leaves it alone.
  const rangeOf = (p) => (p.waypoints[0] ? jobRange(p) : { w: null, e: null });
  const setRangeSide = (side, id) => setD((p) => ({ ...p, range: { ...rangeOf(p), [side]: id || null }, territory: null }));

  const toggleDay = (i) =>
    setD((p) => ({
      ...p,
      days: p.days.includes(i) ? p.days.filter((x) => x !== i) : [...p.days, i].sort((a, b) => a - b),
    }));

  let preview = [];
  try {
    preview = d.waypoints.length ? computeTrip(d, day, restrictions) : [];
  } catch {
    preview = [];
  }

  const minWaypoints = isRoad ? 2 : 1;
  const dupLeg = isRoad && d.waypoints.some((w, i) => i > 0 && w.st === d.waypoints[i - 1].st);
  const valid = d.symbol.trim() && d.waypoints.length >= minWaypoints && d.days.length > 0 && !dupLeg;

  const isRound =
    isRoad && d.waypoints.length >= 3 && d.waypoints[0].st === d.waypoints[d.waypoints.length - 1].st;

  const LABEL = "mb-1 block font-mono text-[10px] tracking-wider text-neutral-500 uppercase";
  const INPUT = "w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-700 focus:outline-none";
  const SMALLBTN =
    "rounded border border-neutral-300 bg-white px-1.5 py-0.5 font-mono text-[10px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-30";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/50 p-4">
      <div className="mt-6 w-full max-w-3xl rounded border border-neutral-400 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-300 bg-brand px-4 py-2">
          <span className="font-mono text-sm font-bold tracking-wider text-white uppercase">
            {initial ? "Update trip" : "Add trip"}
          </span>
          <button onClick={onClose} className="px-2 font-mono text-lg leading-none text-neutral-300 hover:text-white" aria-label="Close">
            ×
          </button>
        </div>

        {/* header fields */}
        <div className="grid gap-3 border-b border-neutral-200 p-4 sm:grid-cols-4">
          <label className="block">
            <span className={LABEL}>Train ID</span>
            <input
              value={d.symbol}
              onChange={(e) => setD({ ...d, symbol: e.target.value.toUpperCase() })}
              className={`${INPUT} font-mono`}
              placeholder="L783"
            />
          </label>

          <label className="block">
            <span className={LABEL}>Type</span>
            <select
              value={d.type}
              onChange={(e) => {
                const type = e.target.value;
                const toRoad = !!TYPES[type].moves;
                setD((p) => {
                  const n = { ...p, type };
                  if (!toRoad) {
                    n.waypoints = p.waypoints.slice(0, 1);
                  } else {
                    n.range = { w: null, e: null };
                    n.territory = null;
                  }
                  return n;
                });
              }}
              className={INPUT}
            >
              {Object.keys(TYPES).map((k) => (
                <option key={k} value={k}>
                  {TYPES[k].label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={LABEL}>{isRoad ? "Depart (HH:MM)" : "On duty (HH:MM)"}</span>
            <input
              value={timeText}
              onChange={(e) => {
                setTimeText(e.target.value);
                const v = parseHM(e.target.value);
                if (v != null) setD((p) => ({ ...p, time: v }));
              }}
              className={`${INPUT} font-mono`}
            />
          </label>

          {isRoad ? (
            <div className="flex items-end gap-1.5">
              <button
                onClick={flip}
                disabled={d.waypoints.length < 2}
                className="flex-1 rounded border border-neutral-400 px-2 py-1 font-mono text-xs tracking-wider text-neutral-700 uppercase hover:bg-neutral-50 disabled:opacity-40"
                title="Run the same route the other way"
              >
                Reverse
              </button>
            </div>
          ) : (
            <label className="block">
              <span className={LABEL}>Hours on duty</span>
              <input
                type="number"
                min={0.5}
                max={16}
                step={0.5}
                value={Math.round(((d.work || 480) / 60) * 2) / 2}
                onChange={(e) => setD({ ...d, work: Math.max(0.5, Number(e.target.value) || 0.5) * 60 })}
                className={`${INPUT} font-mono`}
              />
            </label>
          )}

          <label className="block sm:col-span-4">
            <span className={LABEL}>Assignment note</span>
            <input
              value={d.note}
              onChange={(e) => setD({ ...d, note: e.target.value })}
              className={INPUT}
              placeholder="Road train from Collins to Pooler"
            />
          </label>

          <div className="sm:col-span-4">
            <span className={LABEL}>Days operated</span>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((dd, i) => (
                <button
                  key={dd}
                  onClick={() => toggleDay(i)}
                  className={`w-11 rounded border px-1 py-1 font-mono text-xs uppercase ${
                    d.days.includes(i)
                      ? "border-brand bg-brand text-white"
                      : "border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50"
                  }`}
                >
                  {dd}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isRoad ? (
          /* ---------------- ordered waypoint list ---------------- */
          <div className="p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className={LABEL}>
                Route — waypoints in running order{isRound ? " · round trip" : d.waypoints.length >= 2 ? " · one way" : ""}
              </span>
              <span className="font-mono text-[10px] text-neutral-400">times computed</span>
            </div>

            <div className="max-h-80 overflow-y-auto rounded border border-neutral-200">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-neutral-100">
                  <tr>
                    {["#", "Waypoint", "Stop", "Dwell", "Tol −/+", "Arrive", "Depart", "MPH", ""].map((h, i) => (
                      <th
                        key={i}
                        className={`border-b border-neutral-300 px-2 py-1 font-mono text-[10px] text-neutral-500 uppercase ${
                          i === 1 ? "text-left" : i === 5 || i === 6 ? "text-right" : "text-center"
                        }`}
                        title={i === 4 ? "Tolerance by this point, minutes: how early / how late the train may be when it gets here. Draws the string as a widening ribbon; later legs inherit it unless they have their own." : undefined}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.waypoints.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-neutral-400">
                        No waypoints yet. Add the origin, then each point the run passes or works, in order.
                      </td>
                    </tr>
                  )}
                  {d.waypoints.map((w, i) => {
                    const p = preview[i];
                    const isFirst = i === 0;
                    const isLast = i === d.waypoints.length - 1 && d.waypoints.length > 1;
                    const dup = i > 0 && w.st === d.waypoints[i - 1].st;
                    return (
                      <tr key={i} className={dup ? "bg-red-50" : "bg-white"}>
                        <td className="border-b border-neutral-100 px-2 py-1 text-center font-mono text-neutral-400">{i + 1}</td>
                        <td className="border-b border-neutral-100 px-2 py-1">
                          <div className="flex items-center gap-2">
                            <select
                              value={w.st}
                              onChange={(e) => setWpAt(i, { st: e.target.value })}
                              className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs font-semibold text-neutral-900"
                            >
                              {STATIONS.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} · {s.mp}
                                </option>
                              ))}
                            </select>
                            {isFirst && <span className="rounded bg-brand px-1 font-mono text-[9px] text-white uppercase">start</span>}
                            {isLast && <span className="rounded bg-neutral-500 px-1 font-mono text-[9px] text-white uppercase">end</span>}
                            {dup && <span className="font-mono text-[9px] text-red-700 uppercase">same as previous</span>}
                          </div>
                          {w.stop && !isFirst && !isLast && (
                            <label
                              className="mt-1 flex items-center gap-1 font-mono text-[9px] text-neutral-500 uppercase"
                              title="Crew change: the same train continues from here under a new symbol (Y120 arrives, L782R leaves). Labels, meets, and the timetable name each leg by its own crew."
                            >
                              continues as
                              <input
                                value={w.as || ""}
                                onChange={(e) => setWpAt(i, { as: e.target.value.toUpperCase().trim() || undefined })}
                                placeholder="same"
                                className="w-16 rounded border border-neutral-300 px-1 py-0.5 font-mono text-[10px] normal-case text-neutral-800"
                              />
                            </label>
                          )}
                        </td>

                        <td className="border-b border-neutral-100 px-2 py-1 text-center">
                          {!isFirst && !isLast && (
                            <input
                              type="checkbox"
                              checked={!!w.stop}
                              onChange={(e) => setWpAt(i, { stop: e.target.checked })}
                              className="h-3.5 w-3.5"
                            />
                          )}
                        </td>

                        <td className="border-b border-neutral-100 px-2 py-1 text-center">
                          {w.stop && !isFirst && !isLast && (
                            <>
                              <input
                                type="number"
                                min={0}
                                value={w.dwell}
                                onChange={(e) => setWpAt(i, { dwell: Math.max(0, Number(e.target.value) || 0) })}
                                className="w-14 rounded border border-neutral-300 px-1 py-0.5 text-right font-mono text-xs"
                              />
                              {ST(w.st).hold && (
                                <label
                                  className="mt-0.5 flex items-center justify-center gap-1 font-mono text-[9px] text-neutral-500 uppercase"
                                  title="Standing on the MAIN during this stop (not in the siding/yard). Draws solid; anything crossing it is a meet, not a pass. Off = in the clear, dashed."
                                >
                                  <input type="checkbox" checked={!!w.block} onChange={(e) => setWpAt(i, { block: e.target.checked })} className="h-3 w-3" />
                                  main
                                </label>
                              )}
                            </>
                          )}
                        </td>

                        <td className="border-b border-neutral-100 px-1 py-1 text-center whitespace-nowrap">
                          {((w.stop && !isFirst) || isLast) && (
                            <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-neutral-500">
                              −
                              <input
                                type="number"
                                min={0}
                                step={5}
                                value={w.tol?.early ?? 0}
                                onChange={(e) => setWpAt(i, { tol: { early: Math.max(0, Number(e.target.value) || 0), late: w.tol?.late || 0 } })}
                                className="w-11 rounded border border-neutral-300 px-1 py-0.5 text-right font-mono text-xs text-neutral-800"
                              />
                              /+
                              <input
                                type="number"
                                min={0}
                                step={5}
                                value={w.tol?.late ?? 0}
                                onChange={(e) => setWpAt(i, { tol: { early: w.tol?.early || 0, late: Math.max(0, Number(e.target.value) || 0) } })}
                                className="w-11 rounded border border-neutral-300 px-1 py-0.5 text-right font-mono text-xs text-neutral-800"
                              />
                            </span>
                          )}
                        </td>

                        <td className="border-b border-neutral-100 px-2 py-1 text-right font-mono text-neutral-600">
                          {p && p.arrive != null ? fmt(p.arrive) : ""}
                        </td>
                        <td className="border-b border-neutral-100 px-2 py-1 text-right font-mono text-neutral-600">
                          {p && p.depart != null ? fmt(p.depart) : ""}
                        </td>

                        <td className="border-b border-neutral-100 px-2 py-1 text-center">
                          {!isLast && (
                            <input
                              type="number"
                              min={5}
                              max={60}
                              value={w.speed}
                              onChange={(e) => setWpAt(i, { speed: Math.max(5, Number(e.target.value) || 25) })}
                              className="w-14 rounded border border-neutral-300 px-1 py-0.5 text-right font-mono text-xs"
                              title="Speed leaving this waypoint — the track limit caps it"
                            />
                          )}
                        </td>

                        <td className="border-b border-neutral-100 px-1 py-1 text-center whitespace-nowrap">
                          <button onClick={() => moveAt(i, -1)} disabled={i === 0} className={SMALLBTN} title="Move up" aria-label="Move up">
                            ↑
                          </button>{" "}
                          <button
                            onClick={() => moveAt(i, 1)}
                            disabled={i === d.waypoints.length - 1}
                            className={SMALLBTN}
                            title="Move down"
                            aria-label="Move down"
                          >
                            ↓
                          </button>{" "}
                          <button
                            onClick={() => removeAt(i)}
                            className={`${SMALLBTN} text-red-700 hover:bg-red-50`}
                            title="Remove waypoint"
                            aria-label="Remove waypoint"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={addWp}
                className="rounded border border-neutral-400 bg-white px-2.5 py-1 font-mono text-[11px] tracking-wider text-neutral-700 uppercase hover:bg-neutral-100"
              >
                + Waypoint
              </button>
              <button
                onClick={addReturn}
                disabled={d.waypoints.length < 2 || isRound}
                className="rounded border border-neutral-400 bg-white px-2.5 py-1 font-mono text-[11px] tracking-wider text-neutral-700 uppercase hover:bg-neutral-100 disabled:opacity-40"
                title="Mirror the route back to the origin — makes this a round trip"
              >
                + Return leg
              </button>
              <span className="text-[10px] text-neutral-400">
                Stations may repeat, so a route can run one way, out and back, or turn mid-line. A stop's dwell
                draws as a flat segment; dashed at a siding or yard, solid when the stop is flagged <span className="font-mono">main</span>
                (the train stands on the main track, so it blocks). A train that ties down and leaves with a new crew is
                one trip with a long stop, and <span className="font-mono">continues as</span> names the new crew's symbol
                — L781 arrives at Collins, L781R leaves. <span className="font-mono">Tol −/+</span> on a stop or the destination
                is how early / late the train may be by that point; the string draws as a ribbon widening to it, and a crew
                change resets it.
              </span>
            </div>
          </div>
        ) : (
          /* ---------------- location job ---------------- */
          <div className="grid gap-3 p-4 sm:grid-cols-4">
            <label className="block">
              <span className={LABEL}>Base / on-duty point</span>
              <select value={d.waypoints[0]?.st || ""} onChange={(e) => setBase(e.target.value)} className={INPUT}>
                <option value="" disabled>
                  Pick a station…
                </option>
                {STATIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.mp}
                  </option>
                ))}
              </select>
            </label>
            {(() => {
              const baseSt = d.waypoints[0]?.st ? ST(d.waypoints[0].st) : null;
              const rg = baseSt ? rangeOf(d) : { w: null, e: null };
              const west = baseSt ? STATIONS.filter((s) => s.mile < baseSt.mile) : [];
              const east = baseSt ? STATIONS.filter((s) => s.mile > baseSt.mile) : [];
              return (
                <>
                  <label className="block">
                    <span className={LABEL}>Coverage — west end</span>
                    <select value={rg.w || ""} onChange={(e) => setRangeSide("w", e.target.value)} className={INPUT} disabled={!baseSt}>
                      <option value="">— base only —</option>
                      {west.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · {s.mp}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={LABEL}>Coverage — east end</span>
                    <select value={rg.e || ""} onChange={(e) => setRangeSide("e", e.target.value)} className={INPUT} disabled={!baseSt}>
                      <option value="">— base only —</option>
                      {east.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · {s.mp}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              );
            })()}
            <div className="block">
              <span className={LABEL}>On duty</span>
              <div className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1 font-mono text-sm text-neutral-700">
                {preview[0] ? `${fmt(preview[0].arrive)} – ${fmt(preview[0].depart)}` : "—"}
              </div>
            </div>
            <p className="text-[11px] text-neutral-500 sm:col-span-4">
              The solid bar marks the base point for the hours on duty. Coverage draws a faint band from the west end to
              the east end of the range the job works — Y104 from the Pooler siding to Savannah, Y103 from Dudley
              through Dublin — so a road movement or a charge stop can be planned around where the job actually ranges.
              On the stringline, drag the band's top or bottom edge to stretch it.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-neutral-200 bg-neutral-50 px-4 py-3">
          <div>
            {initial && (
              <button
                onClick={() => {
                  onDelete(initial.id);
                  onClose();
                }}
                className="rounded border border-red-300 bg-white px-3 py-1.5 font-mono text-xs tracking-wider text-red-700 uppercase hover:bg-red-50"
              >
                Annul trip
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!valid && d.symbol.trim() && (
              <span className="text-[10px] text-neutral-400">
                {dupLeg
                  ? "Two consecutive waypoints are the same station."
                  : d.waypoints.length < minWaypoints
                    ? isRoad
                      ? "Add at least two waypoints."
                      : "Pick a base station."
                    : "Pick at least one day."}
              </span>
            )}
            <button
              onClick={onClose}
              className="rounded border border-neutral-400 bg-white px-3 py-1.5 font-mono text-xs tracking-wider text-neutral-700 uppercase hover:bg-neutral-100"
            >
              Close
            </button>
            <button
              onClick={() => {
                onSave(d);
                onClose();
              }}
              disabled={!valid}
              className="rounded bg-brand px-4 py-1.5 font-mono text-xs tracking-wider text-white uppercase hover:bg-brand-soft disabled:opacity-40"
            >
              {initial ? "Update" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
