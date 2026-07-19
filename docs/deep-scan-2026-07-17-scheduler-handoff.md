# Deep-scan 2026-07-17 -- scheduler.ts hand-off (2 confirmed MED findings)

**Status: HAND-OFF, not a carry-forward.** `src/server/scheduler.ts` is under active
WIP by a concurrent session (evidenced by untracked `scheduler_pinned.ts` /
`restore_pinned.mjs` in the main checkout, with deep-scan-scheduler investigation
notes dated 2026-07-06 at the top of `scheduler_pinned.ts`). Per CLAUDE.md
section 11c (zero-carry-forward rule), a finding whose fix lives in a file another
concurrent agent actively owns is written up as a hand-off with full repro detail
so the owning session (or the operator) can apply it directly without re-deriving.

Both findings below were confirmed by direct code read in this worktree
(`wt-deepscan-b-fixwave`) prior to writing this note.

---

## Finding 1: mcl-pre-eia-stop-tighten ignores the EIA calendar, fires on fixed weekday

**File:line:** `src/server/scheduler.ts` ~line 6147 (registration block starts
~6135, `scheduleUtc` call ~6147)

```
registerJob("mcl-pre-eia-stop-tighten", 7 * 24 * 60 * 60 * 1000, async () => {
  ...
  scheduleUtc("0 14,15 * * 3", ...)   // hardcoded: every Wednesday, 14:00 and 15:00 UTC
```

**The bug:** the cron trigger is a fixed `* * 3` (every Wednesday) and never
consults the codebase's own EIA release calendar
(`src/server/lib/eia-dates.ts` / the `STATIC_EVENTS['EIA']` table in
`src/engine/economic_calendar.py`). The EIA Weekly Petroleum Status Report
(crude-oil inventory release) normally posts Wednesday 10:30 ET, but on the
~5 weeks/year where the preceding Monday is a federal holiday, EIA shifts the
release to **Thursday 11:00 ET** instead. The scheduler has no awareness of
this shift.

**Concrete failure scenario:** on a Monday-holiday week, the job tightens MCL
stops on Wednesday (when there is no elevated-volatility release that day) and
does **not** fire on Thursday (when the actual EIA print happens and stop
protection is needed). Net effect: protection runs on the wrong day and is
absent on the day it's for.

**Next real occurrence after 2026-07-17:** 2026-09-10 (Thursday, Labor Day
week shift — Labor Day is Monday 2026-09-07).

**Suggested fix direction:** have `runMclPreEiaStopTighten`
(`src/server/services/mcl-pre-eia-stop-tighten-service.ts`) consult
`eia-dates.ts` / `EIA_EVENTS` to confirm today (or the relevant lookback day)
is actually a real EIA release day before tightening, rather than trusting
the day-of-week alone. Alternatively, move the cron trigger itself to be
EIA-calendar-driven (compute the next real release day from the calendar and
schedule off that) instead of a fixed `* * 3` weekday cron. Do not write the
fix here — this is a hand-off, not an implementation.

---

## Finding 2: reconcileMissedRuns() boot catch-up bypasses ET-hour guards for jobs not yet swept into `_ET_HOUR_ANCHORED_NO_CATCHUP`

**File:line:** `src/server/scheduler.ts` ~line 1005 (confirmed function starts
at line 979; the `_ET_HOUR_ANCHORED_NO_CATCHUP` guard check is at line 1001)

**The bug:** `reconcileMissedRuns()` unconditionally fires any job with
`intervalMs <= 24h` on every process boot, because `SCHEDULER_JOBS` is
in-memory-only, so `meta.lastRunAt` is always `null` at that instant — there is
no persisted last-run timestamp to compare against. This bypasses any
ET-hour/day guard that lives only inside the job's own `scheduleUtc(...)`
cron wrapper, since `reconcileMissedRuns` calls the job's `run` function
directly rather than going through the cron trigger.

The repo already partially fixed this class of bug for 5 daily jobs via the
`_ET_HOUR_ANCHORED_NO_CATCHUP` set (`scheduler.ts` ~lines 971-977):
`consistency-tracker-daily-digest`, `composite-health-daily-digest`,
`wave26-cohort-daily-audit-report`, `portfolio-drift-demotion`,
`regime-drift-detector`.

**nightly-critique is a live, unguarded instance of the same class.** It is
registered at `scheduler.ts` line 3560 with a 24h interval
(`registerJob("nightly-critique", 24 * 60 * 60 * 1000, ...)`) and its intended
schedule is 23:00 ET daily (`src/server/services/nightly-critique-service.ts`),
but `"nightly-critique"` is **not** present in `_ET_HOUR_ANCHORED_NO_CATCHUP`.

**Concrete failure scenario:** any process restart/deploy that happens outside
the 23:00 ET window (i.e. almost any restart) causes `reconcileMissedRuns` to
run `nightly-critique` immediately on boot, off-hours, once per restart —
duplicate/out-of-window critique runs, independent of whatever the intended
once-daily-at-23:00 cadence is supposed to guarantee.

**Suggested fix direction:** add `"nightly-critique"` to
`_ET_HOUR_ANCHORED_NO_CATCHUP` (mirrors the existing 5-entry pattern exactly).
Additionally — per this repo's own "fix the pattern class, not the instance"
policy — flag this as needing a dedicated sweep across the ~40 other 24h-interval
`registerJob(...)` entries in `scheduler.ts` to check which of them have the
same ET-hour-anchored intent but are missing from the guard set. Do not do the
full sweep or write the fix here — this is a hand-off, not an implementation.

---

Owner: whichever session currently holds `scheduler_pinned.ts` WIP. Trigger to
un-hand-off: once that WIP lands/clears, either session may apply these two
fixes directly, worktree-isolated, no packet needed (both are cron-registration
bugs, not instrument/gate logic).
