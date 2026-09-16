/**
 * Saved views — named snapshots of the plan a planner can come back to.
 *
 * A view is everything that decides what the stringline shows: the trips
 * (including any drag-retimed departure anchors), restrictions, which trips
 * are hidden, the Parallel schedule pattern, the zoom window, and the day.
 * Times are NOT stored — a view holds the inputs and the plan is recomputed
 * on load, so a later change to track speeds re-draws every saved view too.
 *
 * Storage decision (see CLAUDE.md): views live in the browser's localStorage,
 * keyed per origin. That makes them per-machine, per-browser — right for a
 * single planner comparing alternatives, not a shared plan of record. The
 * serialize/parse helpers are the seam if that ever moves server-side.
 *
 * Pure module: no React, no DOM access outside the two storage functions.
 */

export const VIEWS_KEY = "gc-planner.views.v1";

/** Take a snapshot of the plan state. `hidden` comes in as a Set. */
export function snapshot({ trips, restrictions, hidden, sched, win, day }) {
  return {
    trips,
    restrictions,
    hidden: [...hidden],
    sched,
    win: [win[0], win[1]],
    day,
  };
}

/** Stable string form of a snapshot, for dirty-checking a loaded view. */
export function fingerprint(snap) {
  return JSON.stringify({ ...snap, hidden: [...snap.hidden].sort() });
}

export function newView(name, snap) {
  return {
    id: `v${Date.now()}`,
    name: name.trim(),
    savedAt: new Date().toISOString(),
    snap,
  };
}

export function loadViews(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isView) : [];
  } catch {
    return [];
  }
}

export function storeViews(views, storage = globalThis.localStorage) {
  try {
    storage?.setItem(VIEWS_KEY, JSON.stringify(views));
    return true;
  } catch {
    return false;
  }
}

function isView(v) {
  return (
    v &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    v.snap &&
    Array.isArray(v.snap.trips) &&
    Array.isArray(v.snap.restrictions) &&
    Array.isArray(v.snap.hidden) &&
    Array.isArray(v.snap.win) &&
    v.snap.win.length === 2
  );
}

/** Short relative label for the roster: "just now", "3 min ago", "Tue 14:02". */
export function whenLabel(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.round((now - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h ago`;
  return new Date(t).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
