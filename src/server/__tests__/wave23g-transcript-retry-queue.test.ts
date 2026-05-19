/**
 * wave23g-transcript-retry-queue.test.ts — W23G.4 Transcript Fetch Retry Queue
 *
 * Tests fetchTranscriptWithRetry in isolation.
 * All tests use:
 *   - vi.mock("youtube-transcript") so no real HTTP calls are made
 *   - sleepFn = async () => {} to avoid real waits
 *   - performance.now() / Date.now() checks for elapsed time guardrails
 *
 * Coverage:
 *   1. First attempt 200 + content → 1 attempt, captioned_succeeded
 *   2. First attempt 429 then second 200 → 2 attempts, auto_recovered
 *   3. 3× 429 → all_failed, attempts.length = 3, sleepFn called 2 times
 *   4. Timeout exception then success → auto_recovered
 *   5. Total elapsed time ≤ sum of delays + tolerance (with injected sleepFn = no-op)
 *   6. lang:"en" fails, no-lang succeeds → captioned_failed (then auto_recovered on retry path)
 *   7. "Disabled" / no-captions error → immediate all_failed (no retries, sleepFn not called)
 *   8. maxAttempts=1 option → only 1 attempt even if it fails
 *   9. Empty segments returned → treated as failure, retries
 *  10. Short transcript (< 200 chars) → treated as failure, retries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchTranscriptWithRetry, type TranscriptFetchResult } from "../services/transcript-fetch-queue.js";

// ─── Mock youtube-transcript ──────────────────────────────────────────────────
// This mock intercepts `import("youtube-transcript")` inside fetchTranscriptWithRetry.
// Each test sets up YoutubeTranscript.fetchTranscript behaviour via vi.mocked().

vi.mock("youtube-transcript", () => ({
  YoutubeTranscript: {
    fetchTranscript: vi.fn(),
  },
}));

// ─── Mock the logger (imported from ../index.js inside transcript-fetch-queue) ──
vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** No-sleep function — injects as sleepFn so tests don't wait real delays. */
const noSleep = vi.fn().mockResolvedValue(undefined);

/** Make a realistic transcript segments array (>200 chars when joined). */
function makeSegments(text = "This is a detailed tutorial about the 9 EMA crossing the 21 EMA on a 5 minute chart for MES futures. Entry on the pullback after the first cross. Stop below the prior swing low. Target at 1.5 times ATR.") {
  return [{ text }];
}

// ─── Import mocked module ─────────────────────────────────────────────────────
// We need a reference to the mock fn to set return values per test.
// Use a lazy import inside tests to pick up the mock after vi.mock runs.
async function getYoutubeTranscriptMock() {
  const mod = await import("youtube-transcript");
  return vi.mocked(mod.YoutubeTranscript.fetchTranscript);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("fetchTranscriptWithRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noSleep.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Test 1: success on first attempt ──────────────────────────────────────

  it("test 1: first attempt succeeds with English captions → 1 attempt, captioned_succeeded", async () => {
    const mock = await getYoutubeTranscriptMock();
    mock.mockResolvedValueOnce(makeSegments());

    const result = await fetchTranscriptWithRetry("abc123", { sleepFn: noSleep });

    expect(result.transcript).toBeTruthy();
    expect(result.transcript!.length).toBeGreaterThan(200);
    expect(result.finalOutcome).toBe("captioned_succeeded");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].attemptNumber).toBe(1);
    expect(result.attempts[0].outcome).toBe("captioned_succeeded");
    expect(result.attempts[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(result.attempts[0].errorMessage).toBeUndefined();
    // Sleep should not be called (no retry needed)
    expect(noSleep).not.toHaveBeenCalled();
  });

  // ── Test 2: 429 then success → auto_recovered ─────────────────────────────

  it("test 2: first attempt 429 then second attempt 200 → 2 attempts, auto_recovered", async () => {
    const mock = await getYoutubeTranscriptMock();
    const err429 = new Error("429 Too Many Requests");
    mock
      .mockRejectedValueOnce(err429)   // attempt 1: 429
      .mockResolvedValueOnce(makeSegments()); // attempt 2: success

    const result = await fetchTranscriptWithRetry("abc123", { sleepFn: noSleep });

    expect(result.transcript).toBeTruthy();
    expect(result.finalOutcome).toBe("auto_recovered");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].attemptNumber).toBe(1);
    expect(result.attempts[0].outcome).toBe("all_failed");  // attempt 1 failed
    expect(result.attempts[0].errorMessage).toContain("429");
    expect(result.attempts[1].attemptNumber).toBe(2);
    expect(result.attempts[1].outcome).toBe("auto_recovered");  // recovered on attempt 2
    // Sleep called exactly once (between attempt 1 and 2)
    expect(noSleep).toHaveBeenCalledTimes(1);
  });

  // ── Test 3: 3× 429 → all_failed, sleep called 2 times ───────────────────

  it("test 3: 3× 429 → all_failed, attempts.length=3, sleepFn called 2 times", async () => {
    const mock = await getYoutubeTranscriptMock();
    const err429 = new Error("429 Too Many Requests");
    mock.mockRejectedValue(err429);

    const result = await fetchTranscriptWithRetry("abc123", { sleepFn: noSleep, maxAttempts: 3 });

    expect(result.transcript).toBeNull();
    expect(result.finalOutcome).toBe("all_failed");
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts[0].attemptNumber).toBe(1);
    expect(result.attempts[1].attemptNumber).toBe(2);
    expect(result.attempts[2].attemptNumber).toBe(3);
    for (const a of result.attempts) {
      expect(a.outcome).toBe("all_failed");
      expect(a.errorMessage).toContain("429");
    }
    // Sleep called between attempt 1→2 and 2→3 (NOT after the final attempt)
    expect(noSleep).toHaveBeenCalledTimes(2);
  });

  // ── Test 4: timeout then success → auto_recovered ────────────────────────

  it("test 4: timeout exception then success → auto_recovered", async () => {
    const mock = await getYoutubeTranscriptMock();
    const timeoutErr = new Error("Request timed out after 30s");
    mock
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce(makeSegments());

    const result = await fetchTranscriptWithRetry("abc123", { sleepFn: noSleep });

    expect(result.transcript).toBeTruthy();
    expect(result.finalOutcome).toBe("auto_recovered");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].errorMessage).toContain("timed out");
    expect(result.attempts[1].outcome).toBe("auto_recovered");
    expect(noSleep).toHaveBeenCalledTimes(1);
  });

  // ── Test 5: total elapsed time guardrail ─────────────────────────────────

  it("test 5: with no-sleep injected, total elapsed < base delays sum", async () => {
    const mock = await getYoutubeTranscriptMock();
    const err429 = new Error("429");
    mock
      .mockRejectedValueOnce(err429)
      .mockRejectedValueOnce(err429)
      .mockResolvedValueOnce(makeSegments());

    const baseDelays = [100, 200, 500]; // much shorter than production for timing test
    const t0 = Date.now();

    const result = await fetchTranscriptWithRetry("abc123", {
      sleepFn: noSleep,  // zero sleep
      baseDelaysMs: baseDelays,
      maxAttempts: 3,
    });

    const elapsed = Date.now() - t0;
    expect(result.transcript).toBeTruthy();
    expect(result.finalOutcome).toBe("auto_recovered");
    // With sleepFn = no-op, total time should be tiny (API calls are mocked, no I/O)
    // Generous bound: 500ms for mocked calls overhead
    expect(elapsed).toBeLessThan(500);
  });

  // ── Test 6: lang:"en" fails, no-lang fallback succeeds → captioned_failed ─

  it("test 6: lang:en fails, no-lang auto-captions succeeds → captioned_failed outcome", async () => {
    const mock = await getYoutubeTranscriptMock();
    // First call (lang:"en") throws; second call (no-lang) succeeds
    mock
      .mockRejectedValueOnce(new Error("Could not find English captions"))
      .mockResolvedValueOnce(makeSegments());

    const result = await fetchTranscriptWithRetry("abc123", { sleepFn: noSleep });

    expect(result.transcript).toBeTruthy();
    // captioned_failed = lang:"en" failed but no-lang succeeded on same attempt
    expect(result.finalOutcome).toBe("captioned_failed");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].outcome).toBe("captioned_failed");
    // No sleep — this was a within-attempt fallback, not a retry
    expect(noSleep).not.toHaveBeenCalled();
  });

  // ── Test 7: "disabled" error → immediate all_failed, no retries ──────────

  it("test 7: transcript disabled on video → immediate all_failed, sleepFn NOT called", async () => {
    const mock = await getYoutubeTranscriptMock();
    // youtube-transcript npm throws this for videos with transcripts disabled
    mock.mockRejectedValue(new Error("Transcript is disabled on this video"));

    const result = await fetchTranscriptWithRetry("abc123", { sleepFn: noSleep, maxAttempts: 3 });

    expect(result.transcript).toBeNull();
    expect(result.finalOutcome).toBe("all_failed");
    // Only 1 attempt — "disabled" is a terminal error, not a transient one
    expect(result.attempts).toHaveLength(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  // ── Test 8: maxAttempts=1 option respected ────────────────────────────────

  it("test 8: maxAttempts=1 → only 1 attempt even on transient error", async () => {
    const mock = await getYoutubeTranscriptMock();
    mock.mockRejectedValue(new Error("429 Too Many Requests"));

    const result = await fetchTranscriptWithRetry("abc123", { sleepFn: noSleep, maxAttempts: 1 });

    expect(result.transcript).toBeNull();
    expect(result.finalOutcome).toBe("all_failed");
    expect(result.attempts).toHaveLength(1);
    expect(noSleep).not.toHaveBeenCalled(); // no retry → no sleep
  });

  // ── Test 9: empty segments → treated as failure, retries ─────────────────

  it("test 9: empty segments array → treated as failure, retried, succeeds on attempt 2", async () => {
    const mock = await getYoutubeTranscriptMock();
    mock
      .mockResolvedValueOnce([])         // attempt 1: empty segments
      .mockResolvedValueOnce(makeSegments()); // attempt 2: good content

    const result = await fetchTranscriptWithRetry("abc123", { sleepFn: noSleep });

    expect(result.transcript).toBeTruthy();
    expect(result.finalOutcome).toBe("auto_recovered");
    expect(result.attempts).toHaveLength(2);
  });

  // ── Test 10: short transcript → treated as failure, retries ─────────────

  it("test 10: transcript < 200 chars → treated as failure, retried", async () => {
    const mock = await getYoutubeTranscriptMock();
    const shortSegments = [{ text: "Buy the dip." }]; // < 200 chars
    mock
      .mockResolvedValueOnce(shortSegments)
      .mockResolvedValueOnce(makeSegments());

    const result = await fetchTranscriptWithRetry("abc123", { sleepFn: noSleep });

    expect(result.transcript).toBeTruthy();
    expect(result.finalOutcome).toBe("auto_recovered");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].errorMessage).toContain("too short");
  });

  // ── Test 11: video ID extracted from full URL by caller ───────────────────

  it("test 11: videoId is passed directly (not URL) — no extraction needed", async () => {
    const mock = await getYoutubeTranscriptMock();
    mock.mockResolvedValueOnce(makeSegments());

    const result = await fetchTranscriptWithRetry("dQw4w9WgXcQ", { sleepFn: noSleep });

    expect(result.transcript).toBeTruthy();
    expect(result.finalOutcome).toBe("captioned_succeeded");
    // youtube-transcript received the bare video ID
    expect(mock).toHaveBeenCalledWith("dQw4w9WgXcQ", { lang: "en" });
  });

  // ── Test 12: attempts array contains videoId on every attempt ────────────

  it("test 12: every attempt record contains the videoId", async () => {
    const mock = await getYoutubeTranscriptMock();
    const err = new Error("429");
    mock.mockRejectedValue(err);

    const result = await fetchTranscriptWithRetry("myVideoId999", { sleepFn: noSleep });

    for (const attempt of result.attempts) {
      expect(attempt.videoId).toBe("myVideoId999");
    }
  });

  // ── Test 13: durationMs is plausible on every attempt ────────────────────

  it("test 13: every attempt has durationMs >= 0", async () => {
    const mock = await getYoutubeTranscriptMock();
    mock.mockResolvedValueOnce(makeSegments());

    const result = await fetchTranscriptWithRetry("abc123", { sleepFn: noSleep });

    for (const attempt of result.attempts) {
      expect(attempt.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  // ── Test 14: ECONNRESET is treated as transient ───────────────────────────

  it("test 14: ECONNRESET error triggers retry", async () => {
    const mock = await getYoutubeTranscriptMock();
    const connErr = new Error("ECONNRESET: connection was forcibly closed");
    mock
      .mockRejectedValueOnce(connErr)
      .mockResolvedValueOnce(makeSegments());

    const result = await fetchTranscriptWithRetry("abc123", { sleepFn: noSleep });

    expect(result.finalOutcome).toBe("auto_recovered");
    expect(noSleep).toHaveBeenCalledTimes(1);
  });
});
