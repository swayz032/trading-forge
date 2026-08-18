#!/usr/bin/env node
/**
 * PEER SESSION HANDSHAKE VALIDATOR -- worker-onboarding SS2b.
 *
 * WHY THIS EXISTS
 *   Operator order 2026-08-18: every fresh worker Claude session must send a
 *   WORKER_SESSION_START_HELLO to its peer and receive a matching
 *   WORKER_SESSION_START_ACK before engineering may begin. This module is the ONE place that
 *   shape and match those messages, so the two onboarding skills reference it instead of each
 *   re-implementing the same check (`[document-vs-program]`: a rule stated only in prose is not
 *   enforced, it is remembered).
 *
 * WHAT THIS IS NOT
 *   Not a messaging transport. HELLO/ACK are plain markdown files committed to each worker's OWN
 *   `docs/replay-results/worker-advisor-reports/` directory (the existing channel -- see that
 *   directory's README). The peer reads them with `git fetch <peer-branch> && git show
 *   FETCH_HEAD:<path>`, exactly as the 2026-08-18 AR-1329/AR-1330 smoke test proved. This module
 *   only parses and validates the CONTENT once you have it.
 *   Not a permission grant. No code path in claude-hook-bridge.mjs / lane-boundary-guard.mjs
 *   reads a HELLO or ACK file for any purpose -- confirmed by reading that file, not assumed.
 *   A worker-to-worker message can request work; it cannot authorize an edit the guard would
 *   otherwise deny, because the guard has no HELLO/ACK-shaped input at all.
 *
 * MESSAGE SHAPE
 *   Plain `FIELD: value` lines, one per line, anywhere in the file (order-independent, extra
 *   prose/headings around them are ignored). Chosen over JSON/YAML so the files stay readable as
 *   plain markdown reports, consistent with every other file in worker-advisor-reports/.
 */

const HELLO_REQUIRED = [
  'FROM_WORKER', 'TO_WORKER', 'SESSION_INSTANCE_ID', 'WORKER_ID', 'LANE',
  'BRANCH', 'HEAD', 'GUARD_ARMED', 'GPT_EAR_ARMED', 'INTENDED_PACKET', 'STARTED_AT',
];

const ACK_REQUIRED = [
  'FROM_WORKER', 'TO_WORKER', 'ACK_FOR_SESSION_INSTANCE_ID', 'RECEIVER_SESSION_INSTANCE_ID',
  'HELLO_COMMIT', 'SENDER_BRANCH', 'SENDER_HEAD', 'STATUS',
];

const ACK_STATUSES = new Set(['ACK_CURRENT_SESSION', 'ACK_PEER_SESSION_ROTATED']);

/** Parse `FIELD: value` lines into an object. Unknown fields are kept (forward-compatible); a
 *  field repeated more than once keeps the LAST occurrence, matching how a human editing the
 *  file top-to-bottom would expect it to read. */
export function parseFields(text) {
  if (typeof text !== 'string') throw new Error('message text must be a string');
  const out = {};
  const lineRe = /^([A-Z][A-Z0-9_]*):\s*(.*)$/;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const m = lineRe.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function missingFields(fields, required) {
  return required.filter((k) => !(k in fields) || fields[k] === '');
}

/** A HELLO with an empty PREVIOUS_PEER_SESSION_ID_SEEN is valid -- "not known yet" is a real,
 *  legitimate first-contact state, not a shape error. */
export function validateHelloShape(fields) {
  const missing = missingFields(fields, HELLO_REQUIRED);
  if (fields.FROM_WORKER && fields.FROM_WORKER === fields.TO_WORKER) missing.push('FROM_WORKER!=TO_WORKER');
  return { ok: missing.length === 0, missing };
}

export function validateAckShape(fields) {
  const missing = missingFields(fields, ACK_REQUIRED);
  if (fields.STATUS && !ACK_STATUSES.has(fields.STATUS)) missing.push(`STATUS must be one of ${[...ACK_STATUSES].join('|')}`);
  if (fields.FROM_WORKER && fields.FROM_WORKER === fields.TO_WORKER) missing.push('FROM_WORKER!=TO_WORKER (self-ACK is not a peer ack)');
  return { ok: missing.length === 0, missing };
}

/**
 * Cross-check one ACK against the HELLO it claims to answer. This is the gate a fresh session's
 * onboarding must pass before writing STARTUP messaging_startup_verified=true.
 *
 * Every reason is returned, not just the first, so a rejected handshake is fully diagnosable from
 * one call instead of fix-one-run-again-fix-the-next.
 */
export function matchAckToHello({ hello, ack, currentSessionInstanceId }) {
  const helloShape = validateHelloShape(hello);
  const ackShape = validateAckShape(ack);
  const reasons = [];
  if (!helloShape.ok) reasons.push(`HELLO malformed: missing ${helloShape.missing.join(', ')}`);
  if (!ackShape.ok) reasons.push(`ACK malformed: missing ${ackShape.missing.join(', ')}`);
  if (!helloShape.ok || !ackShape.ok) return { ok: false, reasons };

  // Identity of the exchange: the ACK must be FROM the hello's addressee, TO the hello's sender.
  if (ack.FROM_WORKER !== hello.TO_WORKER) {
    reasons.push(`ACK.FROM_WORKER (${ack.FROM_WORKER}) != HELLO.TO_WORKER (${hello.TO_WORKER})`);
  }
  if (ack.TO_WORKER !== hello.FROM_WORKER) {
    reasons.push(`ACK.TO_WORKER (${ack.TO_WORKER}) != HELLO.FROM_WORKER (${hello.FROM_WORKER})`);
  }
  // The ACK must name the EXACT session it is answering -- a wrong or stale id is not a partial
  // match, it is a different handshake.
  if (ack.ACK_FOR_SESSION_INSTANCE_ID !== hello.SESSION_INSTANCE_ID) {
    reasons.push(
      `ACK_FOR_SESSION_INSTANCE_ID (${ack.ACK_FOR_SESSION_INSTANCE_ID}) != HELLO.SESSION_INSTANCE_ID (${hello.SESSION_INSTANCE_ID})`,
    );
  }
  // The fresh session verifying its OWN handshake must see its OWN session id acknowledged, not
  // some other HELLO this peer answered previously. `currentSessionInstanceId` is optional here
  // (a pure cross-check of two files does not require it) but when supplied it is authoritative.
  if (currentSessionInstanceId && hello.SESSION_INSTANCE_ID !== currentSessionInstanceId) {
    reasons.push(`HELLO.SESSION_INSTANCE_ID (${hello.SESSION_INSTANCE_ID}) != this session's id (${currentSessionInstanceId})`);
  }
  if (ack.SENDER_BRANCH !== hello.BRANCH) {
    reasons.push(`ACK.SENDER_BRANCH (${ack.SENDER_BRANCH}) != HELLO.BRANCH (${hello.BRANCH}) -- ACK must describe the HELLO sender's branch`);
  }

  return { ok: reasons.length === 0, reasons };
}

/** A message is stale for THIS session's startup if it does not name this session's own id.
 *  Historical messages from a prior session of the SAME permanent worker remain valid evidence
 *  that the peer link has worked before -- they do not satisfy a NEW session's own gate. */
export function isStaleForSession(ackForSessionInstanceId, currentSessionInstanceId) {
  return ackForSessionInstanceId !== currentSessionInstanceId;
}

/** Peer rotation is a FACT about the peer's session, never a worker-identity change. Same
 *  worker_id, new session_instance_id -- record it, do not treat it as a new peer to distrust. */
export function detectPeerRotation({ lastKnownPeerSessionId, newPeerSessionId }) {
  if (!lastKnownPeerSessionId) return { rotated: false, reason: 'no prior peer session on record -- first contact' };
  if (lastKnownPeerSessionId === newPeerSessionId) return { rotated: false, reason: 'peer session unchanged' };
  return { rotated: true, reason: `peer session id changed: ${lastKnownPeerSessionId} -> ${newPeerSessionId}` };
}
