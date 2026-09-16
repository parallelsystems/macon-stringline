/**
 * Built-in views — shipped with the app so everyone who opens the site sees
 * them, unlike a planner's own saved views (localStorage, per browser).
 * Same snapshot shape as lib/views.js; `builtIn: true` makes them read-only
 * in the roster (load, or save a copy under a new name — never update or
 * delete). Times are still never stored: loading recomputes.
 */
import { SEED_TRIPS, PS_SCHEDULES, wp } from "./network.js";

/* "Feedback" (Sep 2026). Ethan's night-start idea from the 9 Sep email —
   one vehicle out of Pooler and one out of Macon at ~22:00, meet and charge
   at Vidalia, at destination ~07:00 — laid over G&W's traffic with the
   Collins overnight stand shown. Joe Underwood's reply is what the chart
   flags: the Macon vehicle reaches Vidalia fine, but BOTH vehicles have to
   pass Collins (00:00 westbound, 04:48 eastbound) while the tied-down L781
   and Y120 trains occupy both tracks there (23:33-06:30) — no route until
   the day crews come on. PS3 hidden; the third unit is not part of the idea. */
const feedbackTrips = SEED_TRIPS.map((t) => {
  if (t.id === "t12")
    return {
      ...t,
      note: "PSYX0002 — Ethan's night idea (9 Sep): Macon 22:00 to Plastic Express, charge at Vidalia, meets PS5 there",
      time: 1320,
      waypoints: [
        wp("macon"), wp("agile"), wp("dublin"), wp("vidalia", 25, true, 75), wp("lyons"), wp("collins"),
        wp("groveland"), wp("magazine"), wp("meldrim"), wp("pooler"), wp("plastic"),
      ],
    };
  if (t.id === "t11")
    return {
      ...t,
      note: "PSYX0005 — Ethan's night idea (9 Sep): Pooler 22:00 to Macon, charge at Vidalia, meets PS2 there",
      time: 1320,
      waypoints: [
        wp("pooler"), wp("meldrim"), wp("magazine"), wp("groveland"), wp("collins"), wp("lyons"),
        // 75 charge + waits in the yard for PS2 to clear in (02:42) — "meet at Vidalia"
        wp("vidalia", 25, true, 120), wp("dublin"), wp("agile"), wp("macon"),
      ],
    };
  return t;
});

export const PRESET_VIEWS = [
  {
    id: "preset-feedback-2026-09",
    name: "Feedback",
    builtIn: true,
    savedAt: "2026-09-15T00:00:00.000Z",
    note:
      "G&W (Joe Underwood, Sep 2026): the Collins main is blocked overnight while the L781 and Y120 trains wait for their day crews. " +
      "781/781R and 782/782R are shown as contiguous trains so the overnight stand is visible. Ethan's 22:00 two-vehicle idea is laid over it — both vehicles hit Collins inside the blocked window. Plan of record to be revisited after the site visit.",
    snap: {
      trips: feedbackTrips,
      restrictions: [],
      hidden: ["t13"],
      sched: "night",
      win: [...PS_SCHEDULES.night.cycleWin],
      // Tuesday: the meets list shows the Collins crossings of the vehicles
      // that left Monday night, and the chart runs Tue 21:20 -> Wed 22:00
      day: 2,
    },
  },
];
