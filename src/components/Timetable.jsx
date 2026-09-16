import React from "react";
import { STATIONS, ST, TYPES, DAYS } from "../data/network.js";
import { jobRange, computeTrip, fmt, parseHM, tolOf, withTolAt, tripName } from "../lib/schedule.js";

/**
 * Traditional employee-timetable layout: stations as rows, trains as columns,
 * arrive/depart pairs in the cells. Reads down in the direction of travel, so
 * westbound reverses the station order.
 *
 * Reads from the same computeTrip() as the stringline, so the two views cannot
 * disagree with each other.
 *
 * EDITING. Times are computed, never stored — so a cell edit maps to the input
 * that produces the time, and everything (including the stringline) recomputes:
 *   - any arrival, or the origin departure: retimes the WHOLE trip by the
 *     difference (identical to dragging the string)
 *   - the departure at an intermediate stop: adjusts that stop's DWELL
 *   - a yard/local job's off-duty time: adjusts its hours on duty
 *   - a road train's tolerance (−early / +late, minutes): sets `tol`, which
 *     draws the string as a ribbon on the stringline and is what the
 *     "Earliest / Latest" export columns report
 */

const MONO = { fontFamily: "ui-monospace, monospace" };
const SANS = { fontFamily: "ui-sans-serif, system-ui" };

/* Smallest signed minute delta from a computed time to an entered HHMM,
   wrapping so an edit near midnight moves hours, not a whole day. */
const wrapDelta = (target, cur) => {
  const curMod = ((Math.round(cur) % 1440) + 1440) % 1440;
  return ((((target - curMod + 720) % 1440) + 1440) % 1440) - 720;
};

function TimeCell({ value, onCommit }) {
  if (value == null) return <span className="text-neutral-300">·</span>;
  const shown = fmt(value);
  return (
    <input
      key={shown}
      defaultValue={shown}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = shown;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const v = parseHM(e.target.value);
        if (v == null || fmt(v) === shown) {
          e.target.value = shown;
          return;
        }
        onCommit(v);
      }}
      className="w-12 rounded border border-transparent bg-transparent px-1 py-0 text-right font-mono text-xs hover:border-neutral-300 focus:border-neutral-500 focus:bg-white focus:outline-none"
      style={MONO}
    />
  );
}

/* Two small minute fields, "−early" and "+late": the allowance by the
   DESTINATION (the last anchor). Zero on both sides means no tolerance: the
   string draws sharp and no ribbon appears. Per-leg values are set on the
   stringline by hovering the string and dragging a leg's handle. */
function TolCell({ trip, onSave }) {
  const tol = tolOf(trip) || { early: 0, late: 0 };
  const commit = (side) => (e) => {
    const v = Math.max(0, Math.round(Number(e.target.value) || 0));
    if (v === tol[side]) return;
    const next = withTolAt(trip, trip.waypoints.length - 1, { ...tol, [side]: v });
    onSave({ id: trip.id, waypoints: next.waypoints, tol: null });
  };
  const cls =
    "w-11 rounded border border-transparent bg-transparent px-1 py-0 text-right font-mono text-xs hover:border-neutral-300 focus:border-neutral-500 focus:bg-white focus:outline-none";
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap" title="Schedule tolerance in minutes at the destination: how early / how late this train may realistically run. Draws the string as a ribbon.">
      <span className="text-neutral-400">−</span>
      <input key={`e${tol.early}`} type="number" min={0} step={5} defaultValue={tol.early} onBlur={commit("early")} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className={cls} style={MONO} />
      <span className="text-neutral-400">/ +</span>
      <input key={`l${tol.late}`} type="number" min={0} step={5} defaultValue={tol.late} onBlur={commit("late")} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className={cls} style={MONO} />
    </span>
  );
}

function Block({ title, list, reverse, onShift, onSave }) {
  if (!list.length) return null;
  const rows = reverse ? [...STATIONS].reverse() : STATIONS;

  const commit = (t, p, field, wpIdx) => (v) => {
    const delta = wrapDelta(v, field === "arrive" ? p.arrive : p.depart);
    if (field === "depart") {
      const w = t.waypoints[wpIdx];
      if (wpIdx > 0 && w?.stop) {
        // editing a stop's departure sets its dwell, not the trip anchor
        const dwell = Math.max(0, (w.dwell || 0) + delta);
        onSave({ id: t.id, waypoints: t.waypoints.map((x, i) => (i === wpIdx ? { ...x, dwell } : x)) });
        return;
      }
    }
    onShift(t.id, delta);
  };

  return (
    <div className="mb-6">
      <div className="mb-1.5 border-b border-brand pb-1 font-mono text-xs font-bold tracking-widest text-brand uppercase">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs" style={MONO}>
          <thead>
            <tr>
              <th className="border-b border-neutral-300 px-2 py-1 text-left font-semibold text-neutral-500">Station</th>
              {list.map(({ t, leg }) => (
                <th key={t.id} colSpan={2} className="border-b border-l border-neutral-300 px-2 py-1 text-center font-bold text-neutral-900">
                  {leg[0].p.symArr ?? leg[0].p.sym ?? t.symbol}
                  {/* crew change inside this leg: the same train continues under a new symbol */}
                  {leg
                    .filter((e, i) => i > 0 && e.p.sym !== e.p.symArr)
                    .map((e) => (
                      <div key={e.wp} className="text-[9px] font-normal text-neutral-500" title="Same train, new crew — continues under this symbol">
                        → {e.p.sym} from {ST(e.p.st).name}
                      </div>
                    ))}
                  {/* every train has a tolerance field: −early / +late minutes at
                      the destination; zero both sides is a sharp line */}
                  <div className="mt-0.5 font-normal" title="Tolerance −early / +late, minutes at the destination — how far off the computed times this train may run. Draws the string as a widening ribbon.">
                    <TolCell trip={t} onSave={onSave} />
                  </div>
                </th>
              ))}
            </tr>
            <tr>
              <th className="border-b border-neutral-400 px-2 py-0.5 text-left text-[10px] font-normal tracking-wider text-neutral-400 uppercase">
                Read down · <span className="normal-case">tolerance −/+ min under each train</span>
              </th>
              {list.map(({ t }) => (
                <React.Fragment key={t.id}>
                  <th className="border-b border-l border-neutral-400 px-1.5 py-0.5 text-[10px] font-normal text-neutral-400 uppercase">Arr</th>
                  <th className="border-b border-neutral-400 px-1.5 py-0.5 text-[10px] font-normal text-neutral-400 uppercase">Dep</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-neutral-50">
                <td className="border-b border-neutral-200 px-2 py-1 font-semibold whitespace-nowrap text-neutral-800" style={SANS}>
                  {s.name}
                </td>
                {list.map(({ t, leg }) => {
                  const x = leg.find((e) => e.p.st === s.id);
                  return (
                    <React.Fragment key={t.id}>
                      <td className="border-b border-l border-neutral-200 px-1.5 py-1 text-right text-neutral-700">
                        {x ? <TimeCell value={x.p.arrive} onCommit={commit(t, x.p, "arrive", x.wp)} /> : <span className="text-neutral-300">·</span>}
                      </td>
                      <td className="border-b border-neutral-200 px-1.5 py-1 text-right text-neutral-700">
                        {x ? <TimeCell value={x.p.depart} onCommit={commit(t, x.p, "depart", x.wp)} /> : <span className="text-neutral-300">·</span>}
                      </td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* One-line service summary per train — the fleet's cycle legs (depart
   Macon, Vidalia charge, Plastic Express, back at Macon) alongside every
   G&W train on duty, so the "who runs today" conversation needs one table.
   Read-only; computed from the same computeTrip as everything else. */
const sup = (m) => (m >= 1440 ? <sup className="text-[8px] text-neutral-400">+1</sup> : null);
const TH = "border-b border-neutral-400 px-2 py-1 text-left font-mono text-[10px] font-normal tracking-wider text-neutral-400 uppercase";
const TD = "border-b border-neutral-200 px-2 py-1 whitespace-nowrap";

function Summary({ trips, restrictions, day, onSave }) {
  const road = trips.filter((t) => t.days.includes(day) && TYPES[t.type].moves);
  const ps = road.filter((t) => t.type === "parallel");
  const gw = road.filter((t) => t.type !== "parallel");
  if (!road.length) return null;

  const psRows = ps.map((t) => {
    const pts = computeTrip(t, day, restrictions);
    const stopsAt = (id) => pts.filter((p) => p.st === id && p.arrive != null && p.depart != null && p.depart - p.arrive > 1);
    const vids = stopsAt("vidalia"); // [0] = EB charge; [1] = WB top-up (split-return pattern)
    return { t, dep: pts[0].depart, vid: vids[0], vidWB: vids[1], pla: stopsAt("plastic")[0], back: pts[pts.length - 1].arrive };
  });

  const gwRows = gw.map((t) => {
    const pts = computeTrip(t, day, restrictions);
    const keyPts = pts.filter((p, i) => i === 0 || i === pts.length - 1 || (p.depart != null && p.depart - p.arrive > 1));
    return { t, legs: keyPts, tol: tolOf(t) };
  });

  const span = (p) =>
    p == null ? "·" : (
      <>
        {fmt(p.arrive)}{sup(p.arrive)} → {fmt(p.depart)}{sup(p.depart)}
      </>
    );

  return (
    <div className="mb-6">
      <div className="mb-1.5 border-b border-brand pb-1 font-mono text-xs font-bold tracking-widest text-brand uppercase">
        Service summary — {DAYS[day]}
      </div>
      {psRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs" style={MONO}>
            <thead>
              <tr>
                {["Unit", "Depart Macon", "Charge at Vidalia", "Charge at Plastic Express", "Back at Macon", "Tolerance −/+ min"].map((h) => (
                  <th key={h} className={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {psRows.map((r) => (
                <tr key={r.t.id} className="hover:bg-neutral-50">
                  <td className={`${TD} font-bold`} style={{ color: TYPES.parallel.color }}>{r.t.symbol}</td>
                  <td className={TD}>{fmt(r.dep)}</td>
                  <td className={TD}>
                    {span(r.vid)}
                    {r.vidWB && (
                      <div className="text-[10px] text-neutral-400">
                        + WB top-up {fmt(r.vidWB.arrive)}{sup(r.vidWB.arrive)} → {fmt(r.vidWB.depart)}{sup(r.vidWB.depart)}
                      </div>
                    )}
                  </td>
                  <td className={TD}>{span(r.pla)}</td>
                  <td className={TD}>{fmt(r.back)}{sup(r.back)}</td>
                  <td className={TD}><TolCell trip={r.t} onSave={onSave} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gwRows.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="border-collapse text-xs" style={MONO}>
            <thead>
              <tr>
                <th className={TH}>G&amp;W train</th>
                <th className={TH}>Schedule</th>
                <th className={TH}>Tolerance −/+ min</th>
                <th className={TH} style={SANS}>Assignment</th>
              </tr>
            </thead>
            <tbody>
              {gwRows.map((r) => (
                <tr key={r.t.id} className="hover:bg-neutral-50">
                  <td className={`${TD} font-bold`} style={{ color: r.t.color || TYPES[r.t.type].color }}>{tripName(r.t)}</td>
                  <td className={TD}>
                    {r.legs.map((p, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <span className="text-neutral-400"> → </span>}
                        <span style={SANS} className="text-neutral-600">{ST(p.st).name}</span>{" "}
                        {p.arrive == null
                          ? <>{fmt(p.depart)}{sup(p.depart)}</>
                          : p.depart == null
                            ? <>{fmt(p.arrive)}{sup(p.arrive)}</>
                            : <>{fmt(p.arrive)}{sup(p.arrive)}–{fmt(p.depart)}{sup(p.depart)}</>}
                        {/* destination with a tolerance: the window the ribbon draws */}
                        {i === r.legs.length - 1 && r.tol && (
                          <span className="text-amber-700" title="Arrival window at the tolerance edges">
                            {" "}({fmt(p.arrive - r.tol.early)}–{fmt(p.arrive + r.tol.late)})
                          </span>
                        )}
                      </React.Fragment>
                    ))}
                  </td>
                  <td className={TD}><TolCell trip={r.t} onSave={onSave} /></td>
                  <td className={`${TD} text-neutral-500`} style={SANS}>{r.t.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Timetable({ trips, restrictions, day, onShift, onSave }) {
  const onDuty = trips.filter((t) => t.days.includes(day));
  const road = onDuty.filter((t) => TYPES[t.type].moves);
  const other = onDuty.filter((t) => !TYPES[t.type].moves);

  // Split every road trip at its farthest point so out-and-back turns appear
  // in BOTH directions of the table: the eastbound block gets the outbound
  // leg, the westbound block gets the return. One-way trips land in one
  // block, as before. Each leg keeps its waypoint indexes so cell edits map
  // to the correct stop even when a station appears twice in the trip.
  const east = [];
  const west = [];
  for (const t of road) {
    const pts = computeTrip(t, day, restrictions);
    let apex = 0;
    pts.forEach((p, i) => {
      if (p.mile > pts[apex].mile) apex = i;
    });
    const out = pts.slice(0, apex + 1).map((p, i) => ({ p, wp: i }));
    const back = pts.slice(apex).map((p, i) => ({ p, wp: apex + i }));
    if (out.length > 1) east.push({ t, leg: out });
    if (back.length > 1) west.push({ t, leg: back });
  }
  east.sort((a, b) => a.leg[0].p.depart - b.leg[0].p.depart);
  west.sort((a, b) => (a.leg[0].p.depart ?? a.leg[0].p.arrive) - (b.leg[0].p.depart ?? b.leg[0].p.arrive));

  if (!onDuty.length) {
    return <div className="px-2 py-16 text-center text-sm text-neutral-400">No jobs on duty. Add a trip to start the plan.</div>;
  }

  return (
    <div className="p-1">
      <div className="mb-3 px-1 text-[11px] text-neutral-500">
        Times are editable — click a cell, type a time (<span className="font-mono">15:35</span> or <span className="font-mono">1535</span>), press Enter. An arrival (or
        origin departure) retimes the whole trip; a stop's departure adjusts its dwell; a job's off-duty time adjusts its hours.
        The stringline re-draws to match. <span className="font-bold">Tolerance</span> (−early / +late, minutes by the destination)
        says how far off the computed times a train may realistically run; the stringline draws it as a ribbon that widens along the
        run, in place of guessing where unexplained time goes. Zero both sides = a sharp line. To give one leg its own value, hover
        the string on the stringline and drag that leg's handle.
      </div>

      <Summary trips={trips} restrictions={restrictions} day={day} onSave={onSave} />

      <Block title="Eastbound — Macon toward Savannah" list={east} onShift={onShift} onSave={onSave} />
      <Block title="Westbound — Savannah toward Macon" list={west} reverse onShift={onShift} onSave={onSave} />

      {other.length > 0 && (
        <div>
          <div className="mb-1.5 border-b border-brand pb-1 font-mono text-xs font-bold tracking-widest text-brand uppercase">
            Yard, local &amp; MOW assignments
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left">
                {["Job", "Location", "On duty", "Off duty", "Assignment"].map((h) => (
                  <th key={h} className="border-b border-neutral-400 px-2 py-1 font-mono text-[10px] tracking-wider text-neutral-400 uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {other.map((t) => {
                const p = computeTrip(t, day, restrictions)[0];
                return (
                  <tr key={t.id} className="hover:bg-neutral-50">
                    <td className="border-b border-neutral-200 px-2 py-1 font-mono font-bold text-neutral-900">{t.symbol}</td>
                    <td className="border-b border-neutral-200 px-2 py-1 text-neutral-700">
                      {(() => {
                        const rg = jobRange(t);
                        const base = ST(t.waypoints[0].st).name;
                        if (rg.hi <= rg.lo) return base;
                        return (
                          <>
                            {base}
                            <span className="text-neutral-400">
                              {" "}
                              · covers {ST(rg.w ?? t.waypoints[0].st).name} ↔ {ST(rg.e ?? t.waypoints[0].st).name}
                            </span>
                          </>
                        );
                      })()}
                    </td>
                    <td className="border-b border-neutral-200 px-2 py-1 font-mono text-neutral-700">
                      <TimeCell value={p.arrive} onCommit={(v) => onShift(t.id, wrapDelta(v, p.arrive))} />
                    </td>
                    <td className="border-b border-neutral-200 px-2 py-1 font-mono text-neutral-700">
                      <TimeCell
                        value={p.depart}
                        onCommit={(v) => onSave({ id: t.id, work: Math.max(30, (t.work || 0) + wrapDelta(v, p.depart)) })}
                      />
                    </td>
                    <td className="border-b border-neutral-200 px-2 py-1 text-neutral-500">{t.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
