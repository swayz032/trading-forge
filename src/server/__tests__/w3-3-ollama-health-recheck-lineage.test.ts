/**
 * W3.3 — Local-first extraction hardening + lineage
 *
 * Three test groups:
 *
 * A. recheckOllamaHealth: flips stuck OLLAMA_HEALTHY false→true after a
 *    successful 2-phase probe; keeps it false on Phase 1 or Phase 2 failure.
 *
 * B. emitLocalLlmDownSignal (fail-loud path): when OLLAMA_HEALTHY is false AND
 *    cloud also fails, the system emits extraction.local_llm_down audit event
 *    AND quarantines the extraction — never silently drops to null without a signal.
 *
 * C. Extraction lineage key: the composite key (video_id:transcript_hash:extractor_version)
 *    is stable for the same video+transcript+version and differs for different inputs.
 *
 * All tests: no DB, no network, no real LLM — pure mocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "crypto";

// ─── Logger mocks (prevent real logger bootstrap) ──────────────────────────────
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── DB mock (fire-and-forget audit inserts must not throw) ───────────────────
const mockDbInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
vi.mock("../db/index.js", () => ({ db: { insert: (...args: unknown[]) => mockDbInsert(...args) } }));
vi.mock("../db/schema.js", () => ({ auditLog: "auditLog", needsArchetypeQueue: "needsArchetypeQueue" }));

// ─── Notification service mock ─────────────────────────────────────────────────
const mockNotifyCritical = vi.fn();
const mockNotifyWarning = vi.fn();
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: (...args: unknown[]) => mockNotifyCritical(...args),
  notifyWarning: (...args: unknown[]) => mockNotifyWarning(...args),
}));

// ─── Quarantine extraction mock ────────────────────────────────────────────────
const mockQuarantineExtraction = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/quarantine-extraction.js", () => ({
  quarantineExtraction: (...args: unknown[]) => mockQuarantineExtraction(...args),
}));

// ─── Ollama client mock ────────────────────────────────────────────────────────
vi.mock("../services/ollama-client.js", () => ({
  OllamaClient: class {
    chat = vi.fn();
    generate = vi.fn();
  },
}));

// ─── fetch mock — controlled per test ─────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── model-router imports (after mocks are installed) ─────────────────────────
import {
  recheckOllamaHealth,
  __setOllamaHealthyForTests,
  __getOllamaHealthyForTests,
  callScoutExtractLlm,
} from "../services/model-router.js";

// ──────────────────────────────────────────────────────────────────────────────
// Group A: recheckOllamaHealth — runtime OLLAMA_HEALTHY reset
// ──────────────────────────────────────────────────────────────────────────────

describe("recheckOllamaHealth — Group A", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Start with OLLAMA_HEALTHY = false (the stuck-false scenario)
    __setOllamaHealthyForTests(false);
  });

  afterEach(() => {
    // Reset to true so other tests in the suite start clean
    __setOllamaHealthyForTests(true);
  });

  it("A1: stuck false→true after successful 2-phase probe", async () => {
    // Phase 1: /api/tags returns model present
    // Phase 2: /api/generate returns success
    const targetModel = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e2b";
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: targetModel }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: '{"ok":true}' }),
      });

    expect(__getOllamaHealthyForTests()).toBe(false); // starts stuck false

    const result = await recheckOllamaHealth();

    expect(result.healthy).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(__getOllamaHealthyForTests()).toBe(true); // flipped to true
  });

  it("A2: stays false when Phase 1 /api/tags fails (non-OK status)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });

    const result = await recheckOllamaHealth();

    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/tags_non_ok/);
    expect(__getOllamaHealthyForTests()).toBe(false);
  });

  it("A3: stays false when model not found in tags list", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "llama3:8b" }] }), // gemma4 absent
    });

    const result = await recheckOllamaHealth();

    expect(result.healthy).toBe(false);
    expect(result.reason).toBe("model_not_in_tags");
    expect(__getOllamaHealthyForTests()).toBe(false);
  });

  it("A4: stays false when Phase 2 test-inference probe returns error", async () => {
    const targetModel = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e2b";
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: targetModel }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "model_load_failed" }),
      });

    const result = await recheckOllamaHealth();

    expect(result.healthy).toBe(false);
    expect(result.reason).toBeDefined();
    expect(__getOllamaHealthyForTests()).toBe(false);
  });

  it("A5: stays false when fetch throws (connection refused)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED 11434"));

    const result = await recheckOllamaHealth();

    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/ECONNREFUSED/);
    expect(__getOllamaHealthyForTests()).toBe(false);
  });

  it("A6: model name with prefix match counts (e.g. gemma4:e2b registered as gemma4)", async () => {
    // Ollama sometimes returns just the base name "gemma4" in tags; startsWith check covers it
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "gemma4" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: '{"ok":true}' }),
      });

    __setOllamaHealthyForTests(false);
    const result = await recheckOllamaHealth();

    expect(result.healthy).toBe(true);
    expect(__getOllamaHealthyForTests()).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Group B: Fail-loud → quarantine (NOT silent null)
// ──────────────────────────────────────────────────────────────────────────────

describe("callScoutExtractLlm fail-loud path — Group B", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Simulate stuck-false Ollama state (the triggering condition)
    __setOllamaHealthyForTests(false);
  });

  afterEach(() => {
    __setOllamaHealthyForTests(true);
  });

  const youtubeUrl = "https://www.youtube.com/watch?v=TestVideoID1";
  const messages = [
    {
      role: "user" as const,
      content: JSON.stringify({
        youtube_url: youtubeUrl,
        title: "Test Strategy Video",
        channel: "TestChannel",
        transcript_text: "Sample transcript about ICT order blocks",
      }),
    },
  ];

  it("B1: OLLAMA_HEALTHY=false + cloud exhausted → audit event emitted (not silent null)", async () => {
    // Cloud retry path: callFn returns null (simulating cloud unavailability / exhausted)
    // withScoutExtractRetry will call callFn 3 times (all null → exhausted path).
    const cloudCallFn = vi.fn().mockResolvedValue(null);

    // Inject a no-op sleepFn so test doesn't wait real time
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const result = await callScoutExtractLlm(messages, undefined, cloudCallFn, sleepFn);

    // Must return null (extraction failed) but NOT silently
    expect(result).toBeNull();

    // Allow fire-and-forget async signals to flush
    await new Promise((r) => setTimeout(r, 20));

    // The fail-loud audit event MUST have been attempted via db.insert
    // The emitLocalLlmDownSignal function calls db.insert("auditLog") then .values(...)
    const allInsertCalls = mockDbInsert.mock.calls;
    // mockDbInsert is called with the auditLog mock value ("auditLog" string from vi.mock)
    const auditInserts = allInsertCalls.filter((call) => call[0] === "auditLog");
    // At least one insert should be the local_llm_down event (plus any writeTranscriptExtractorAudit calls)
    expect(auditInserts.length).toBeGreaterThan(0);
  });

  it("B2: OLLAMA_HEALTHY=false + cloud exhausted → quarantine is called (not silent drop)", async () => {
    const cloudCallFn = vi.fn().mockResolvedValue(null);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await callScoutExtractLlm(messages, undefined, cloudCallFn, sleepFn);

    // quarantineExtraction must have been called — extraction is not silently dropped
    // Note: it's fire-and-forget so we need to flush microtasks
    await new Promise((r) => setTimeout(r, 10));

    expect(mockQuarantineExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining("ollama_unhealthy"),
        missing: expect.arrayContaining(["local_llm_unavailable"]),
      }),
    );
  });

  it("B3: OLLAMA_HEALTHY=false + cloud exhausted → Discord critical alert fired", async () => {
    const cloudCallFn = vi.fn().mockResolvedValue(null);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await callScoutExtractLlm(messages, undefined, cloudCallFn, sleepFn);
    await new Promise((r) => setTimeout(r, 10));

    expect(mockNotifyCritical).toHaveBeenCalledWith(
      expect.stringContaining("EXTRACTION LOST"),
      expect.stringContaining("ollama_unhealthy"),
      expect.any(Object),
    );
  });

  it("B4: source_url extracted from message payload and included in quarantine opts", async () => {
    const cloudCallFn = vi.fn().mockResolvedValue(null);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await callScoutExtractLlm(messages, undefined, cloudCallFn, sleepFn);
    await new Promise((r) => setTimeout(r, 10));

    expect(mockQuarantineExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        source_url: youtubeUrl,
      }),
    );
  });

  it("B5: FORCE_CLOUD=true path does NOT emit fail-loud (force-cloud is intentional routing)", async () => {
    // When FORCE_CLOUD is explicitly set, the operator is intentionally bypassing Ollama.
    // That is not the "stuck unhealthy" scenario and must not emit spurious alerts.
    process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD = "true";
    const cloudCallFn = vi.fn().mockResolvedValue(null);
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    try {
      await callScoutExtractLlm(messages, undefined, cloudCallFn, sleepFn);
      await new Promise((r) => setTimeout(r, 10));
      // In force-cloud path, quarantine should NOT be called (it's not an LLM-down event)
      expect(mockQuarantineExtraction).not.toHaveBeenCalled();
    } finally {
      delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;
    }
  });

  it("B6: cloud success path — no fail-loud signal emitted", async () => {
    // When cloud succeeds, we must NOT emit fail-loud signals
    const cloudCallFn = vi.fn().mockResolvedValue('{"strategies":[]}');
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const result = await callScoutExtractLlm(messages, undefined, cloudCallFn, sleepFn);
    await new Promise((r) => setTimeout(r, 10));

    expect(result).toBe('{"strategies":[]}');
    expect(mockQuarantineExtraction).not.toHaveBeenCalled();
    expect(mockNotifyCritical).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Group C: Extraction lineage key — stable + differentiating
// ──────────────────────────────────────────────────────────────────────────────

describe("Extraction lineage key — Group C", () => {
  /**
   * Pure-function helper that mirrors the lineage key computation in agent.ts.
   * We extract the logic here so we can test it without spinning up an HTTP server.
   */
  function computeLineageKey(
    sourceUrl: string,
    markdown: string,
    extractorVersion: string,
  ): { key: string; videoId: string; transcriptHash: string } {
    const transcriptHash = createHash("sha256").update(markdown, "utf8").digest("hex").slice(0, 16);
    let videoId: string;
    try {
      const u = new URL(sourceUrl);
      const v = u.searchParams.get("v");
      if (v) {
        videoId = v;
      } else {
        const seg = u.pathname.split("/").filter(Boolean).pop();
        videoId = seg ?? createHash("sha256").update(sourceUrl, "utf8").digest("hex").slice(0, 12);
      }
    } catch {
      videoId = createHash("sha256").update(sourceUrl, "utf8").digest("hex").slice(0, 12);
    }
    return {
      key: `${videoId}:${transcriptHash}:${extractorVersion}`,
      videoId,
      transcriptHash,
    };
  }

  const URL_A = "https://www.youtube.com/watch?v=AbCdEfGhIjK";
  const URL_B = "https://www.youtube.com/watch?v=ZyXwVuTsRqP";
  const TRANSCRIPT_A = "Entry when price sweeps liquidity and holds above the FVG";
  const TRANSCRIPT_B = "Wait for the morning session open, mark the gap, enter on retest";
  const VERSION = "gemma4:e2b";

  it("C1: same video + same transcript + same version → identical lineage key (stable/idempotent)", () => {
    const k1 = computeLineageKey(URL_A, TRANSCRIPT_A, VERSION);
    const k2 = computeLineageKey(URL_A, TRANSCRIPT_A, VERSION);

    expect(k1.key).toBe(k2.key);
    expect(k1.videoId).toBe(k2.videoId);
    expect(k1.transcriptHash).toBe(k2.transcriptHash);
  });

  it("C2: different video URL → different lineage key (same transcript + version)", () => {
    const k1 = computeLineageKey(URL_A, TRANSCRIPT_A, VERSION);
    const k2 = computeLineageKey(URL_B, TRANSCRIPT_A, VERSION);

    expect(k1.key).not.toBe(k2.key);
    expect(k1.videoId).not.toBe(k2.videoId);
    // transcript hash is the same (same transcript content)
    expect(k1.transcriptHash).toBe(k2.transcriptHash);
  });

  it("C3: different transcript content → different lineage key (same URL + version)", () => {
    const k1 = computeLineageKey(URL_A, TRANSCRIPT_A, VERSION);
    const k2 = computeLineageKey(URL_A, TRANSCRIPT_B, VERSION);

    expect(k1.key).not.toBe(k2.key);
    expect(k1.videoId).toBe(k2.videoId); // same video
    expect(k1.transcriptHash).not.toBe(k2.transcriptHash);
  });

  it("C4: different extractor version → different lineage key (same URL + transcript)", () => {
    const k1 = computeLineageKey(URL_A, TRANSCRIPT_A, "gemma4:e2b");
    const k2 = computeLineageKey(URL_A, TRANSCRIPT_A, "gemma4:27b");

    expect(k1.key).not.toBe(k2.key);
    expect(k1.videoId).toBe(k2.videoId);
    expect(k1.transcriptHash).toBe(k2.transcriptHash);
  });

  it("C5: transcript hash is 16 hex chars (128-bit truncation)", () => {
    const { transcriptHash } = computeLineageKey(URL_A, TRANSCRIPT_A, VERSION);
    expect(transcriptHash).toHaveLength(16);
    expect(transcriptHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("C6: YouTube ?v= parameter extracted as video_id", () => {
    const { videoId } = computeLineageKey("https://www.youtube.com/watch?v=TestVidID123", TRANSCRIPT_A, VERSION);
    expect(videoId).toBe("TestVidID123");
  });

  it("C7: non-YouTube URL falls back to path segment", () => {
    const { videoId } = computeLineageKey("https://example.com/videos/my-strategy-vid", TRANSCRIPT_A, VERSION);
    expect(videoId).toBe("my-strategy-vid");
  });

  it("C8: lineage key format is video_id:transcript_hash:extractor_version", () => {
    const { key, videoId, transcriptHash } = computeLineageKey(URL_A, TRANSCRIPT_A, VERSION);
    expect(key).toBe(`${videoId}:${transcriptHash}:${VERSION}`);
  });
});
