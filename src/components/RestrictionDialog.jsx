import React, { useState } from "react";
import { DAYS, STATIONS } from "../data/network.js";
import { parseHM } from "../lib/schedule.js";

/**
 * Track restriction: a speed restriction or an out-of-service window over a
 * range of the line. Because running times are computed, adding one genuinely
 * re-draws affected strings and can create a new meet.
 */
export default function RestrictionDialog({ day, onSave, onClose }) {
  const [r, setR] = useState({
    kind: "speed",
    mph: 10,
    from: "dublin",
    to: "vidalia",
    days: [day],
    t0: 480,
    t1: 720,
    note: "",
  });
  const [t0, setT0] = useState("0800");
  const [t1, setT1] = useState("1200");

  const toggleDay = (i) =>
    setR((p) => ({
      ...p,
      days: p.days.includes(i) ? p.days.filter((x) => x !== i) : [...p.days, i].sort((a, b) => a - b),
    }));

  const LABEL = "mb-1 block font-mono text-[10px] tracking-wider text-neutral-500 uppercase";
  const INPUT = "w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-700 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/50 p-4">
      <div className="mt-12 w-full max-w-md rounded border border-neutral-400 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-300 bg-brand px-4 py-2">
          <span className="font-mono text-sm font-bold tracking-wider text-white uppercase">Track restriction</span>
          <button onClick={onClose} className="px-2 font-mono text-lg leading-none text-neutral-300 hover:text-white" aria-label="Close">
            ×
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex gap-4">
            {[
              ["speed", "Speed restriction"],
              ["oos", "Out of service"],
            ].map(([k, label]) => (
              <label key={k} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input type="radio" checked={r.kind === k} onChange={() => setR({ ...r, kind: k })} />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {r.kind === "speed" && (
            <label className="block">
              <span className={LABEL}>Restricted to (MPH)</span>
              <input
                type="number"
                min={1}
                max={40}
                value={r.mph}
                onChange={(e) => setR({ ...r, mph: Math.max(1, Number(e.target.value) || 10) })}
                className="w-24 rounded border border-neutral-300 px-2 py-1 font-mono text-sm"
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            {[
              ["from", "From"],
              ["to", "To"],
            ].map(([k, label]) => (
              <label key={k} className="block">
                <span className={LABEL}>{label}</span>
                <select value={r[k]} onChange={(e) => setR({ ...r, [k]: e.target.value })} className={INPUT}>
                  {STATIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}

            <label className="block">
              <span className={LABEL}>Begins (HH:MM)</span>
              <input
                value={t0}
                onChange={(e) => {
                  setT0(e.target.value);
                  const v = parseHM(e.target.value);
                  if (v != null) setR((p) => ({ ...p, t0: v }));
                }}
                className={`${INPUT} font-mono`}
              />
            </label>

            <label className="block">
              <span className={LABEL}>Ends (HH:MM)</span>
              <input
                value={t1}
                onChange={(e) => {
                  setT1(e.target.value);
                  const v = parseHM(e.target.value);
                  if (v != null) setR((p) => ({ ...p, t1: v }));
                }}
                className={`${INPUT} font-mono`}
              />
            </label>
          </div>

          <div>
            <span className={LABEL}>Days</span>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((dd, i) => (
                <button
                  key={dd}
                  onClick={() => toggleDay(i)}
                  className={`w-10 rounded border px-1 py-1 font-mono text-xs uppercase ${
                    r.days.includes(i)
                      ? "border-brand bg-brand text-white"
                      : "border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50"
                  }`}
                >
                  {dd}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className={LABEL}>Note</span>
            <input
              value={r.note}
              onChange={(e) => setR({ ...r, note: e.target.value })}
              placeholder="Surfacing gang"
              className={INPUT}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-200 bg-neutral-50 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded border border-neutral-400 bg-white px-3 py-1.5 font-mono text-xs tracking-wider text-neutral-700 uppercase hover:bg-neutral-100"
          >
            Close
          </button>
          <button
            onClick={() => {
              onSave(r);
              onClose();
            }}
            disabled={!r.days.length}
            className="rounded bg-brand px-4 py-1.5 font-mono text-xs tracking-wider text-white uppercase hover:bg-brand-soft disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
