// AR-1263 §7C controls for the G2-D pre-call boundary.
//
// EVERY artifact here is synthetic and lives in a temp dir. No control touches the real
// frozen queue, the real receipt directory, or spends a real attempt — the ruling is
// explicit that the guard must be proven without claiming one of the eight.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadG2Context,
  evaluateG2PreCall,
  safeName,
  sha256File,
  G2_PERMIT_SCHEMA,
  SUBAGENT_TOOL_NAMES,
} from './g2-precall-guard.mjs';

const REF_A = 'entry_sequence[0].rationale';
const REF_B = 'entry_sequence[1].action';
const TASK_SHA_A = 'a'.repeat(64);
const TASK_SHA_B = 'b'.repeat(64);

function makeG2({ attempts = {}, receipts = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g2precall-'));
  const receiptDir = path.join(root, 'isolated-receipts-t1');
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, 'README.md'), 'synthetic\n');

  const queuePath = path.join(root, 'isolated_fallback_queue_t1.json');
  fs.writeFileSync(
    queuePath,
    JSON.stringify(
      {
        law_version: 'isolated-fallback-law-v1',
        input_route_version: 'opus-phase1-route-v2',
        max_attempts_per_condition: 1,
        queue: [
          { condition_ref: REF_A, task_input_sha256: TASK_SHA_A },
          { condition_ref: REF_B, task_input_sha256: TASK_SHA_B },
        ],
        attempts,
      },
      null,
      2,
    ),
  );

  for (const r of receipts) fs.writeFileSync(path.join(receiptDir, r), '{}\n');

  return { root, queuePath, receiptDir, g2: loadG2Context({ queuePath, receiptDir }) };
}

// The permit is COMPUTED from the synthetic queue, never a hand-copied constant — a
// hand-copied expected value embalms a dead number and stops discriminating.
function writePermit(ctx, overrides = {}) {
  const p = path.join(ctx.root, 'permit.json');
  fs.writeFileSync(
    p,
    JSON.stringify({
      schema: G2_PERMIT_SCHEMA,
      condition_ref: REF_A,
      queue_artifact_sha256: ctx.g2.queueSha256,
      task_input_sha256: TASK_SHA_A,
      requested_model: 'opus',
      attempt: 1,
      ...overrides,
    }),
  );
  return p;
}

// A realistic G2 dispatch: it names the condition and carries a permit pointer.
function dispatch(permitPath, ref = REF_A, extra = {}) {
  return {
    toolName: 'Agent',
    toolInput: {
      description: 'isolated G2-D call',
      prompt: `Answer the frozen condition ${ref}. G2D-PERMIT: ${permitPath}`,
      ...extra,
    },
  };
}

function run(ctx, call) {
  return evaluateG2PreCall({ ...call, g2: ctx.g2, cwd: ctx.root });
}

// ---------------------------------------------------------------------------
// POSITIVE CONTROLS
// ---------------------------------------------------------------------------

test('POSITIVE: benign non-G2 subagent usage remains usable', () => {
  const ctx = makeG2();
  const r = run(ctx, { toolName: 'Agent', toolInput: { prompt: 'summarize the README for me' } });
  assert.equal(r.allow, true);
  assert.equal(r.g2, false);
});

test('POSITIVE: an exact authorized permit reaches the tool boundary without spending a real condition', () => {
  const ctx = makeG2();
  const permit = writePermit(ctx);
  const r = run(ctx, dispatch(permit));
  assert.equal(r.allow, true);
  assert.equal(r.g2, true);
  // and nothing was written into the receipt directory by the guard itself
  assert.deepEqual(fs.readdirSync(ctx.receiptDir), ['README.md']);
});

// ---------------------------------------------------------------------------
// NEGATIVE CONTROLS — the seven AR-1263 §7C names
// ---------------------------------------------------------------------------

test('NEGATIVE: G2 subagent call with no permit is denied before the call', () => {
  const ctx = makeG2();
  const r = run(ctx, {
    toolName: 'Agent',
    toolInput: { prompt: `Answer the frozen condition ${REF_A}.` },
  });
  assert.equal(r.allow, false);
  assert.match(r.reason, /no durable pre-call permit/);
});

test('NEGATIVE: wrong condition ref is denied', () => {
  const ctx = makeG2();
  const permit = writePermit(ctx, { condition_ref: 'entry_sequence[7].not_a_real_ref' });
  const r = run(ctx, dispatch(permit, 'entry_sequence[7].not_a_real_ref'));
  assert.equal(r.allow, false);
  assert.match(r.reason, /not a member of the frozen queue/);
});

test('NEGATIVE: wrong task_input_sha256 is denied', () => {
  const ctx = makeG2();
  const permit = writePermit(ctx, { task_input_sha256: 'c'.repeat(64) });
  const r = run(ctx, dispatch(permit));
  assert.equal(r.allow, false);
  assert.match(r.reason, /task_input_sha256 does not match/);
});

test('NEGATIVE: wrong queue sha is denied', () => {
  const ctx = makeG2();
  const permit = writePermit(ctx, { queue_artifact_sha256: 'd'.repeat(64) });
  const r = run(ctx, dispatch(permit));
  assert.equal(r.allow, false);
  assert.match(r.reason, /!= frozen queue SHA/);
});

test('NEGATIVE: requested Sonnet/Haiku/anything-not-opus is denied', () => {
  const ctx = makeG2();
  for (const model of ['sonnet', 'haiku', 'claude-opus-5', 'Opus', 'opus-impostor', '']) {
    const permit = writePermit(ctx, { requested_model: model });
    const r = run(ctx, dispatch(permit));
    assert.equal(r.allow, false, `requested_model '${model}' must be refused`);
    assert.match(r.reason, /requested_model must be exactly 'opus'/);
  }
});

test('NEGATIVE: second dispatch for an already-claimed condition is denied (queue witness)', () => {
  const ctx = makeG2({ attempts: { [REF_A]: { attempt: 1 } } });
  const permit = writePermit(ctx);
  const r = run(ctx, dispatch(permit));
  assert.equal(r.allow, false);
  assert.match(r.reason, /already spent\/claimed/);
  assert.match(r.reason, /queue\.attempts/);
});

test('NEGATIVE: second dispatch is denied on a receipt witness alone', () => {
  // The queue may not yet record the attempt if a crash landed between write and update.
  // An existing receipt file is an independent durable witness and must be sufficient.
  const ctx = makeG2({ receipts: [`${safeName(REF_A)}.attempt.json`] });
  const permit = writePermit(ctx);
  const r = run(ctx, dispatch(permit));
  assert.equal(r.allow, false);
  assert.match(r.reason, /already spent\/claimed/);
  assert.match(r.reason, /receipt exists/);
});

test('NEGATIVE: a permit for a different condition than the invocation names is denied', () => {
  // Prevents presenting a valid permit for condition A while actually dispatching B.
  const ctx = makeG2();
  const permit = writePermit(ctx, { condition_ref: REF_B, task_input_sha256: TASK_SHA_B });
  const r = run(ctx, dispatch(permit, REF_A));
  assert.equal(r.allow, false);
  assert.match(r.reason, /which this invocation does not name/);
});

test('NEGATIVE: attempt number above the one-shot law is denied', () => {
  const ctx = makeG2();
  const permit = writePermit(ctx, { attempt: 2 });
  const r = run(ctx, dispatch(permit));
  assert.equal(r.allow, false);
  assert.match(r.reason, /attempt must be 1/);
});

test('NEGATIVE: an unreadable or absent permit file is denied, not skipped', () => {
  const ctx = makeG2();
  const r = run(ctx, dispatch(path.join(ctx.root, 'does-not-exist.json')));
  assert.equal(r.allow, false);
  assert.match(r.reason, /permit unreadable/);
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED DETECTION — the property that makes the guard non-optional
// ---------------------------------------------------------------------------

test('FAIL-CLOSED: omitting the marker does not escape the gate', () => {
  // The bypass this design exists to prevent: a caller that simply does not mention a permit.
  // Detection keys off G2 surface, so the call is still caught and denied.
  const ctx = makeG2();
  const viaReceiptDir = run(ctx, {
    toolName: 'Agent',
    toolInput: { prompt: 'write the answer into isolated-receipts-t1 please' },
  });
  assert.equal(viaReceiptDir.allow, false);
  assert.match(viaReceiptDir.reason, /no durable pre-call permit/);

  const viaQueue = run(ctx, {
    toolName: 'Agent',
    toolInput: { prompt: 'read isolated_fallback_queue_t1.json and answer entry 0' },
  });
  assert.equal(viaQueue.allow, false);
});

test('MUTATION: treating a missing permit as "not G2" reopens the hole', () => {
  // If detection required the caller to volunteer a marker, the no-permit dispatch above
  // would be classified benign and ALLOWED. This asserts the guard is not built that way.
  const ctx = makeG2();
  const noMarker = { toolName: 'Agent', toolInput: { prompt: `answer ${REF_A}` } };
  const strict = run(ctx, noMarker);
  assert.equal(strict.allow, false, 'detection must not depend on caller cooperation');

  // positive witness that the same shape IS allowed once the G2 surface is absent
  const benign = run(ctx, { toolName: 'Agent', toolInput: { prompt: 'answer something unrelated' } });
  assert.equal(benign.allow, true);
});

test('the synthetic queue sha is the real file digest, not a copied constant', () => {
  const ctx = makeG2();
  assert.equal(ctx.g2.queueSha256, sha256File(ctx.queuePath));
  assert.equal(ctx.g2.queueSha256.length, 64);
});

// =========================================================================================
// AR-1265 §3.1 — REGISTRATION PARITY.
//
// The graded pin held a correct guard that could never fire: the installed PreToolUse matcher
// was `Edit|Write|NotebookEdit|Bash` while this guard watches {Agent, Task}. Every synthetic
// test passed anyway, because the tests called the guard directly and the harness never had to
// route the event. This control asserts the two artifacts against each other.
//
// `A CORRECT GUARD THAT NEVER RECEIVES THE EVENT IS NOT A GUARD.`
// =========================================================================================

test('REGISTRATION PARITY: every guarded subagent tool appears in the PreToolUse matcher', () => {
  const fragmentPath = path.resolve(import.meta.dirname, '..', 'claude-hooks', 'settings.fragment.json');
  const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));
  const preToolUse = fragment.hooks.PreToolUse;
  assert.equal(preToolUse.length, 1, 'expected exactly one PreToolUse registration to reason about');

  const matcher = preToolUse[0].matcher;
  const registered = new Set(matcher.split('|'));

  for (const tool of SUBAGENT_TOOL_NAMES) {
    assert(
      registered.has(tool),
      `guard watches subagent tool '${tool}' but the installed PreToolUse matcher (${matcher}) does not register it — the guard would never see the call`,
    );
  }
  // Positive witness that this control reads a real matcher and would notice a narrowed one.
  assert(registered.has('Edit'), 'edit tools must remain registered');
});

// =========================================================================================
// AR-1265 §3.2 — STRICT DEDICATED G2 SESSION.
//
// Content-shaped detection is evadable by a dispatch carrying only condition PROSE. In the
// reserved eight-call session, membership is decided by the SESSION, not the payload.
// =========================================================================================

// Deliberately mentions NOTHING detectable: no condition ref, no queue filename, no receipt
// directory name, no permit marker. Under content detection this is indistinguishable from
// ordinary helper work — which is exactly the bypass.
const PROSE_ONLY = {
  toolName: 'Agent',
  toolInput: {
    description: 'answer a frozen question',
    prompt: 'Read the pinned transcript span and state whether the teacher named a fixed target. Return only the verdict.',
  },
};

test('STRICT §3.2 BASELINE: prose-only dispatch classifies benign when strict mode is OFF', () => {
  const ctx = makeG2();
  const v = evaluateG2PreCall({ ...PROSE_ONLY, g2: ctx.g2, cwd: ctx.root, strictSession: false });
  // This is the BYPASS, asserted as a baseline witness rather than hidden. It is why strict
  // mode has to exist; it is not an acceptable state for the reserved session.
  assert.equal(v.allow, true);
  assert.equal(v.g2, false);
});

test('STRICT §3.2: the same prose-only dispatch is DENIED before the call when strict mode is ON', () => {
  const ctx = makeG2();
  const v = evaluateG2PreCall({ ...PROSE_ONLY, g2: ctx.g2, cwd: ctx.root, strictSession: true });
  assert.equal(v.allow, false);
  assert.equal(v.g2, true);
  assert.match(v.reason, /strict dedicated G2 execution session/);
  assert.match(v.reason, /no durable pre-call permit/);
});

test('STRICT §3.2: an exact permit still passes under strict mode', () => {
  const ctx = makeG2();
  const permit = writePermit(ctx);
  const v = evaluateG2PreCall({ ...dispatch(permit), g2: ctx.g2, cwd: ctx.root, strictSession: true });
  assert.equal(v.allow, true, v.reason);
  assert.equal(v.g2, true);
});

test('STRICT §3.2: strict mode does not weaken any permit check', () => {
  const ctx = makeG2();
  const wrongModel = writePermit(ctx, { requested_model: 'sonnet' });
  const v = evaluateG2PreCall({ ...dispatch(wrongModel), g2: ctx.g2, cwd: ctx.root, strictSession: true });
  assert.equal(v.allow, false);
  assert.match(v.reason, /requested_model must be exactly 'opus'/);
});

test('STRICT §3.2: a spent condition is still refused under strict mode', () => {
  const ctx = makeG2({ attempts: { [REF_A]: { attempt: 1 } } });
  const permit = writePermit(ctx);
  const v = evaluateG2PreCall({ ...dispatch(permit), g2: ctx.g2, cwd: ctx.root, strictSession: true });
  assert.equal(v.allow, false);
  assert.match(v.reason, /already spent\/claimed/);
});

test('MUTATION §3.2: disabling strict-session behaviour reopens the prose-only hole', () => {
  const ctx = makeG2();
  // Proves the strict flag — not some incidental check — is what closes the bypass.
  const denied = evaluateG2PreCall({ ...PROSE_ONLY, g2: ctx.g2, cwd: ctx.root, strictSession: true });
  const allowed = evaluateG2PreCall({ ...PROSE_ONLY, g2: ctx.g2, cwd: ctx.root, strictSession: false });
  assert.equal(denied.allow, false, 'strict mode must deny');
  assert.equal(allowed.allow, true, 'without strict mode the identical call wrongly passes');
});

test('STRICT §3.2: non-subagent tools are untouched by strict mode', () => {
  const ctx = makeG2();
  const v = evaluateG2PreCall({
    toolName: 'Edit',
    toolInput: { file_path: 'src/engine/extraction/g2d_finalizer.py' },
    g2: ctx.g2,
    cwd: ctx.root,
    strictSession: true,
  });
  assert.equal(v.allow, true);
  assert.equal(v.g2, false);
  assert.match(v.reason, /not a subagent dispatch/);
});
