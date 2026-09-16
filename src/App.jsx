import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  DAYS,
  STATIONS,
  TYPES,
  ST,
  wp,
  AGILE,
  SEED_TRIPS,
  SEED_RESTRICTIONS,
  PS_PATTERNS,
  DEFAULT_PATTERN,
  applyPattern,
} from "./data/network.js";
import { findMeets, findPossibleMeets, findOpenWindows, fmt, toTSV, tripName, tolValue, withTolAt } from "./lib/schedule.js";
import { snapshot, fingerprint, newView, loadViews, storeViews } from "./lib/views.js";
import { PRESET_VIEWS } from "./data/presets.js";
import { BRAND } from "./theme.js";
import Stringline from "./components/Stringline.jsx";
import SavedViews, { SaveViewPrompt } from "./components/SavedViews.jsx";
import WeekView from "./components/WeekView.jsx";
import Timetable from "./components/Timetable.jsx";
import TripDialog from "./components/TripDialog.jsx";
import RestrictionDialog from "./components/RestrictionDialog.jsx";

/* Time windows for the zoom control, in minutes from midnight. "Cycle" —
   the default — frames exactly one service cycle: it opens at 14:35, the
   moment L782R clears into Macon and the railroad becomes ours, and closes
   at 15:25 the next day, just before the next parade departs. Departure,
   return, and the next morning's traffic all fit with no cut-off strings
   at either edge. The others zoom into slices of a single day. */
const WINDOWS = [
  [875, 2365, "Cycle"],
  [0, 1440, "Day"],
  [240, 780, "AM"],
  [720, 1320, "PM"],
  [960, 1440, "Night"],
];

/* A location job's coverage is `range: { w, e }` (far station each way, or
   null). Drop the key entirely when both sides are empty, and retire the
   older single-ended `territory` whenever a range is written. */
function normalizeRange(t) {
  const n = { ...t };
  if ("range" in n) {
    const w = n.range?.w || null;
    const e = n.range?.e || null;
    if (w || e) n.range = { w, e };
    else delete n.range;
    delete n.territory;
  }
  return n;
}

/* Tolerance lives on waypoints (`w.tol = { early, late }`, minutes >= 0, on a
   stop or the destination). Drop the key when both are zero so a plain trip
   stays plain. A legacy trip-level `tol` is kept as-is (lib/schedule.js reads
   it) unless it is empty. */
function normalizeTol(t) {
  const n = { ...t };
  if (Array.isArray(n.waypoints)) {
    n.waypoints = n.waypoints.map((w) => {
      if (!("tol" in w)) return w;
      const v = tolValue(w.tol);
      const o = { ...w };
      if (v) o.tol = v;
      else delete o.tol;
      return o;
    });
  }
  if ("tol" in n) {
    const v = tolValue(n.tol);
    if (v) n.tol = { ...v, ...(typeof n.tol?.from === "string" && n.tol.from ? { from: n.tol.from } : {}), ...(typeof n.tol?.to === "string" && n.tol.to ? { to: n.tol.to } : {}) };
    else delete n.tol;
  }
  return n;
}
const normalizeTrip = (t) => normalizeTol(normalizeRange(t));

export default function App() {
  // The seed trips carry the three-unit Night pattern; the plan opens on the
  // DEFAULT_PATTERN (see PS_PATTERNS) with every Parallel unit hidden, so
  // the first picture is still G&W's railroad as-is.
  const [trips, setTrips] = useState(() => applyPattern(SEED_TRIPS, DEFAULT_PATTERN));
  const [restrictions, setRestrictions] = useState(SEED_RESTRICTIONS);
  const [day, setDay] = useState(1);
  const [view, setView] = useState("stringline");
  const [sel, setSel] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [showTimes, setShowTimes] = useState(false);
  const [showSpeeds, setShowSpeeds] = useState(false);
  const [showSwitches, setShowSwitches] = useState(false);
  const [win, setWin] = useState(PS_PATTERNS[DEFAULT_PATTERN].cycleWin); // default: full-cycle view
  // Which Parallel fleet pattern is loaded — see PS_PATTERNS. Picked in the
  // Parallel panel; decides which seed units are part of the plan at all.
  const [sched, setSched] = useState(DEFAULT_PATTERN);
  const pattern = PS_PATTERNS[sched] || PS_PATTERNS[DEFAULT_PATTERN];
  const SEED_PS_IDS = SEED_TRIPS.filter((t) => t.type === "parallel").map((t) => t.id);
  // a seed unit outside the current pattern is not in the plan (user-added
  // Parallel trips always are)
  const inPlan = (t) => t.type !== "parallel" || !SEED_PS_IDS.includes(t.id) || pattern.units.includes(t.id);
  const [exportText, setExportText] = useState(null);
  const [slot, setSlot] = useState(null); // null | { from, to } — find-a-slot route
  // Hidden trips stay in the roster but leave the plan entirely — string,
  // meets, slot windows, timetable. A non-destructive annul for what-ifs.
  // Parallel vehicles start hidden: the default view is G&W's railroad
  // as-is, and the demo reveals our vehicles one at a time.
  const defaultHidden = () =>
    new Set(SEED_TRIPS.filter((t) => t.type === "parallel").map((t) => t.id));
  const [hidden, setHidden] = useState(defaultHidden);

  const toggleHidden = (id) =>
    setHidden((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const visible = useMemo(() => trips.filter((t) => !hidden.has(t.id) && inPlan(t)), [trips, hidden, sched]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = trips.filter((t) => t.days.includes(day) && inPlan(t));
  const activeRes = restrictions.filter((r) => r.days.includes(day));
  const meets = useMemo(() => findMeets(visible, day, restrictions), [visible, day, restrictions]);
  // second grade: ribbons overlap, nominal strings don't cross
  const possible = useMemo(() => findPossibleMeets(visible, day, restrictions), [visible, day, restrictions]);

  const slotWins = useMemo(() => {
    if (!slot || slot.from === slot.to) return [];
    const ia = STATIONS.findIndex((s) => s.id === slot.from);
    const ib = STATIONS.findIndex((s) => s.id === slot.to);
    const path = ia < ib ? STATIONS.slice(ia, ib + 1) : STATIONS.slice(ib, ia + 1).reverse();
    return findOpenWindows({ waypoints: path.map((s) => wp(s.id)) }, visible, day, restrictions);
  }, [slot, visible, day, restrictions]);

  /* ---- "Save this view?" idle prompt ---------------------------------
     After a drag-retime, wait for SAVE_PROMPT_IDLE_MS with no mouse or key
     activity, then offer to save. Any activity in that window restarts the
     clock; the prompt is offered once per burst of moves. Saving, updating,
     or ignoring disarms it completely — ONLY another string drag (shift)
     can bring it back. Nothing else in the app arms it. */
  const SAVE_PROMPT_IDLE_MS = 1200;
  const [savePrompt, setSavePrompt] = useState(false);
  const movedRef = useRef(false);
  const idleTimer = useRef(null);
  const dirtyRef = useRef(false); // mirror viewDirty / currentView for the timer callback
  const currentViewRef = useRef(null);
  const disarmSavePrompt = useCallback(() => {
    movedRef.current = false;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
  }, []);
  const armSavePrompt = useCallback(() => {
    movedRef.current = true;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      if (!movedRef.current) return;
      movedRef.current = false;
      // dragged back to exactly the saved arrangement — nothing to save
      if (dirtyRef.current === false && currentViewRef.current) return;
      setSavePrompt(true);
    }, SAVE_PROMPT_IDLE_MS);
  }, []);
  useEffect(() => {
    const activity = () => {
      // only the post-drag idle countdown is affected; an open prompt stays put
      if (movedRef.current && idleTimer.current) armSavePrompt();
    };
    document.addEventListener("mousemove", activity);
    document.addEventListener("mousedown", activity);
    document.addEventListener("keydown", activity);
    return () => {
      document.removeEventListener("mousemove", activity);
      document.removeEventListener("mousedown", activity);
      document.removeEventListener("keydown", activity);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [armSavePrompt]);
  const dismissSavePrompt = useCallback(() => {
    disarmSavePrompt();
    setSavePrompt(false);
  }, [disarmSavePrompt]);
  const shift = useCallback(
    (id, delta) => {
      setTrips((p) => p.map((t) => (t.id === id ? { ...t, time: t.time + delta } : t)));
      armSavePrompt();
    },
    [armSavePrompt]
  );


  // Drag the off-duty end of a yard / local / MOW bar: changes hours on duty.
  const resizeWork = useCallback(
    (id, delta) => {
      setTrips((p) => p.map((t) => (t.id === id ? { ...t, work: Math.max(30, (t.work || 0) + delta) } : t)));
      armSavePrompt();
    },
    [armSavePrompt]
  );

  // Vertical drag of a yard / local / MOW bar: move the base point to another
  // station. Edge drag: stretch the coverage band — { w, e } far-station ids,
  // either null. Replaces the older single-ended `territory`.
  const relocate = useCallback(
    (id, st) => {
      setTrips((p) => p.map((t) => (t.id === id ? { ...t, waypoints: [wp(st)] } : t)));
      armSavePrompt();
    },
    [armSavePrompt]
  );
  const setRange = useCallback(
    (id, range) => {
      setTrips((p) => p.map((t) => (t.id === id ? normalizeRange({ ...t, range }) : t)));
      armSavePrompt();
    },
    [armSavePrompt]
  );
  // Drag of a leg's ◂ ▸ tolerance handle: sets the anchor at that leg's end.
  const setTol = useCallback(
    (id, wpIdx, tol) => {
      setTrips((p) => p.map((t) => (t.id === id ? withTolAt(t, wpIdx, tol) : t)));
      armSavePrompt();
    },
    [armSavePrompt]
  );

  // Every plan edit — dialog save, annul, restriction add/remove — counts
  // as "making a change" for the save-view prompt, same as a drag.
  const save = (d) => {
    if (d.id) {
      setTrips((p) =>
        p.map((t) => {
          if (t.id !== d.id) return t;
          return normalizeTrip({ ...t, ...d });
        })
      );
    } else {
      setTrips((p) => [...p, normalizeTrip({ ...d, id: `t${Date.now()}` })]);
    }
    armSavePrompt();
  };

  const del = (id) => {
    setTrips((p) => p.filter((t) => t.id !== id));
    setSel(null);
    armSavePrompt();
  };

  const reset = () => {
    setTrips(applyPattern(SEED_TRIPS, DEFAULT_PATTERN));
    setRestrictions(SEED_RESTRICTIONS);
    setSel(null);
    setHidden(defaultHidden());
    setSched(DEFAULT_PATTERN);
    setWin(PS_PATTERNS[DEFAULT_PATTERN].cycleWin);
    setCurrentView(null);
    dismissSavePrompt();
  };

  /* ---- Saved views ----------------------------------------------------
     Named snapshots of the plan inputs (trips incl. drag-retimed anchors,
     restrictions, hidden set, schedule pattern, zoom, day). Persisted to
     localStorage via lib/views.js — a deliberate per-browser choice; see
     the note there and in CLAUDE.md. Times are still never stored: loading
     a view recomputes the plan from its inputs. */
  const [views, setViews] = useState(() => loadViews()); // the planner's own
  const [currentView, setCurrentView] = useState(null); // id of the loaded view
  useEffect(() => {
    storeViews(views);
  }, [views]);
  // built-in views (data/presets.js) ship with the app and sit above the
  // planner's own in the roster; loadable, never stored or overwritten
  const allViews = useMemo(() => [...PRESET_VIEWS, ...views], [views]);

  const snap = useMemo(
    () => snapshot({ trips, restrictions, hidden, sched, win, day }),
    [trips, restrictions, hidden, sched, win, day]
  );
  const loaded = allViews.find((v) => v.id === currentView) || null;
  const viewDirty = !!loaded && fingerprint(loaded.snap) !== fingerprint(snap);
  dirtyRef.current = viewDirty;
  currentViewRef.current = currentView;

  const saveView = (name) => {
    const v = newView(name, snap);
    setViews((p) => [v, ...p]);
    setCurrentView(v.id);
    disarmSavePrompt();
    setSavePrompt(false);
  };
  const updateView = (id) => {
    if (PRESET_VIEWS.some((v) => v.id === id)) return; // built-in: save a copy instead
    setViews((p) => p.map((v) => (v.id === id ? { ...v, snap, savedAt: new Date().toISOString() } : v)));
    disarmSavePrompt();
    setSavePrompt(false);
  };
  const loadView = (id) => {
    const v = allViews.find((x) => x.id === id);
    if (!v) return;
    const s = v.snap;
    setTrips(s.trips);
    setRestrictions(s.restrictions);
    setHidden(new Set(s.hidden));
    if (s.sched && PS_PATTERNS[s.sched]) setSched(s.sched);
    setWin([s.win[0], s.win[1]]);
    if (s.day != null) setDay(s.day);
    setSel(null);
    setCurrentView(id);
    dismissSavePrompt();
  };
  const deleteView = (id) => {
    setViews((p) => p.filter((v) => v.id !== id));
    if (currentView === id) setCurrentView(null);
  };

  // Switch the Parallel fleet pattern (PS_PATTERNS): rewrites the seed
  // units it defines, brings its units into view, and re-frames the Cycle
  // window if the zoom was sitting on another pattern's cycle. User-added
  // trips are untouched. Counts as a plan change for the save-view prompt.
  const applyPatternKey = (key) => {
    const p = PS_PATTERNS[key];
    if (!p) return;
    setSched(key);
    setTrips((prev) => applyPattern(prev, key));
    setHidden((prev) => {
      const n = new Set(prev);
      p.units.forEach((id) => n.delete(id));
      return n;
    });
    setWin((w) => (Object.values(PS_PATTERNS).some((q) => q.cycleWin[0] === w[0] && q.cycleWin[1] === w[1]) ? p.cycleWin : w));
    setSel(null);
    armSavePrompt();
  };

  const BTN = "rounded border px-2.5 py-1 font-mono text-[11px] tracking-wider uppercase";
  const seg = (on) =>
    `${BTN} border-neutral-300 border-r last:border-r-0 ${
      on ? "bg-brand text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"
    }`;

  const Toggle = ({ on, set, children }) => (
    <button
      onClick={() => set(!on)}
      className={`rounded border px-2 py-1 font-mono text-[10px] tracking-wider uppercase ${
        on ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
      }`}
    >
      {children}
    </button>
  );

  // Single click selects (after a short delay so it can be cancelled);
  // double click toggles show/hide — the two never fight each other.
  const clickTimer = useRef(null);
  const rowClick = (t, on) => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      setSel(on ? null : t.id);
      clickTimer.current = null;
    }, 220);
  };
  const rowDoubleClick = (t) => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    toggleHidden(t.id);
  };

  const renderRow = (t) => {
    const on = sel === t.id;
    const off = hidden.has(t.id);
    const dim = off ? "opacity-40" : "";
    const c = t.color || TYPES[t.type].color;
    return (
      <div
        key={t.id}
        onClick={() => rowClick(t, on)}
        onDoubleClick={() => rowDoubleClick(t)}
        title={off ? "Double-click to show" : "Double-click to hide"}
        className={`cursor-pointer border-b border-neutral-100 px-3 py-2 select-none last:border-b-0 ${on ? "bg-neutral-100" : "hover:bg-neutral-50"}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className={`flex items-center gap-2 ${dim}`}>
            <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: c }} />
            <span className="font-mono text-sm font-bold text-neutral-900">{tripName(t)}</span>
            {t.unsourced && (
              <span
                className="rounded border border-dashed border-amber-500 px-1 font-mono text-[9px] tracking-wider text-amber-700 uppercase"
                title="No source for this job's hours — placeholder only"
              >
                no source
              </span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleHidden(t.id);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={
                off
                  ? `rounded bg-brand px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider text-white uppercase shadow-sm hover:bg-brand-soft ${on ? "ring-2 ring-neutral-400 ring-offset-1" : ""}`
                  : "rounded border border-neutral-200 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-neutral-400 uppercase hover:border-neutral-400 hover:text-neutral-700"
              }
              aria-label={off ? `Show ${t.symbol}` : `Hide ${t.symbol}`}
            >
              {off ? "show" : "hide"}
            </button>
            <span className={`font-mono text-[11px] text-neutral-500 ${dim}`}>{fmt(t.time)}</span>
          </span>
        </div>
        <div className={`mt-0.5 truncate pl-5 text-[11px] text-neutral-500 ${dim}`}>{t.note}</div>
        {on && (
          <div className="mt-2 flex gap-1.5 pl-5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDialog({ kind: "trip", trip: t });
              }}
              className="rounded border border-neutral-400 bg-white px-2 py-0.5 font-mono text-[10px] tracking-wider text-neutral-700 uppercase hover:bg-neutral-100"
            >
              Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                del(t.id);
              }}
              className="rounded border border-red-300 bg-white px-2 py-0.5 font-mono text-[10px] tracking-wider text-red-700 uppercase hover:bg-red-50"
            >
              Annul
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-full bg-brand-paper p-3 sm:p-5" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div className="mx-auto max-w-[1720px]">
        {/* masthead */}
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b-2 border-brand pb-2">
          <div className="flex items-center gap-3">
            {BRAND.logo && <img src={BRAND.logo} alt="" className="h-9 w-auto" />}
            <div>
              <div className="font-mono text-[10px] tracking-[0.2em] text-neutral-500 uppercase">
                {BRAND.railroad ? `${BRAND.railroad} · ${BRAND.productName}` : BRAND.productName}
              </div>
              <h1 className="text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">{BRAND.line}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[10px] tracking-wider text-neutral-500 uppercase">
            <span>
              Jobs{" "}
              <span className="ml-1 text-base font-bold text-neutral-900">
                {active.filter((t) => !hidden.has(t.id)).length}
              </span>
            </span>
            <span>
              Meets <span className={`ml-1 text-base font-bold ${meets.length ? "text-red-700" : "text-neutral-900"}`}>{meets.length}</span>
            </span>
            <span title="Crossings inside a tolerance ribbon — the plan may conflict if a train runs at the edge of what we know">
              Possible <span className={`ml-1 text-base font-bold ${possible.length ? "text-amber-700" : "text-neutral-900"}`}>{possible.length}</span>
            </span>
            <span>
              Restrictions{" "}
              <span className={`ml-1 text-base font-bold ${activeRes.length ? "text-amber-700" : "text-neutral-900"}`}>{activeRes.length}</span>
            </span>
          </div>
        </div>

        {/* toolbar */}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-neutral-300 bg-white px-2 py-2">
          <div className="flex overflow-hidden rounded border border-neutral-300">
            {DAYS.map((dd, i) => (
              <button key={dd} onClick={() => setDay(i)} className={seg(i === day)}>
                {dd}
              </button>
            ))}
          </div>
          <span className="font-mono text-[10px] tracking-wider text-neutral-400 uppercase">
            Agile: <span className="font-bold text-neutral-700">{AGILE[DAYS[day]]}</span>
          </span>

          <div className="mx-1 h-6 w-px bg-neutral-200" />

          <div className="flex overflow-hidden rounded border border-neutral-300">
            {[
              ["stringline", "Stringline"],
              ["week", "Week"],
              ["table", "Table"],
            ].map(([k, label]) => (
              <button key={k} onClick={() => setView(k)} className={seg(view === k)}>
                {label}
              </button>
            ))}
          </div>

          <div className="mx-1 h-6 w-px bg-neutral-200" />

          <button
            onClick={() => setDialog({ kind: "trip", trip: null })}
            className="rounded bg-brand px-3 py-1 font-mono text-[11px] tracking-wider text-white uppercase hover:bg-brand-soft"
          >
            + Trip
          </button>
          <button
            onClick={() => setDialog({ kind: "restriction" })}
            className="rounded border border-amber-400 bg-amber-50 px-3 py-1 font-mono text-[11px] tracking-wider text-amber-800 uppercase hover:bg-amber-100"
          >
            + Restriction
          </button>

          <div className="mx-1 h-6 w-px bg-neutral-200" />

          <Toggle on={!!slot} set={(v) => setSlot(v ? { from: "macon", to: "savannah" } : null)}>
            Find slot
          </Toggle>

          {view === "stringline" && (
            <>
              <div className="mx-1 h-6 w-px bg-neutral-200" />
              <Toggle on={showTimes} set={setShowTimes}>
                Times
              </Toggle>
              <Toggle on={showSpeeds} set={setShowSpeeds}>
                Speeds
              </Toggle>
              <Toggle on={showSwitches} set={setShowSwitches}>
                Switches
              </Toggle>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] tracking-wider text-neutral-400 uppercase">Zoom</span>
                {WINDOWS.map(([a, b, label]) => (
                  <button
                    key={label}
                    onClick={() => setWin([a, b])}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                      win[0] === a && win[1] === b
                        ? "border-brand bg-brand text-white"
                        : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <SavedViews
              views={allViews}
              currentId={currentView}
              dirty={viewDirty}
              onSave={saveView}
              onUpdate={updateView}
              onLoad={loadView}
              onDelete={deleteView}
            />
            <button
              onClick={() => setExportText(toTSV(visible, day, restrictions))}
              className="rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-[10px] tracking-wider text-neutral-600 uppercase hover:bg-neutral-50"
            >
              Export
            </button>
            <button
              onClick={reset}
              className="rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-[10px] tracking-wider text-neutral-500 uppercase hover:bg-neutral-50"
            >
              Reset
            </button>
          </div>
        </div>

        {/* find-a-slot panel */}
        {slot && (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-neutral-300 bg-white px-3 py-2">
            <span className="font-mono text-[10px] tracking-widest text-neutral-500 uppercase">Find a slot</span>
            <select
              value={slot.from}
              onChange={(e) => setSlot({ ...slot, from: e.target.value })}
              className="rounded border border-neutral-300 px-2 py-1 text-xs"
            >
              {STATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className="text-neutral-400">→</span>
            <select
              value={slot.to}
              onChange={(e) => setSlot({ ...slot, to: e.target.value })}
              className="rounded border border-neutral-300 px-2 py-1 text-xs"
            >
              {STATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setSlot({ from: slot.to, to: slot.from })}
              className="rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-[10px] tracking-wider text-neutral-600 uppercase hover:bg-neutral-50"
            >
              Swap
            </button>
            <div className="flex flex-wrap items-center gap-1.5">
              {slot.from === slot.to ? (
                <span className="text-[11px] text-neutral-400">Pick two different stations.</span>
              ) : slotWins.length === 0 ? (
                <span className="font-mono text-[11px] text-red-700">No workable departure on {DAYS[day]}</span>
              ) : (
                slotWins.map((w, i) => {
                  const c = w.kind === "hold" ? BRAND.colors.yellow : BRAND.colors.green;
                  const m = Math.ceil(w.maxHold);
                  const dur = m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m}min`;
                  return (
                    <span
                      key={i}
                      className="rounded border px-2 py-0.5 font-mono text-[11px]"
                      style={{ borderColor: c.base, background: `${c.light}40`, color: c.dark }}
                      title={
                        w.kind === "hold"
                          ? `Departures in this window reach the destination, but the vehicle must pull into a siding and wait for opposing trains — up to ${dur} of total waiting, depending on the exact departure time.`
                          : "Departures in this window run through with no waiting."
                      }
                    >
                      {fmt(w.from)}–{fmt(w.to === 1440 ? 1439 : w.to)}
                      {w.kind === "hold" && ` · waits ≤${dur}`}
                    </span>
                  );
                })
              )}
            </div>
            <span className="ml-auto text-[10px] text-neutral-400">
              Green: departs and runs through with no waiting. Yellow: works only by pulling into a
              siding to let opposing trains pass — "waits ≤" is the worst-case total sitting time for
              that window. Includes adjacent days' overnight traffic. Advisory — no same-direction headway.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-3 lg:flex-row">
          {/* roster — Parallel fleet gets its own panel, first, so it never
              hides below the fold; G&W jobs scroll beneath it */}
          <div className="w-full shrink-0 lg:w-64">
            <div className="mb-3 rounded border bg-white" style={{ borderColor: TYPES.parallel.color }}>
              <div
                className="flex items-center justify-between gap-2 border-b px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase"
                style={{ borderColor: `${TYPES.parallel.color}55`, color: TYPES.parallel.color }}
              >
                <span>Parallel vehicles — {DAYS[day]}</span>
                {(() => {
                  const psIds = trips.filter((t) => t.type === "parallel").map((t) => t.id);
                  if (!psIds.length) return null;
                  const anyVisible = psIds.some((id) => !hidden.has(id));
                  return (
                    <button
                      onClick={() =>
                        setHidden((p) => {
                          const n = new Set(p);
                          psIds.forEach((id) => (anyVisible ? n.add(id) : n.delete(id)));
                          return n;
                        })
                      }
                      className={`rounded px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider uppercase ${
                        anyVisible
                          ? "border border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-700"
                          : "bg-brand text-white shadow-sm hover:bg-brand-soft"
                      }`}
                      title={anyVisible ? "Hide every Parallel vehicle (back to the G&W baseline)" : "Show every Parallel vehicle"}
                    >
                      {anyVisible ? "hide all" : "show all"}
                    </button>
                  );
                })()}
              </div>
              {/* fleet pattern — the one place to choose how the vehicles run */}
              <div className="border-b border-neutral-100 px-3 pt-2 pb-1.5">
                <div className="mb-1 font-mono text-[9px] tracking-widest text-neutral-400 uppercase">Pattern</div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(PS_PATTERNS).map(([k, p]) => {
                    const on = sched === k;
                    const tone =
                      p.status === "clean" ? "border-emerald-500 text-emerald-800" : p.status === "flagged" ? "border-amber-500 text-amber-800" : "border-red-400 text-red-800";
                    return (
                      <button
                        key={k}
                        onClick={() => applyPatternKey(k)}
                        title={`${p.label} — ${p.note}${p.caveat ? ` ${p.caveat}` : ""}`}
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-wider uppercase ${
                          on ? "bg-brand text-white border-brand" : `bg-white hover:bg-neutral-50 ${tone}`
                        }`}
                      >
                        {p.short}
                      </button>
                    );
                  })}
                </div>
                {/* one line; the caveats for G&W live in the button tooltip.
                    "clean" is deliberately NOT said: the model flags no meets,
                    which is not the same as the railroad agreeing. */}
                <div
                  className={`mt-1.5 text-[10px] leading-snug ${
                    pattern.status === "clean" ? "text-neutral-700" : pattern.status === "flagged" ? "text-amber-800" : "text-red-800"
                  }`}
                  title={pattern.caveat || undefined}
                >
                  {pattern.status !== "clean" && (
                    <>
                      <span className="font-mono font-bold uppercase">{pattern.status}</span>
                      {" · "}
                    </>
                  )}
                  {pattern.note}
                </div>
              </div>
              <div className="border-b border-neutral-100 px-3 py-1 text-[10px] text-neutral-400">
                double-click a vehicle (or use its button) to show / hide it on the chart
              </div>
              {active.filter((t) => t.type === "parallel").length === 0 ? (
                <div className="px-3 py-3 text-center text-[11px] text-neutral-400">No Parallel runs this day.</div>
              ) : (
                active.filter((t) => t.type === "parallel").map(renderRow)
              )}
            </div>

            <div className="rounded border border-neutral-300 bg-white">
              <div className="border-b border-neutral-200 px-3 py-1.5 font-mono text-[10px] tracking-widest text-neutral-500 uppercase">
                G&amp;W jobs — {DAYS[day]}
              </div>
              <div className="max-h-96 overflow-y-auto lg:max-h-[480px]">
                {active.filter((t) => t.type !== "parallel").length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-neutral-400">No jobs on duty. Add a trip to start the plan.</div>
                )}
                {active.filter((t) => t.type !== "parallel").map(renderRow)}
              </div>
            </div>

            {activeRes.length > 0 && (
              <div className="mt-3 rounded border border-amber-300 bg-amber-50">
                <div className="border-b border-amber-200 px-3 py-1.5 font-mono text-[10px] tracking-widest text-amber-800 uppercase">
                  Restrictions
                </div>
                {activeRes.map((r) => (
                  <div key={r.id} className="flex items-start justify-between gap-2 border-b border-amber-100 px-3 py-2 last:border-b-0">
                    <div className="text-[11px] text-amber-900">
                      <div className="font-mono font-bold">{r.kind === "oos" ? "Out of service" : `${r.mph} MPH`}</div>
                      <div>
                        {ST(r.from).name}–{ST(r.to).name}
                      </div>
                      <div className="font-mono text-amber-700">
                        {fmt(r.t0)}–{fmt(r.t1)}
                      </div>
                      {r.note && <div className="text-amber-600 italic">{r.note}</div>}
                    </div>
                    <button
                      onClick={() => {
                        setRestrictions((p) => p.filter((x) => x.id !== r.id));
                        armSavePrompt();
                      }}
                      className="font-mono text-xs text-amber-700 hover:text-amber-900"
                      aria-label="Remove restriction"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* canvas */}
          <div className="min-w-0 flex-1">
            <div className="relative rounded border border-neutral-300 bg-white p-2 sm:p-3">
              {savePrompt && (
                <SaveViewPrompt
                  loaded={loaded}
                  dirty={viewDirty}
                  onSave={saveView}
                  onUpdate={updateView}
                  onIgnore={dismissSavePrompt}
                />
              )}
              {view === "stringline" ? (
                <>
                  <Stringline
                    trips={visible}
                    restrictions={restrictions}
                    day={day}
                    sel={sel}
                    onSel={setSel}
                    onShift={shift}
                    onResize={resizeWork}
                    onRelocate={relocate}
                    onRange={setRange}
                    onTol={setTol}
                    win={win}
                    showTimes={showTimes}
                    showSpeeds={showSpeeds}
                    showSwitches={showSwitches}
                    slotWins={slot ? slotWins : []}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-200 pt-2 font-mono text-[10px] text-neutral-500">
                    <span className="text-neutral-600">Drag a string to retime · hover it and a ◂ −/+ ▸ handle appears on each leg: drag ▸ right for "may run this late by the end of the leg", ◂ left for early · bar: sideways retimes, up/down moves it to another station, top/bottom edge stretches its coverage, right end changes hours · click to select</span>
                    {showSpeeds && (
                      <span className="text-neutral-500">
                        speeds shown per track section (red = slowed by a restriction) · gray strip at right = authorized limit
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-4" style={{ background: TYPES.road.color }} />
                      road train (line moves, slope = speed)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-4" style={{ background: TYPES.parallel.color }} />
                      Parallel consist
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-4 rounded-sm opacity-40" style={{ background: TYPES.local.color }} />
                      local job (works one place)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-4 rounded-sm opacity-40" style={{ background: TYPES.yard.color }} />
                      yard job (works one place)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-4 rounded-sm opacity-60" style={{ background: TYPES.mow.color }} />
                      MOW (track gang)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-4 rounded-sm border border-dashed bg-white" style={{ borderColor: TYPES.yard.color }} />
                      unsourced hours (placeholder — plan around, not on)
                    </span>
                    <span className="inline-flex items-center gap-1.5" title="How far off the computed times a train may realistically run — set per leg by dragging the handle that appears when you hover a string, or by the minutes under each train in the Table view. The band grows along a leg to the value at its end, holds from there, and resets at a crew change. Nothing about it says the main is clear.">
                      <span className="inline-block h-2.5 w-5 rounded-sm opacity-30" style={{ background: TYPES.road.color, clipPath: "polygon(0 40%, 100% 0, 100% 100%, 0 60%)" }} />
                      tolerance ribbon (−early / +late; position uncertain)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-4 rounded-sm bg-amber-600 opacity-25" />
                      restriction
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rotate-45" style={{ background: BRAND.colors.accent }} />
                      meet
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rotate-45 border border-dashed border-amber-700 bg-white" />
                      possible meet (inside a ribbon)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-neutral-500" />
                      siding/yard — can hold for a meet
                    </span>
                    <span className="inline-flex items-center gap-1.5" title="A stop drawn dashed is in the siding or yard, in the clear. A stop drawn as a heavy solid flat line is standing on the main — the track is occupied (L781's train at Collins overnight).">
                      <span className="inline-block h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: TYPES.road.color }} />
                      stopped in the clear ·
                      <span className="inline-block h-[3px] w-4" style={{ background: TYPES.road.color }} />
                      standing on the main (blocks)
                    </span>
                    {slot && (
                      <>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-4 rounded-sm opacity-30"
                            style={{ background: BRAND.colors.green.base }}
                          />
                          slot: nonstop
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-4 rounded-sm opacity-40"
                            style={{ background: BRAND.colors.yellow.base }}
                          />
                          slot: with holds
                        </span>
                      </>
                    )}
                  </div>
                </>
              ) : view === "week" ? (
                <>
                  <WeekView trips={visible} restrictions={restrictions} sel={sel} onSel={setSel} />
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-200 pt-2 font-mono text-[10px] text-neutral-500">
                    <span className="text-neutral-600">
                      Whole week, Mon–Sun — overnight runs spill into the next day's column
                    </span>
                    <span>
                      Use <span className="font-bold">show all / hide all</span> on the Parallel panel to flip between the
                      G&amp;W baseline and the full plan for screenshots
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rotate-45 border" style={{ borderColor: BRAND.colors.accent }} />
                      meet / pass flagged by the planner
                    </span>
                  </div>
                </>
              ) : (
                <Timetable trips={visible} restrictions={restrictions} day={day} onShift={shift} onSave={save} />
              )}
            </div>

            {possible.length > 0 && (
              <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
                <div className="mb-1.5 font-mono text-[10px] tracking-widest text-amber-800 uppercase">
                  Possible meets — {DAYS[day]} · inside a tolerance band, not a nominal crossing
                </div>
                <div className="flex flex-wrap gap-2">
                  {possible.map((m, i) => {
                    const near = STATIONS.reduce(
                      (best, s) => (Math.abs(s.mile - m.mile) < Math.abs(best.mile - m.mile) ? s : best),
                      STATIONS[0]
                    );
                    return (
                      <span key={i} className="inline-flex items-center gap-2 rounded border border-dashed border-amber-300 bg-white px-2 py-1 text-[11px]">
                        <span className="font-mono font-bold text-neutral-900">
                          {m.a} × {m.b}
                        </span>
                        <span className="font-mono text-amber-700">~{fmt(m.t)}</span>
                        <span className="text-neutral-500">near {near.name}</span>
                      </span>
                    );
                  })}
                </div>
                <div className="mt-1.5 text-[10px] text-amber-800">
                  One of these trains carries a tolerance; if it runs at the edge of that band the two are on the road together here. Weigh it — a planned pass at a siding is still the fix.
                </div>
              </div>
            )}

            {meets.length > 0 && (
              <div className="mt-3 rounded border border-red-300 bg-red-50 p-3">
                <div className="mb-1.5 font-mono text-[10px] tracking-widest text-red-800 uppercase">
                  Meets and passes — {DAYS[day]}
                </div>
                <div className="flex flex-wrap gap-2">
                  {meets.map((m, i) => {
                    const near = STATIONS.reduce(
                      (best, s) => (Math.abs(s.mile - m.mile) < Math.abs(best.mile - m.mile) ? s : best),
                      STATIONS[0]
                    );
                    return (
                      <span key={i} className="inline-flex items-center gap-2 rounded border border-red-200 bg-white px-2 py-1 text-[11px]">
                        <span className="font-mono font-bold text-neutral-900">
                          {m.a} × {m.b}
                        </span>
                        <span className="font-mono text-red-700">{fmt(m.t)}</span>
                        <span className="text-neutral-500">near {near.name}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {dialog?.kind === "trip" && (
        <TripDialog
          initial={dialog.trip}
          day={day}
          restrictions={restrictions}
          onSave={save}
          onDelete={del}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "restriction" && (
        <RestrictionDialog
          day={day}
          onSave={(r) => {
            setRestrictions((p) => [...p, { ...r, id: `r${Date.now()}` }]);
            armSavePrompt();
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {exportText != null && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/50 p-4">
          <div className="mt-12 w-full max-w-2xl rounded border border-neutral-400 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-300 bg-brand px-4 py-2">
              <span className="font-mono text-sm font-bold tracking-wider text-white uppercase">Export — {DAYS[day]}</span>
              <button
                onClick={() => setExportText(null)}
                className="px-2 font-mono text-lg leading-none text-neutral-300 hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="p-4">
              <p className="mb-2 text-xs text-neutral-500">Tab-delimited. Select all and copy, then paste into a spreadsheet.</p>
              <textarea
                readOnly
                value={exportText}
                onFocus={(e) => e.target.select()}
                className="h-64 w-full rounded border border-neutral-300 p-2 font-mono text-[11px] text-neutral-700"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
