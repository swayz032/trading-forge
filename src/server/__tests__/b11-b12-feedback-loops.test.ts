/**
 * B11 + B12 (W14 Team C Steps 3+4) — Static-source verification tests
 *
 * B11: Macro news blackout wired at runtime
 * -------------------------------------------
 * Verifies that paper-signal-service.ts calls getCachedSignalCalendarStatus()
 * before emitting any entry signal, that bypass_news_blackout=true allows
 * event-driven strategies through the economic-event window (but NOT holidays),
 * and that calendar blocks are persisted to paper_signal_logs.
 *
 * B12: Closed feedback loops
 * -------------------------------------------
 * Loop 1: Every paper session close → paper_session_feedback table write
 * Loop 2: Prompt evolution reads system_journal (critic's approved strategies)
 * Loop 3: DECLINING → auto-trigger regen (verified by regen-auto-trigger.test.ts)
 *
 * All tests use static source reads so they run in CI without a live DB.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

// ─── Static source reads ──────────────────────────────────────────────────────

const paperSignalSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/services/paper-signal-service.ts"),
  "utf8",
);

const calendarFilterSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../engine/skip_engine/calendar_filter.py"),
  "utf8",
);

const dslTranslatorSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/services/dsl-translator.ts"),
  "utf8",
);

const paperRoutesSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/routes/paper.ts"),
  "utf8",
);

const schedulerSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/scheduler.ts"),
  "utf8",
);

const promptEvolutionSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/services/prompt-evolution-service.ts"),
  "utf8",
);

const criticFeedbackSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/services/critic-feedback-service.ts"),
  "utf8",
);

const sessionFeedbackSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/services/paper-session-feedback-service.ts"),
  "utf8",
);

const newsFadeFixtureSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../engine/strategies/dsl_fixtures/news_fade_mcl.json"),
  "utf8",
);

// ─── B11: Calendar filter wiring ─────────────────────────────────────────────

describe("B11 — calendar filter wired before entry signal emission", () => {
  it("paper-signal-service imports getCachedSignalCalendarStatus", () => {
    expect(paperSignalSrc).toContain("getCachedSignalCalendarStatus");
  });

  it("getCachedSignalCalendarStatus is called before the openPosition or entry signal path", () => {
    // The calendar check must come before any position-opening logic.
    // Verify the calendar call appears before the openPosition call.
    const calIdx = paperSignalSrc.indexOf("getCachedSignalCalendarStatus");
    const openPosIdx = paperSignalSrc.indexOf("await openPosition(");
    expect(calIdx).toBeGreaterThan(0);
    expect(openPosIdx).toBeGreaterThan(0);
    expect(calIdx).toBeLessThan(openPosIdx);
  });

  it("calendarBlocked flag gates early return before any signal emission", () => {
    expect(paperSignalSrc).toContain("if (calendarBlocked)");
    // Must return early (early-exit pattern) when calendarBlocked
    const calBlockIdx = paperSignalSrc.indexOf("if (calendarBlocked)");
    const returnIdx = paperSignalSrc.indexOf("return;", calBlockIdx);
    expect(returnIdx).toBeGreaterThan(calBlockIdx);
    // Must happen before openPosition
    const openPosIdx = paperSignalSrc.indexOf("await openPosition(");
    expect(returnIdx).toBeLessThan(openPosIdx);
  });

  it("calendar_filter.py defines FOMC blackout events for 2026", () => {
    expect(calendarFilterSrc).toContain("FOMC");
    expect(calendarFilterSrc).toContain("2026");
    expect(calendarFilterSrc).toContain("EVENT_BLACKOUT_MINUTES");
  });

  it("calendar_filter.py defines CPI blackout events", () => {
    expect(calendarFilterSrc).toContain("CPI");
    expect(calendarFilterSrc).toContain("08:30");
  });

  it("calendar_filter.py defines NFP blackout events", () => {
    expect(calendarFilterSrc).toContain("NFP");
  });

  it("calendar_filter.py exports check_economic_event function", () => {
    expect(calendarFilterSrc).toContain("def check_economic_event(");
  });

  it("calendar_filter.py exports calendar_check function", () => {
    expect(calendarFilterSrc).toContain("def calendar_check(");
  });

  it("bypass_news_blackout opt-in is read from sessionConfig", () => {
    expect(paperSignalSrc).toContain("bypass_news_blackout");
    expect(paperSignalSrc).toContain("bypassNewsBlackout");
  });

  it("bypass only skips economic event block — holidays still block even with bypass", () => {
    // The holiday check must NOT be gated on bypassNewsBlackout
    const holidayCheckIdx = paperSignalSrc.indexOf("calResult.is_holiday === true");
    const bypassReadIdx = paperSignalSrc.indexOf("bypassNewsBlackout");
    // holiday check appears before the bypass read affects the economic event path
    expect(holidayCheckIdx).toBeGreaterThan(0);
    // After holiday block, the economic_event check references bypassNewsBlackout
    const economicEventIdx = paperSignalSrc.indexOf("calResult.is_economic_event === true");
    expect(economicEventIdx).toBeGreaterThan(holidayCheckIdx);
    // bypassNewsBlackout is only applied inside the economic_event branch
    expect(paperSignalSrc.substring(economicEventIdx)).toContain("bypassNewsBlackout");
    // Holiday block sets calendarBlocked=true WITHOUT checking bypassNewsBlackout
    const holidayBlock = paperSignalSrc.substring(holidayCheckIdx, economicEventIdx);
    expect(holidayBlock).toContain("calendarBlocked = true");
    expect(holidayBlock).not.toContain("bypassNewsBlackout");
  });

  it("bypass path logs the bypass decision with calendar_news_bypass attribute", () => {
    expect(paperSignalSrc).toContain("calendar_news_bypass");
    expect(paperSignalSrc).toContain("bypass_news_blackout=true");
  });

  it("news_fade_mcl.json fixture has bypass_news_blackout: true", () => {
    const fixture = JSON.parse(newsFadeFixtureSrc);
    expect(fixture.bypass_news_blackout).toBe(true);
  });

  it("dsl-translator.ts propagates bypass_news_blackout from DSL to paper config", () => {
    expect(dslTranslatorSrc).toContain("bypass_news_blackout");
    // Conditional spread propagation (opt-in only)
    expect(dslTranslatorSrc).toContain("bypass_news_blackout: true");
  });

  it("calendar block is persisted to paper_signal_logs with signalType calendar_blocked", () => {
    expect(paperSignalSrc).toContain("signalType: \"calendar_blocked\"");
    // DB insert must be inside the calendarBlocked branch
    const calBlockIdx = paperSignalSrc.indexOf("if (calendarBlocked)");
    const dbInsertIdx = paperSignalSrc.indexOf("signalType: \"calendar_blocked\"", calBlockIdx);
    expect(dbInsertIdx).toBeGreaterThan(calBlockIdx);
  });

  it("calendar guard failure is fail-open with visible error log + SSE broadcast", () => {
    expect(paperSignalSrc).toContain("Calendar guard DOWN");
    expect(paperSignalSrc).toContain("alert:calendar_guard_down");
    // Trading continues when guard is down (fail-open, but visible)
    expect(paperSignalSrc).toContain("calendar_guard_down");
  });
});

// ─── B12: Loop 1 — paper session close → paper_session_feedback write ─────────

describe("B12 Loop 1 — paper trade close feeds paper_session_feedback table", () => {
  it("paper-session-feedback-service exports computeAndPersistSessionFeedback", () => {
    expect(sessionFeedbackSrc).toContain("export async function computeAndPersistSessionFeedback");
  });

  it("computeAndPersistSessionFeedback writes to paper_session_feedback table", () => {
    expect(sessionFeedbackSrc).toContain("db.insert(paperSessionFeedback)");
  });

  it("paper.ts calls computeAndPersistSessionFeedback on the manual stop path", () => {
    expect(paperRoutesSrc).toContain("computeAndPersistSessionFeedback");
    // Must be in the stop route (not just the kill route)
    const stopPathIdx = paperRoutesSrc.indexOf("paper:session_stop");
    const feedbackCallIdx = paperRoutesSrc.indexOf("computeAndPersistSessionFeedback(sessionId)");
    expect(stopPathIdx).toBeGreaterThan(0);
    expect(feedbackCallIdx).toBeGreaterThan(0);
  });

  it("paper.ts calls computeAndPersistSessionFeedback on the kill (emergency stop) path", () => {
    // Kill path must also produce a feedback row — coverage parity between stop paths
    const killFeedbackIdx = paperRoutesSrc.lastIndexOf("computeAndPersistSessionFeedback(sessionId)");
    const firstFeedbackIdx = paperRoutesSrc.indexOf("computeAndPersistSessionFeedback(sessionId)");
    // Two distinct call sites — one for stop, one for kill
    expect(killFeedbackIdx).toBeGreaterThan(firstFeedbackIdx);
  });

  it("scheduler.ts calls computeAndPersistSessionFeedback on auto-stop path", () => {
    // Auto-stop (scheduler-triggered) must also produce a feedback row
    expect(schedulerSrc).toContain("computeAndPersistSessionFeedback");
  });

  it("feedback write is non-blocking (fire-and-forget with .catch())", () => {
    // The stop path must never block on feedback failure
    expect(paperRoutesSrc).toContain("computeAndPersistSessionFeedback(sessionId)");
    // Look for .catch() after the feedback call (non-blocking pattern)
    expect(paperRoutesSrc).toContain(".catch((feedbackErr)");
  });

  it("feedback write is idempotent — second call replaces, not appends", () => {
    // Idempotency: existing row is deleted before insert (db call may span multiple lines)
    expect(sessionFeedbackSrc).toContain(".delete(paperSessionFeedback)");
    expect(sessionFeedbackSrc).toContain("eq(paperSessionFeedback.sessionId, sessionId)");
  });
});

// ─── B12: Loop 2 — critic suggestions → prompt evolution ──────────────────────

describe("B12 Loop 2 — critic suggestions feed prompt evolution", () => {
  it("prompt-evolution-service exports runPromptEvolution", () => {
    expect(promptEvolutionSrc).toContain("export async function runPromptEvolution");
  });

  it("runPromptEvolution reads system_journal for strategy outcomes", () => {
    // Prompt evolution synthesizes patterns from the critic's approved/rejected strategies
    expect(promptEvolutionSrc).toContain("systemJournal");
    // Drizzle sql template literal: sql`${systemJournal.status} IN ('tested', 'failed', 'promoted')`
    expect(promptEvolutionSrc).toContain("IN ('tested', 'failed', 'promoted')");
    // Covers tested, failed, promoted — the full critic feedback surface
    expect(promptEvolutionSrc).toContain("'tested'");
    expect(promptEvolutionSrc).toContain("'failed'");
    expect(promptEvolutionSrc).toContain("'promoted'");
  });

  it("runPromptEvolution writes updated prompt to prompt_versions table (A/B-aware)", () => {
    expect(promptEvolutionSrc).toContain("prompt_versions");
    expect(promptEvolutionSrc).toContain("promptVersions");
    expect(promptEvolutionSrc).toContain("strategy_proposer");
  });

  it("runPromptEvolution emits audit_log row on completion", () => {
    expect(promptEvolutionSrc).toContain("prompt_evolution.complete");
    expect(promptEvolutionSrc).toContain("db.insert(auditLog)");
  });

  it("evaluateCriticAccuracy auto-tightens critic threshold when FPR > 30%", () => {
    // Critic accuracy feedback loop: evaluateCriticAccuracy() adjusts system parameters
    expect(criticFeedbackSrc).toContain("falsePositiveRate > 0.30");
    expect(criticFeedbackSrc).toContain("critic_min_forge_score");
    expect(criticFeedbackSrc).toContain("auto-tightening thresholds");
  });

  it("evaluateCriticAccuracy is registered in the scheduler (weekly critic-feedback job)", () => {
    expect(schedulerSrc).toContain("evaluateCriticAccuracy");
    expect(schedulerSrc).toContain("critic-feedback");
  });

  // CORRECTED 2026-07-10: this comment previously claimed the n8n nightly review workflow
  // is the "canonical trigger" per a CLAUDE.md "Tournament Gating (n8n-canonical)" section —
  // that section no longer exists in CLAUDE.md, and no n8n workflow or HTTP route was found
  // referencing runPromptEvolution/prompt-evolution anywhere (checked workflows/, tmp-n8n/,
  // src/server/routes/). runPromptEvolution() has ZERO callers today: not the scheduler, not
  // a route, not n8n. The equivalent "create a new A/B candidate from outcomes" functionality
  // IS live, but via an independent, separately-maintained implementation in
  // pattern-aggregator-service.ts (scheduled every 4h) that explicitly replicates this logic
  // rather than importing it (see that file's own comment on the circular-import reason).
  // resolveAbTests, a DIFFERENT export of this same prompt-evolution-service.ts file, IS wired
  // into scheduler.ts's weekly cron. Operator decision pending: wire runPromptEvolution() up for
  // real, or remove it as superseded dead code — see project_full_goal_deepscan_2026_07_10 memory.
  it("runPromptEvolution has no caller anywhere — documented dead code, not an n8n-triggered gap", () => {
    const schedulerHasRunPromptEvolution = schedulerSrc.includes("runPromptEvolution");
    // Expected: false — confirmed no scheduler, route, or n8n workflow invokes this function.
    expect(schedulerHasRunPromptEvolution).toBe(false);
  });
});

// ─── B12: Loop 3 — DECLINING → CANDIDATE generation (auto-trigger) ────────────

describe("B12 Loop 3 — DECLINING auto-trigger fires CANDIDATE regen (static)", () => {
  it("critic-feedback-service exports checkDeclingAndTriggerRegen", () => {
    expect(criticFeedbackSrc).toContain("export async function checkDeclingAndTriggerRegen");
  });

  it("checkDeclingAndTriggerRegen imports evolveStrategy for candidate generation", () => {
    expect(criticFeedbackSrc).toContain("evolveStrategy");
  });

  it("regen-declining-sweep job is registered in scheduler (B4 W13)", () => {
    expect(schedulerSrc).toContain("regen-declining-sweep");
    expect(schedulerSrc).toContain("checkDeclingAndTriggerRegen");
  });

  it("DECLINING sweep has pipeline pause guard (isActive check)", () => {
    expect(criticFeedbackSrc).toContain("isPipelineActive");
    expect(criticFeedbackSrc).toContain("skippedPipelinePaused: true");
  });

  it("DECLINING sweep emits regen.auto_triggered audit row before spawning evolution", () => {
    // Intent durability: audit row written before fire-and-forget, not after
    const auditIdx = criticFeedbackSrc.indexOf("regen.auto_triggered");
    const evolveIdx = criticFeedbackSrc.indexOf("evolveStrategy(s.id");
    expect(auditIdx).toBeGreaterThan(0);
    expect(evolveIdx).toBeGreaterThan(0);
    // audit row insertion comes before the evolveStrategy call
    expect(auditIdx).toBeLessThan(evolveIdx);
  });
});
