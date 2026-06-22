/**
 * Wave 23F Track G — Correlation ID end-to-end trace test
 *
 * Verifies the correlation_id propagation status across the W23F graduation pipeline:
 *
 *   scout_cycle.started (autonomous-scout-runner.ts)
 *     → postLayerMention → HTTP POST /api/agent/scout-ideas/pending
 *       → pending_bucket.created / pending_bucket.mention_added (agent.ts)
 *         → runGraduation → graduation.entry_quality_attached (direct-bucket-graduator.ts)
 *
 * FINDING: Partial propagation only.
 *
 * The scout cycle generates correlationId = randomUUID() and stores it on the
 * scout_cycle.started audit row. However, postLayerMention() calls the
 * /scout-ideas/pending HTTP endpoint WITHOUT forwarding this correlationId as
 * an HTTP header. The /scout-ideas/pending handler derives its own correlationId
 * from the HTTP request via getCorrelationId(req), which is a different UUID.
 *
 * This means:
 *   - scout_cycle.started uses correlationId = CYCLE_UUID
 *   - pending_bucket.created uses correlationId = HTTP_REQUEST_UUID (different)
 *   - pending_bucket.mention_added uses correlationId = HTTP_REQUEST_UUID
 *   - graduation.entry_quality_attached uses correlationId = HTTP_REQUEST_UUID
 *
 * The HTTP-side chain (pending_bucket.* → graduation.*) IS internally consistent.
 * The cycle-level chain (scout_cycle.started → pending_bucket.*) is BROKEN.
 *
 * Operator impact: cannot reconstruct a full cycle trace from a single correlationId.
 * Two separate queries are required:
 *   1. SELECT * FROM audit_log WHERE entity_id = '<cycle_uuid>' AND action = 'scout_cycle.started'
 *   2. SELECT * FROM audit_log WHERE correlation_id = '<http_request_uuid>' AND action IN (...)
 *
 * Escalation: this gap requires a fix in autonomous-scout-runner.ts
 * (pass the cycle correlationId as X-Correlation-ID header in postLayerMention)
 * and in agent.ts (prefer X-Correlation-ID header when set, overriding the
 * auto-generated req.id). This is a parent-agent fix — Wave 23F Track G must
 * not modify upstream code per brief.
 *
 * @see docs/wave23f-correlation-finding.md (to be created by parent agent)
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

const ROOT = join(process.cwd(), "src", "server");
// Wave hardening 2026-06-22, test isolation: normalize CRLF → LF. The
// postLayerMention test slices the source on the literal "}\n}" delimiter; on
// Windows the file is CRLF so that indexOf returned -1 and produced a bogus
// fnBody. Normalizing line endings makes the slice platform-independent
// (production source is correct — this was a test-only Windows line-ending bug).
const scoutRunnerSrc = readFileSync(
  join(ROOT, "services", "autonomous-scout-runner.ts"),
  "utf8"
).replace(/\r\n/g, "\n");
const agentRouteSrc = readFileSync(
  join(ROOT, "routes", "agent.ts"),
  "utf8"
);
const graduatorSrc = readFileSync(
  join(ROOT, "services", "direct-bucket-graduator.ts"),
  "utf8"
);

// ─── Case 1: scout_cycle.started stores its own correlationId ─────────────

describe("Wave 23F Correlation Trace — scout_cycle.started", () => {
  it("autonomous-scout-runner.ts generates correlationId = randomUUID() at cycle start", () => {
    expect(scoutRunnerSrc).toContain("correlationId = randomUUID()");
  });

  it("scout_cycle.started audit row stores correlationId on the row itself", () => {
    // Verify that the audit insert for scout_cycle.started includes correlationId
    const match = scoutRunnerSrc.match(
      /scout_cycle\.started[\s\S]*?correlationId[,\s]/
    );
    expect(
      match,
      "scout_cycle.started audit row must carry correlationId"
    ).toBeTruthy();
  });

  it("scout_cycle.started entityId is set to correlationId (cycle traceable by entity_id)", () => {
    const match = scoutRunnerSrc.match(
      /action:\s*"scout_cycle\.started"[\s\S]*?entityId:\s*correlationId/
    );
    expect(
      match,
      "scout_cycle.started must use correlationId as entityId for reverse lookup"
    ).toBeTruthy();
  });
});

// ─── Case 2: postLayerMention forwards cycle correlationId (W23F.G fix) ────

describe("Wave 23F Correlation Trace — postLayerMention propagates correlation_id end-to-end", () => {
  it("postLayerMention forwards correlationId as x-correlation-id HTTP header", () => {
    const postLayerMentionFnStart = scoutRunnerSrc.indexOf("async function postLayerMention");
    const postLayerMentionFnEnd = scoutRunnerSrc.indexOf("}\n}", postLayerMentionFnStart);
    const fnBody = scoutRunnerSrc.slice(postLayerMentionFnStart, postLayerMentionFnEnd + 3);
    const forwardsCorrelation = fnBody.includes("x-correlation-id") && fnBody.includes("opts.correlationId");
    expect(forwardsCorrelation).toBe(true);
  });

  it("postLayerMention opts type declares correlationId as required string", () => {
    const postLayerFn = scoutRunnerSrc.match(
      /async function postLayerMention\(opts:\s*\{[\s\S]*?\}\)/
    )?.[0] ?? "";
    expect(postLayerFn).toContain("seededSymbol");
    expect(postLayerFn).toMatch(/correlationId:\s*string;/);
  });
});

// ─── Case 3: HTTP-side chain IS consistent ────────────────────────────────

describe("Wave 23F Correlation Trace — HTTP-layer chain (internally consistent)", () => {
  it("/scout-ideas/pending derives correlationId from HTTP request via getCorrelationId(req)", () => {
    expect(agentRouteSrc).toContain("const correlationId = getCorrelationId(req)");
  });

  it("pending_bucket.created audit row carries correlationId from request", () => {
    const match = agentRouteSrc.match(
      /pending_bucket\.created[\s\S]*?correlationId[,\s]/
    );
    expect(match, "pending_bucket.created must carry correlationId").toBeTruthy();
  });

  it("pending_bucket.mention_added audit row carries correlationId from request", () => {
    const match = agentRouteSrc.match(
      /pending_bucket\.mention_added[\s\S]*?correlationId[,\s]/
    );
    expect(match, "pending_bucket.mention_added must carry correlationId").toBeTruthy();
  });

  it("runGraduation is called with HTTP-layer correlationId", () => {
    // The graduation receives the HTTP-request correlationId, linking
    // pending_bucket.* to graduation.entry_quality_attached under the SAME correlationId.
    const match = agentRouteSrc.match(
      /runGraduation\([^)]*correlationId[^)]*\)/
    );
    expect(match, "runGraduation must be called with correlationId").toBeTruthy();
  });

  it("graduation.entry_quality_attached carries correlationId propagated from caller", () => {
    const match = graduatorSrc.match(
      /graduation\.entry_quality_attached[\s\S]*?correlationId:\s*correlationId\s*\?\?\s*null/
    );
    expect(match, "graduation.entry_quality_attached must carry correlationId ?? null").toBeTruthy();
  });
});

// ─── Case 4: Actions that MUST appear in HTTP-scope trace ────────────────

describe("Wave 23F Correlation Trace — required actions in HTTP-scope trace", () => {
  it("pending_bucket.mention_added action is emitted in agent route", () => {
    expect(agentRouteSrc).toContain('"pending_bucket.mention_added"');
  });

  it("graduation.entry_quality_attached action is emitted in graduator", () => {
    expect(graduatorSrc).toContain('"graduation.entry_quality_attached"');
  });

  it("graduation.symbols_multi_market action is emitted conditionally in graduator", () => {
    expect(graduatorSrc).toContain('"graduation.symbols_multi_market"');
  });
});

// ─── Case 5: Cycle correlationId traceable via entityId field ────────────

describe("Wave 23F Correlation Trace — cycle ID is entity_id recoverable", () => {
  it("scout_cycle.started stores correlationId as entityId — allows separate query", () => {
    // Even though the cycle correlationId doesn't propagate via HTTP headers,
    // it IS stored as entityId on the scout_cycle.started row. Operator can
    // recover it via: SELECT entity_id FROM audit_log WHERE action='scout_cycle.started'
    // ORDER BY created_at DESC LIMIT 1
    const match = scoutRunnerSrc.match(
      /action:\s*["']scout_cycle\.started["'][\s\S]*?entityId:\s*correlationId/
    );
    expect(match, "scout_cycle.started entityId = correlationId must be set").toBeTruthy();
  });
});
