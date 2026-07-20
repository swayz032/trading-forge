// scripts/lib/skip-streak.cjs — rail liveness visibility (OR-008 §3, built per OR-012 §3a).
//
// WHY: "correctly skipping every night forever" and "dormant" are indistinguishable from the
// outside. On 2026-07-19 rail 2 was HEALTHY AND FULLY BLOCKED — the idle guard doing its job
// against a busy tower and then paused services — while the soak had never measured a single
// night (nightIndex 0). Separately, the 07-18 dependency erosion made three jobs write nothing
// at all for 36h. Skip-by-design is healthy; skip-forever-in-silence is dormancy wearing a
// green coat, and writing nothing at all is worse than either.
//
// ⚠ BUILT BUT NOT YET WIRED (Grade A, F-2, 2026-07-20). This module has zero production
// callers — no entrypoint hook, no cron, no poster. Its logic is correct and tested (and was
// independently re-derived against the real ledgers: soak streak = 8), but nothing invokes it,
// so no skip-streak alert reaches the operator today. Wiring is the named ACTIVATION-BATCH unit
// (alongside rail-5 task registration and the API watchdog), post-landing.
//
// Recorded here rather than left silent because dormant-by-plan and dormant-by-accident look
// identical from the outside — and this module is specifically the thing that makes future
// healthy-but-blocked dormancy visible. An unwired dormancy detector is the joke it exists to
// prevent, so its own dormancy gets stated out loud.
//
// Pure decision function, DI-tested, no clock and no I/O — the soak-mold §13 pattern.
"use strict";

// Pre-registered + versioned (anti-goalpost, soak §7). Changing these is a dated, logged event.
const THRESHOLDS_V1 = Object.freeze({
  version: "rails_thresholds_v1",
  skipStreakN: 3,    // consecutive guard-skips before we say the rail has not measured
  silentFiresN: 2,   // consecutive scheduled fires that wrote NOTHING before crash-suspicion
});

// Reason codes are internal; the operator reads English.
const REASON_ENGLISH = {
  // RETAINED, not renamed: ledger rows written before 2026-07-20 carry this code, and
  // rewriting history's label would make old skip streaks unreadable. New rows use
  // backtest_workers_active. The wording keeps the old rows honest about what that
  // check ACTUALLY meant at the time — any python at all, not necessarily research.
  python_workers_active: "tower looked busy (any Python process — pre-2026-07-20 check)",
  backtest_workers_active: "tower busy (backtest workers running)",
  backtest_probe_unavailable: "could not tell if the tower was busy (failed safe)",
  no_idle_evidence: "no way to confirm the tower was idle (failed safe)",
  python_cmdline_unreadable: "a Python process we cannot inspect (failed safe — not necessarily a backtest)",
  backend_unreachable: "backend not running",
  gpu_busy: "tower busy (GPU in use)",
  backtests_active: "tower busy (backtests running)",
  switch_off: "switched off by the operator",
  skip_until: "snoozed by the operator",
  switch_unreadable: "settings unreadable (failed safe)",
};

const englishReason = (code) => REASON_ENGLISH[code] || String(code || "unknown reason").replace(/_/g, " ");

// expectedDates: scheduled fire dates, ASCENDING. entriesByDate: { date: {outcome, reason} }
// outcome ∈ "ran" | "skip" | "crash"; a MISSING key means the job fired and wrote nothing.
function evaluateRailLiveness({ rail, expectedDates, entriesByDate, thresholds = THRESHOLDS_V1 }) {
  const dates = [...(expectedDates || [])];
  const entries = entriesByDate || {};
  const base = { rail, alert: false, kind: null, streak: 0, silentFires: 0, reasons: {}, thresholds: thresholds.version };
  if (dates.length === 0) return base;

  // Count backwards from the most recent scheduled fire.
  let silentFires = 0;
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    if (entries[dates[i]] === undefined) silentFires += 1;
    else break;
  }

  let streak = 0;
  const reasons = {};
  let trailingCrash = 0;
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const e = entries[dates[i]];
    if (e === undefined) continue;            // silence handled above; keep scanning past it
    if (e.outcome === "skip") {
      streak += 1;
      const r = e.reason || "unknown";
      reasons[r] = (reasons[r] || 0) + 1;
      continue;
    }
    if (e.outcome === "crash") { trailingCrash += 1; break; }
    break;                                     // a real run breaks the streak
  }

  // Priority: silence > an explicit crash > a skip streak. Silence is worst because it is the
  // one state that carries no information about itself.
  if (silentFires >= thresholds.silentFiresN) {
    return { ...base, alert: true, kind: "crash_suspect", streak, silentFires, reasons };
  }
  if (trailingCrash > 0) {
    return { ...base, alert: true, kind: "crashed", streak, silentFires, reasons };
  }
  if (streak >= thresholds.skipStreakN) {
    return { ...base, alert: true, kind: "skip_streak", streak, silentFires, reasons };
  }
  return { ...base, streak, silentFires, reasons };
}

function formatLivenessLine(result) {
  if (!result || !result.alert) return null;
  const { rail, kind, streak, silentFires, reasons } = result;

  if (kind === "crash_suspect") {
    return `🔴 ${rail}: the last ${silentFires} scheduled runs left NO record at all — the job is probably failing before it can report. Worth a look.`;
  }
  if (kind === "crashed") {
    return `🔴 ${rail}: crashed on its last run and said so. The error is in the ledger.`;
  }
  const breakdown = Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${n}× ${englishReason(code)}`)
    .join(", ");
  return `🟠 ${rail}: hasn't actually measured anything in ${streak} nights — ${breakdown}. Nothing is broken; it keeps standing aside.`;
}

module.exports = { THRESHOLDS_V1, evaluateRailLiveness, formatLivenessLine, englishReason };
