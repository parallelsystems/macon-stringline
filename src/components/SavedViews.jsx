import React, { useEffect, useRef, useState } from "react";
import { DAYS } from "../data/network.js";
import { whenLabel } from "../lib/views.js";

/**
 * Toolbar control for named saved views. Opens a popover with the list of
 * saved views (load / delete), a name field to save the current plan as a
 * new view, and — when a view is loaded and has been changed — an Update
 * button that overwrites it in place.
 */
export default function SavedViews({ views, currentId, dirty, onSave, onUpdate, onLoad, onDelete }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const wrap = useRef(null);
  const input = useRef(null);

  const current = views.find((v) => v.id === currentId) || null;

  useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    setTimeout(() => input.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const submit = (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onSave(n);
    setName("");
  };

  const label = current ? `${current.name}${dirty ? " *" : ""}` : "Save view";
  const userCount = views.filter((v) => !v.builtIn).length;

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={
          current
            ? dirty
              ? `Loaded view "${current.name}" has unsaved changes`
              : `Loaded view "${current.name}"`
            : "Save the current plan as a named view, or load one"
        }
        className={`flex max-w-[200px] items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] tracking-wider uppercase ${
          current
            ? "border-brand bg-brand text-white hover:bg-brand-soft"
            : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
        }`}
      >
        <span className="truncate">{label}</span>
        {userCount > 0 && !current && (
          <span className="rounded bg-neutral-200 px-1 text-[9px] font-bold text-neutral-700">{userCount}</span>
        )}
        <span className="text-[8px]">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded border border-neutral-300 bg-white shadow-xl">
          <div className="border-b border-neutral-200 px-3 py-1.5 font-mono text-[10px] tracking-widest text-neutral-500 uppercase">
            Saved views
          </div>

          {current && (
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-[11px] font-bold text-neutral-800">{current.name}</div>
                <div className="text-[10px] text-neutral-500">
                  {current.builtIn
                    ? dirty ? "built-in view, changed — save a copy below" : "built-in view — read-only"
                    : dirty ? "changed since loaded" : "loaded — matches saved"}
                </div>
              </div>
              <button
                disabled={!dirty || current.builtIn}
                onClick={() => onUpdate(current.id)}
                title={current.builtIn ? "Built-in views ship with the app and can't be overwritten — save a copy under a new name" : undefined}
                className={`shrink-0 rounded px-2 py-1 font-mono text-[10px] tracking-wider uppercase ${
                  dirty && !current.builtIn
                    ? "bg-brand text-white hover:bg-brand-soft"
                    : "cursor-default border border-neutral-200 text-neutral-400"
                }`}
              >
                Update
              </button>
            </div>
          )}

          <div className="max-h-64 overflow-y-auto">
            {views.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-neutral-400">
                No saved views yet. Drag strings into position, then name the result below.
              </div>
            ) : (
              views.map((v) => {
                const on = v.id === currentId;
                const asking = confirmDel === v.id;
                return (
                  <div
                    key={v.id}
                    className={`flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2 last:border-b-0 ${
                      on ? "bg-neutral-100" : "hover:bg-neutral-50"
                    }`}
                  >
                    <button onClick={() => { onLoad(v.id); setOpen(false); }} className="min-w-0 flex-1 text-left" title={v.note || undefined}>
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-[11px] font-bold text-neutral-900">{v.name}</span>
                        {v.builtIn && (
                          <span className="shrink-0 rounded border border-brand px-1 font-mono text-[8px] tracking-wider text-brand uppercase">built-in</span>
                        )}
                      </div>
                      <div className="text-[10px] text-neutral-500">
                        {DAYS[v.snap.day] ?? ""} · {v.snap.trips.length} trips
                        {v.snap.restrictions.length ? ` · ${v.snap.restrictions.length} restr.` : ""} · {v.builtIn ? "ships with the app" : whenLabel(v.savedAt)}
                      </div>
                      {v.builtIn && v.note && <div className="mt-0.5 line-clamp-3 text-[10px] leading-snug text-neutral-500">{v.note}</div>}
                    </button>
                    {v.builtIn ? null : asking ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => { onDelete(v.id); setConfirmDel(null); }}
                          className="rounded border border-red-300 bg-white px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-red-700 uppercase hover:bg-red-50"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDel(null)}
                          className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-neutral-600 uppercase hover:bg-neutral-50"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDel(v.id)}
                        className="shrink-0 px-1 font-mono text-sm leading-none text-neutral-400 hover:text-red-700"
                        aria-label={`Delete view ${v.name}`}
                        title="Delete this view"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <form onSubmit={submit} className="flex items-center gap-1.5 border-t border-neutral-200 px-3 py-2">
            <input
              ref={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={current ? "Save as new view…" : "Name this view…"}
              maxLength={60}
              className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className={`shrink-0 rounded px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase ${
                name.trim()
                  ? "bg-brand text-white hover:bg-brand-soft"
                  : "cursor-default border border-neutral-200 text-neutral-400"
              }`}
            >
              Save
            </button>
          </form>
          <div className="border-t border-neutral-100 px-3 py-1.5 text-[10px] text-neutral-400">
            A view keeps trips, retimed departures, restrictions, hidden units, schedule pattern, zoom, and day.
            Your views are stored in this browser only; built-in ones ship with the app.
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Idle prompt: shown by App a couple of seconds after the planner drags a
 * string and then stops moving the mouse. Renders INSIDE the chart canvas
 * (the parent must be position: relative), centered over the time axis at
 * the top where the eye already is — a corner toast was too easy to miss.
 * Non-blocking — name and save, update the loaded view, or ignore.
 */
export function SaveViewPrompt({ loaded, dirty, onSave, onUpdate, onIgnore }) {
  const [name, setName] = useState("");
  const input = useRef(null);
  // Drag the card out of the way by its header. `pos` is an offset from the
  // default top-center anchor, so the card can be pushed anywhere over the
  // chart without changing how it's laid out.
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const headDown = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const headMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    setPos({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
  };
  const headUp = (e) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onIgnore();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onIgnore]);

  const submit = (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onSave(n);
  };

  return (
    <div
      role="dialog"
      aria-label="Save this view?"
      className="absolute top-3 left-1/2 z-30 w-[22rem] max-w-[calc(100%-1.5rem)] rounded border-2 border-brand bg-white shadow-2xl"
      style={{ transform: `translate(calc(-50% + ${pos.x}px), ${pos.y}px)` }}
    >
      <div
        onPointerDown={headDown}
        onPointerMove={headMove}
        onPointerUp={headUp}
        onPointerCancel={headUp}
        title="Drag to move"
        className="flex cursor-move items-center justify-between border-b border-neutral-200 bg-brand px-3 py-1.5 select-none"
        style={{ touchAction: "none" }}
      >
        <span className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-wider text-white uppercase">
          <span className="text-neutral-300" aria-hidden="true">⋮⋮</span>
          Save this view?
        </span>
        <button
          onClick={onIgnore}
          className="px-1 font-mono text-base leading-none text-neutral-200 hover:text-white"
          aria-label="Ignore"
          title="Ignore"
        >
          ×
        </button>
      </div>
      <div className="px-3 py-2 text-[11px] text-neutral-600">
        You retimed the plan. Keep this arrangement as a named view to come back to.
      </div>
      {loaded && dirty && (
        <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-3 py-2">
          <span className="min-w-0 truncate text-[11px] text-neutral-600">
            Loaded: <span className="font-mono font-bold text-neutral-800">{loaded.name}</span>
          </span>
          <button
            onClick={() => onUpdate(loaded.id)}
            className="shrink-0 rounded border border-brand bg-white px-2 py-1 font-mono text-[10px] tracking-wider text-brand uppercase hover:bg-neutral-50"
          >
            Update it
          </button>
        </div>
      )}
      <form onSubmit={submit} className="flex items-center gap-1.5 border-t border-neutral-200 px-3 py-2">
        <input
          ref={input}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={loaded ? "Save as new view…" : "Name this view…"}
          maxLength={60}
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className={`shrink-0 rounded px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase ${
            name.trim() ? "bg-brand text-white hover:bg-brand-soft" : "cursor-default border border-neutral-200 text-neutral-400"
          }`}
        >
          Save
        </button>
        <button
          type="button"
          onClick={onIgnore}
          className="shrink-0 rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-[10px] tracking-wider text-neutral-500 uppercase hover:bg-neutral-50"
        >
          Ignore
        </button>
      </form>
    </div>
  );
}
