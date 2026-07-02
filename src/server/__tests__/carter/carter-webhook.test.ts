/**
 * carter-webhook.test.ts — Wave 1 Task 1.5 (TDD)
 *
 * Tests POST /api/carter/webhook directly (no HTTP layer), matching the repo's
 * supertest-free pattern. Computes a REAL HMAC ElevenLabs-Signature over the raw
 * body and mocks the audit_log insert to capture the written row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildElevenLabsSignature } from "../../lib/carter/carter-auth.js";

// ─── Hoisted capture of audit rows ──────────────────────────────────────────
const auditRows = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async (values: Record<string, unknown>) => {
    auditRows.push(values);
    return true;
  }),
  insertAuditRow: vi.fn(async (values: Record<string, unknown>) => {
    auditRows.push(values);
  }),
}));

// logger leaf (carter-webhook imports it) — avoid Express bootstrap graph.
vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SECRET = "0".repeat(64);

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
    send(b: any) { this.body = b; return this; },
  };
  return res;
}

function sampleBody() {
  return JSON.stringify({
    type: "post_call_transcription",
    event_timestamp: 1735689600,
    data: {
      agent_id: "agent_8201kw8asnenf938f3nxkdx9m2r5",
      conversation_id: "conv_abc123",
      status: "done",
      transcript: [
        { role: "agent", message: "All clear — nothing needs your attention." },
        { role: "user", message: "Thanks." },
      ],
      analysis: {
        transcript_summary: "Operator checked in; system healthy.",
        call_successful: "success",
      },
    },
  });
}

beforeEach(() => {
  auditRows.length = 0;
  process.env.CARTER_POST_CALL_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/carter/webhook (post-call transcription → audit_log)", () => {
  it("accepts a valid HMAC and writes carter.conversation_logged (info, voice_agent)", async () => {
    const { postCarterWebhook } = await import("../../routes/carter-webhook.js");
    const raw = sampleBody();
    const sig = buildElevenLabsSignature(raw, SECRET);
    const req: any = { headers: { "elevenlabs-signature": sig }, body: Buffer.from(raw, "utf8") };
    const res = mockRes();

    await postCarterWebhook(req, res);

    expect(res.statusCode).toBe(200);
    expect(auditRows.length).toBe(1);
    const row = auditRows[0];
    expect(row.action).toBe("carter.conversation_logged");
    expect(row.status).toBe("info");
    expect(row.decisionAuthority).toBe("voice_agent");
    // transcript + summary captured in input or result
    const blob = JSON.stringify({ input: row.input, result: row.result });
    expect(blob).toContain("Operator checked in");
    expect(blob).toContain("conv_abc123");
  });

  it("rejects an invalid HMAC with 401 and writes no conversation_logged row", async () => {
    const { postCarterWebhook } = await import("../../routes/carter-webhook.js");
    const raw = sampleBody();
    const req: any = {
      headers: { "elevenlabs-signature": "t=1735689600,v0=deadbeef" },
      body: Buffer.from(raw, "utf8"),
    };
    const res = mockRes();

    await postCarterWebhook(req, res);

    expect(res.statusCode).toBe(401);
    expect(auditRows.some((r) => r.action === "carter.conversation_logged")).toBe(false);
  });

  it("rejects a missing signature header with 401", async () => {
    const { postCarterWebhook } = await import("../../routes/carter-webhook.js");
    const raw = sampleBody();
    const req: any = { headers: {}, body: Buffer.from(raw, "utf8") };
    const res = mockRes();

    await postCarterWebhook(req, res);

    expect(res.statusCode).toBe(401);
  });
});
