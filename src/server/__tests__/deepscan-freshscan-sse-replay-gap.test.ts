/**
 * Fresh-scan HIGH#8 (2026-07-12) — SSE reconnect replay-gap detection is now bidirectional via a
 * per-boot id. The pre-fix seq-only logic missed the COMMON restart case: a client connected shortly
 * before the restart (small lastSeenSeq) reconnects after the fresh process already climbed the
 * counter back past it → no gap signalled → real post-restart events silently dropped.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeReplayGap } from "../lib/sse-replay-gap.js";

const BOOT = "aaaa1111";

describe("SSE proxy transport hardening", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/server/routes/sse.ts"), "utf8");
  const relayServer = fs.readFileSync(path.resolve(process.cwd(), "railway-relay/server.js"), "utf8");
  const relayClient = fs.readFileSync(path.resolve(process.cwd(), "scripts/tower-relay-client.cjs"), "utf8");

  it("flushes an unbuffered response immediately and keeps proxy idle time below 30 seconds", () => {
    expect(source).toContain("const HEARTBEAT_INTERVAL_MS = 15_000");
    expect(source).toContain('"Cache-Control": "no-cache, no-transform"');
    expect(source).toContain("res.flushHeaders()");
    expect(source).toContain('res.write(`retry: 2000\\n:${" ".repeat(2048)}\\n`)');
    expect(source).toContain("req.socket.setKeepAlive(true, HEARTBEAT_INTERVAL_MS)");
  });

  it("streams event responses across the WebSocket relay instead of waiting for response end", () => {
    for (const frame of ["response_start", "response_chunk", "response_end"]) {
      expect(relayServer).toContain(`msg.type === \"${frame}\"`);
      expect(relayClient).toContain(`type: \"${frame}\"`);
    }
    expect(relayClient).toContain('/^text\\/event-stream\\b/i');
    expect(relayClient).toContain('msg.type === "cancel"');
    expect(relayServer).toContain('sendFrame(tower, { type: "cancel", id })');
    expect(relayServer).toContain('if (msg.type !== "response") return');
    expect(relayClient).toContain("sendResponse(ws, msg.id, res.statusCode, res.headers, body)");
  });
});

describe("fresh-scan HIGH#8 — computeReplayGap boot-mismatch restart detection", () => {
  it("THE BUG CASE: small lastSeenSeq, counter climbed back past it after restart → gap (was missed)", () => {
    // client had seq 5 pre-restart; fresh process now at eventSeq 10, ring holds seq 1..10.
    // seq-only checks: oldestSeq(1)>5+1 false; 5>10 false → old logic said NO gap (BUG).
    const d = computeReplayGap({
      lastEventIdRaw: "bbbb2222.5", // DIFFERENT bootId (restart)
      currentBootId: BOOT,
      ringEmpty: false,
      oldestSeq: 1,
      eventSeq: 10,
    });
    expect(d.bootMismatch).toBe(true);
    expect(d.hasGap).toBe(true); // now correctly detected
  });

  it("same bootId, buffer covers the gap → NO gap, replays missed seqs", () => {
    const d = computeReplayGap({
      lastEventIdRaw: `${BOOT}.5`,
      currentBootId: BOOT,
      ringEmpty: false,
      oldestSeq: 3, // covers 5 (3 <= 5+1)
      eventSeq: 10,
    });
    expect(d.bootMismatch).toBe(false);
    expect(d.hasGap).toBe(false);
    expect(d.lastSeenSeq).toBe(5);
  });

  it("same bootId but buffer does NOT cover last-seen → gap", () => {
    const d = computeReplayGap({
      lastEventIdRaw: `${BOOT}.5`, currentBootId: BOOT, ringEmpty: false, oldestSeq: 8, eventSeq: 12,
    });
    expect(d.hasGap).toBe(true); // oldestSeq 8 > 5+1
  });

  it("legacy plain-int Last-Event-ID (pre-deploy client) is treated as a restart → gap", () => {
    const d = computeReplayGap({
      lastEventIdRaw: "5", currentBootId: BOOT, ringEmpty: false, oldestSeq: 1, eventSeq: 10,
    });
    expect(d.bootMismatch).toBe(true);
    expect(d.hasGap).toBe(true);
  });

  it("still catches the original one-directional case (last-seen above the fresh counter)", () => {
    const d = computeReplayGap({
      lastEventIdRaw: `${BOOT}.5000`, currentBootId: BOOT, ringEmpty: false, oldestSeq: 1, eventSeq: 12,
    });
    expect(d.hasGap).toBe(true); // 5000 > eventSeq 12
  });

  it("fresh connection (no Last-Event-ID) → no evaluation", () => {
    const d = computeReplayGap({ lastEventIdRaw: "", currentBootId: BOOT, ringEmpty: true, oldestSeq: -1, eventSeq: 0 });
    expect(d.shouldEvaluate).toBe(false);
    expect(d.hasGap).toBe(false);
  });
});
