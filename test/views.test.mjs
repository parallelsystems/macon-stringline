import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshot, fingerprint, newView, loadViews, storeViews, VIEWS_KEY } from "../src/lib/views.js";

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};
const base = () => ({
  trips: [{ id: "t1", time: 600, days: [1], type: "road", waypoints: [{ st: "macon", speed: 25, stop: false, dwell: 0 }] }],
  restrictions: [],
  hidden: new Set(["t13", "t11"]),
  sched: "night",
  win: [1280, 2760],
  day: 1,
});

test("snapshot serializes the hidden Set and copies the window", () => {
  const s = snapshot(base());
  assert.ok(Array.isArray(s.hidden));
  assert.deepEqual(s.win, [1280, 2760]);
});

test("fingerprint ignores hidden-set order but sees a retimed trip", () => {
  const a = snapshot(base());
  const b = snapshot({ ...base(), hidden: new Set(["t11", "t13"]) });
  assert.equal(fingerprint(a), fingerprint(b));
  const moved = base();
  moved.trips = moved.trips.map((t) => ({ ...t, time: t.time + 15 }));
  assert.notEqual(fingerprint(a), fingerprint(snapshot(moved)));
});

test("views round-trip through storage; corrupt or malformed data is dropped, never thrown", () => {
  const st = mem();
  const v = newView("  Night, PS5 +15 ", snapshot(base()));
  assert.equal(v.name, "Night, PS5 +15");
  assert.ok(storeViews([v], st));
  const back = loadViews(st);
  assert.equal(back.length, 1);
  assert.equal(back[0].snap.trips[0].time, 600);
  st.setItem(VIEWS_KEY, "{garbage");
  assert.deepEqual(loadViews(st), []);
  st.setItem(VIEWS_KEY, JSON.stringify([{ id: "x" }, v]));
  assert.equal(loadViews(st).length, 1);
  // no storage at all (SSR / blocked) is a no-op
  assert.deepEqual(loadViews(undefined), []);
  assert.equal(storeViews([v], undefined), true);
});
