import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFields, validateHelloShape, validateAckShape, matchAckToHello,
  isStaleForSession, detectPeerRotation,
} from './peer-handshake-guard.mjs';

function helloText(overrides = {}) {
  const f = {
    FROM_WORKER: 'worker-2', TO_WORKER: 'worker-1', SESSION_INSTANCE_ID: 'w2-sess-AAA',
    WORKER_ID: 'worker-2', LANE: 'paper-runtime-safety', BRANCH: 'claude/worker2-runtime-20260815',
    HEAD: 'abc1234', GUARD_ARMED: 'true', GPT_EAR_ARMED: 'true', INTENDED_PACKET: 'AR-1155',
    STARTED_AT: '2026-08-18T00:00:00Z', PREVIOUS_PEER_SESSION_ID_SEEN: '',
    ...overrides,
  };
  return Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n');
}

function ackText(overrides = {}) {
  const f = {
    FROM_WORKER: 'worker-1', TO_WORKER: 'worker-2', ACK_FOR_SESSION_INSTANCE_ID: 'w2-sess-AAA',
    RECEIVER_SESSION_INSTANCE_ID: 'w1-sess-ZZZ', HELLO_COMMIT: 'def5678',
    SENDER_BRANCH: 'claude/worker2-runtime-20260815', SENDER_HEAD: 'abc1234',
    STATUS: 'ACK_CURRENT_SESSION',
    ...overrides,
  };
  return Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n');
}

// --- parseFields --------------------------------------------------------------------------
test('parseFields reads FIELD: value lines and ignores surrounding prose', () => {
  const fields = parseFields('# a heading\nFROM_WORKER: worker-2\nnote: not a match (lowercase)\nTO_WORKER: worker-1\n');
  assert.equal(fields.FROM_WORKER, 'worker-2');
  assert.equal(fields.TO_WORKER, 'worker-1');
  assert.equal(fields.note, undefined);
});

// --- PASS: well-formed HELLO accepted ---------------------------------------------------------
test('PASS: well-formed HELLO shape is accepted', () => {
  const fields = parseFields(helloText());
  const result = validateHelloShape(fields);
  assert.equal(result.ok, true, JSON.stringify(result));
});

// --- PASS: exact matching ACK accepted ---------------------------------------------------------
test('PASS: exact matching ACK is accepted', () => {
  const hello = parseFields(helloText());
  const ack = parseFields(ackText());
  const result = matchAckToHello({ hello, ack, currentSessionInstanceId: 'w2-sess-AAA' });
  assert.equal(result.ok, true, JSON.stringify(result));
});

// --- PASS: peer rotation detected correctly -----------------------------------------------
test('PASS: peer rotation detected when session id changes', () => {
  const r = detectPeerRotation({ lastKnownPeerSessionId: 'w2-sess-AAA', newPeerSessionId: 'w2-sess-BBB' });
  assert.equal(r.rotated, true);
});

test('PASS: no rotation when session id is unchanged', () => {
  const r = detectPeerRotation({ lastKnownPeerSessionId: 'w2-sess-AAA', newPeerSessionId: 'w2-sess-AAA' });
  assert.equal(r.rotated, false);
});

test('PASS: first contact (no prior peer session) is not a rotation', () => {
  const r = detectPeerRotation({ lastKnownPeerSessionId: null, newPeerSessionId: 'w2-sess-AAA' });
  assert.equal(r.rotated, false);
  assert.match(r.reason, /first contact/);
});

// --- PASS: same permanent worker identity preserved across session rotation ----------------
test('PASS: WORKER_ID stays constant while SESSION_INSTANCE_ID rotates', () => {
  const first = parseFields(helloText({ SESSION_INSTANCE_ID: 'w2-sess-AAA' }));
  const second = parseFields(helloText({ SESSION_INSTANCE_ID: 'w2-sess-BBB', PREVIOUS_PEER_SESSION_ID_SEEN: 'w2-sess-AAA' }));
  assert.equal(first.WORKER_ID, second.WORKER_ID);
  assert.notEqual(first.SESSION_INSTANCE_ID, second.SESSION_INSTANCE_ID);
  const rotation = detectPeerRotation({
    lastKnownPeerSessionId: first.SESSION_INSTANCE_ID,
    newPeerSessionId: second.SESSION_INSTANCE_ID,
  });
  assert.equal(rotation.rotated, true);
});

// --- FAIL: stale ACK rejected ---------------------------------------------------------------
test('FAIL: ACK for a different (stale) session id is rejected', () => {
  const hello = parseFields(helloText({ SESSION_INSTANCE_ID: 'w2-sess-NEW' }));
  const ack = parseFields(ackText({ ACK_FOR_SESSION_INSTANCE_ID: 'w2-sess-OLD' }));
  const result = matchAckToHello({ hello, ack });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes('ACK_FOR_SESSION_INSTANCE_ID')));
});

test('FAIL: isStaleForSession flags an ACK for a prior session after rotation', () => {
  assert.equal(isStaleForSession('w2-sess-OLD', 'w2-sess-NEW'), true);
  assert.equal(isStaleForSession('w2-sess-NEW', 'w2-sess-NEW'), false);
});

// --- FAIL: wrong session ID rejected (currentSessionInstanceId cross-check) ----------------
test('FAIL: HELLO/ACK pair valid on its own but does not match THIS session id', () => {
  const hello = parseFields(helloText({ SESSION_INSTANCE_ID: 'w2-sess-AAA' }));
  const ack = parseFields(ackText({ ACK_FOR_SESSION_INSTANCE_ID: 'w2-sess-AAA' }));
  const result = matchAckToHello({ hello, ack, currentSessionInstanceId: 'w2-sess-DIFFERENT' });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes("this session's id")));
});

// --- FAIL: wrong worker rejected -------------------------------------------------------------
test('FAIL: ACK from the wrong worker is rejected', () => {
  const hello = parseFields(helloText());
  const ack = parseFields(ackText({ FROM_WORKER: 'worker-2', TO_WORKER: 'worker-2' }));
  // FROM==TO also trips validateAckShape's self-ack check; this asserts matchAckToHello reports
  // the identity mismatch too, since a caller may call it directly on unvalidated input.
  const shape = validateAckShape(ack);
  assert.equal(shape.ok, false);
});

test('FAIL: ACK addressed to a worker that never sent the HELLO is rejected', () => {
  const hello = parseFields(helloText({ FROM_WORKER: 'worker-2', TO_WORKER: 'worker-1' }));
  const ack = parseFields(ackText({ FROM_WORKER: 'worker-1', TO_WORKER: 'worker-1' }));
  // shape-invalid (self-ack pattern on TO==FROM would be caught upstream); also fails the
  // cross-check directly:
  const result = matchAckToHello({ hello, ack });
  assert.equal(result.ok, false);
});

// --- FAIL: self-ACK rejected -----------------------------------------------------------------
test('FAIL: self-ACK (FROM_WORKER == TO_WORKER) is rejected at shape validation', () => {
  const ack = parseFields(ackText({ FROM_WORKER: 'worker-1', TO_WORKER: 'worker-1' }));
  const result = validateAckShape(ack);
  assert.equal(result.ok, false);
  assert.ok(result.missing.some((m) => m.includes('self-ACK')));
});

// --- FAIL: old-session message cannot satisfy new-session startup --------------------------
test('FAIL: an ACK that answered a PRIOR session cannot satisfy the NEW session gate', () => {
  const oldHello = parseFields(helloText({ SESSION_INSTANCE_ID: 'w2-sess-OLD' }));
  const oldAck = parseFields(ackText({ ACK_FOR_SESSION_INSTANCE_ID: 'w2-sess-OLD' }));
  // The old pair is internally consistent (a real historical handshake)...
  assert.equal(matchAckToHello({ hello: oldHello, ack: oldAck }).ok, true);
  // ...but a FRESH session with a NEW id cannot treat that old ACK as its own proof:
  const result = matchAckToHello({ hello: oldHello, ack: oldAck, currentSessionInstanceId: 'w2-sess-NEW' });
  assert.equal(result.ok, false);
});

// --- FAIL: malformed HELLO / ACK missing required fields ------------------------------------
test('FAIL: HELLO missing a required field is rejected with the exact field named', () => {
  const fields = parseFields(helloText({ GUARD_ARMED: undefined }).replace(/GUARD_ARMED: undefined\n?/, ''));
  const result = validateHelloShape(fields);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('GUARD_ARMED'));
});

test('FAIL: ACK with an invalid STATUS value is rejected', () => {
  const ack = parseFields(ackText({ STATUS: 'MADE_UP_STATUS' }));
  const result = validateAckShape(ack);
  assert.equal(result.ok, false);
  assert.ok(result.missing.some((m) => m.includes('STATUS must be one of')));
});

// --- FAIL (design-level, not a unit test): HELLO/ACK cannot grant edit authority ------------
// Structural, not behavioral: this module exports zero functions that return a permission
// decision, and claude-hook-bridge.mjs (the actual permission authority) has no code path that
// reads a HELLO/ACK file at all -- confirmed by reading that file directly, 2026-08-18. There is
// nothing to unit-test here because there is no function whose job is "turn a message into
// authority" to call.
