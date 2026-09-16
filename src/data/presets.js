/**
 * Built-in views — shipped with the app so everyone who opens the site sees
 * them, unlike a planner's own saved views (localStorage, per browser).
 * Same snapshot shape as lib/views.js; `builtIn: true` makes them read-only
 * in the roster (load, or save a copy under a new name — never update or
 * delete). Times are still never stored: loading recomputes.
 *
 * None ship at the moment (the Sep 2026 "Feedback" view was removed at the
 * user's request). To add one: { id, name, builtIn: true, savedAt, note,
 * snap: { trips, restrictions, hidden, sched, win, day } }.
 */
export const PRESET_VIEWS = [];
