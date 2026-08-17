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
  canonicalNativeCallSha256,
  permitPathFor,
  materializePermitIfNeeded,
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
//
// AR-1267 §6 — the actual call now also has to BE the frozen call. `model` and `subagent_type`
// are part of a real dispatch, and the prompt is hash-bound, so the helper composes the exact
// shape the synthetic native-call manifest below freezes. The previous helper omitted `model`
// entirely, and the two tests that used it went RED the moment the binding landed: the call
// they called "authorized" was one whose model was inherited rather than requested.
const FROZEN_SUBAGENT_TYPE = 'general-purpose';

function promptFor(permitPath, ref) {
  return `Answer the frozen condition ${ref}. G2D-PERMIT: ${permitPath}`;
}

function dispatch(permitPath, ref = REF_A, extra = {}) {
  return {
    toolName: 'Agent',
    toolInput: {
      description: 'isolated G2-D call',
      prompt: promptFor(permitPath, ref),
      subagent_type: FROZEN_SUBAGENT_TYPE,
      model: 'opus',
      ...extra,
    },
  };
}

/** The frozen native-call identity for this synthetic ctx. COMPUTED with the guard's own
 *  canonicaliser — a hand-copied expected hash would embalm a dead number and stop bitings. */
function nativeCallsFor(ctx, permitPath, ref = REF_A, overrides = {}) {
  const toolInput = dispatch(permitPath, ref).toolInput;
  return {
    manifestPath: '<synthetic>',
    queueArtifactSha256: ctx.g2.queueSha256,
    rows: new Map([[ref, {
      condition_ref: ref,
      task_input_sha256: ref === REF_A ? TASK_SHA_A : TASK_SHA_B,
      model: 'opus',
      subagent_type: FROZEN_SUBAGENT_TYPE,
      native_call_sha256: canonicalNativeCallSha256(toolInput),
      ...overrides,
    }]]),
  };
}

/** A transition stub. The real one shells out to the protected Python doorway; these controls
 *  must never touch the real durable law, so the stub records that it was asked and what with.
 *  `calls` is asserted on directly — "the guard allowed" and "the guard claimed first" are two
 *  different claims and this keeps them separable. */
function fakeTransition(outcome = { ok: true }) {
  const fn = (args) => { fn.calls.push(args); return typeof outcome === 'function' ? outcome(args) : outcome; };
  fn.calls = [];
  return fn;
}

function run(ctx, call, opts = {}) {
  const permitPath = opts.permitPath ?? null;
  return evaluateG2PreCall({
    ...call,
    g2: ctx.g2,
    cwd: ctx.root,
    nativeCalls: opts.nativeCalls ?? (permitPath ? nativeCallsFor(ctx, permitPath, opts.ref ?? REF_A) : null),
    transition: opts.transition ?? fakeTransition(),
    ...opts.evaluate,
  });
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
  const moved = fakeTransition();
  const r = run(ctx, dispatch(permit), { permitPath: permit, transition: moved });
  assert.equal(r.allow, true, r.reason);
  assert.equal(r.g2, true);
  // AR-1267 §5: the ALLOW is the transition. A POSITIVE WITNESS that the claim->dispatch path
  // actually ran — "allow" alone is satisfied by a guard that skipped it.
  assert.equal(r.transitioned, true);
  assert.equal(moved.calls.length, 1);
  assert.equal(moved.calls[0].conditionRef, REF_A);
  assert.equal(moved.calls[0].taskInputSha256, TASK_SHA_A);
  // and the GUARD itself still writes nothing into the receipt directory — the durable law does.
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
  // AR-1304 (F29): an absent permit is no longer automatically "unreadable" — it is first
  // offered to materialization. A path that could never be materialized (it names a file
  // outside the receipt dir, at no derivable condition) still ends up denied before the file
  // read, but for a different, EARLIER reason (no frozen row matches the arbitrary path). To
  // keep testing the specific "unreadable file" branch this test names, supply a manifest so
  // the call clears materialization and falls through to the original read.
  const ctx = makeG2();
  const missing = path.join(ctx.root, 'does-not-exist.json');
  const r = run(ctx, dispatch(missing), { nativeCalls: nativeCallsFor(ctx, missing) });
  assert.equal(r.allow, false);
  assert.match(r.reason, /frozen derivation|permit unreadable/);
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
  const v = run(ctx, dispatch(permit), { permitPath: permit, evaluate: { strictSession: true } });
  assert.equal(v.allow, true, v.reason);
  assert.equal(v.g2, true);
  assert.equal(v.transitioned, true);
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

// ---------------------------------------------------------------------------
// AR-1304 section 5 (F29) -- HOOK-OWNED EXACT PERMIT MATERIALIZATION
//
// EVERY artifact here is synthetic. No control touches the real frozen queue or receipt
// namespace, matching the discipline of every test above.
// ---------------------------------------------------------------------------

test('F29 POSITIVE: a G2-shaped call with no existing permit is materialized, then reaches ALLOW through the unchanged validation+transition path', () => {
  const ctx = makeG2();
  const permitPath = permitPathFor(ctx.receiptDir, REF_A);
  assert.equal(fs.existsSync(permitPath), false, 'precondition: no permit exists yet');

  const moved = fakeTransition();
  const nativeCalls = nativeCallsFor(ctx, permitPath, REF_A);
  const r = run(ctx, dispatch(permitPath, REF_A), { permitPath, nativeCalls, transition: moved });

  assert.equal(r.allow, true, r.reason);
  assert.equal(r.g2, true);
  assert.equal(r.transitioned, true, 'ALLOW must still be the transition, materialization is not a shortcut around it');
  assert.equal(moved.calls.length, 1, 'claim->dispatch ran exactly once, AFTER materialization');
  assert.equal(moved.calls[0].conditionRef, REF_A);

  assert.equal(fs.existsSync(permitPath), true, 'the guard materialized the permit file');
  const written = JSON.parse(fs.readFileSync(permitPath, 'utf8'));
  assert.equal(written.schema, G2_PERMIT_SCHEMA);
  assert.equal(written.condition_ref, REF_A);
  assert.equal(written.queue_artifact_sha256, ctx.g2.queueSha256);
  assert.equal(written.task_input_sha256, TASK_SHA_A);
  assert.equal(written.requested_model, 'opus');
  assert.equal(written.attempt, 1);
});

test('F29 POSITIVE: materialization writes exactly one permit file, nothing else in the receipt dir', () => {
  const ctx = makeG2();
  const permitPath = permitPathFor(ctx.receiptDir, REF_A);
  const nativeCalls = nativeCallsFor(ctx, permitPath, REF_A);
  run(ctx, dispatch(permitPath, REF_A), { permitPath, nativeCalls, transition: fakeTransition() });
  assert.deepEqual(
    fs.readdirSync(ctx.receiptDir).sort(),
    ['README.md', path.basename(permitPath)].sort(),
    'the guard writes ONLY the permit; .attempt/.dispatch remain the durable law\'s job',
  );
});

test('F29 NEGATIVE: a call whose canonical hash matches no frozen row is denied, no permit materialized', () => {
  const ctx = makeG2();
  const permitPath = permitPathFor(ctx.receiptDir, REF_A);
  const nativeCalls = nativeCallsFor(ctx, permitPath, REF_A);
  const call = dispatch(permitPath, REF_A, { prompt: promptFor(permitPath, REF_A) + ' Also consider a second source.' });
  const r = run(ctx, call, { permitPath, nativeCalls, transition: fakeTransition() });
  assert.equal(r.allow, false);
  assert.match(r.reason, /no frozen native-call row matches this exact call/);
  assert.equal(fs.existsSync(permitPath), false, 'a call that matches no frozen row must never materialize a permit');
});

test('F29 NEGATIVE: Sonnet/Haiku requested model is denied before materialization, no permit written', () => {
  const ctx = makeG2();
  for (const model of ['sonnet', 'haiku']) {
    const permitPath = permitPathFor(ctx.receiptDir, REF_A);
    const nativeCalls = nativeCallsFor(ctx, permitPath, REF_A, { model });
    const call = dispatch(permitPath, REF_A, { model });
    const r = run(ctx, call, { permitPath, nativeCalls, transition: fakeTransition() });
    assert.equal(r.allow, false, `model '${model}' must be refused`);
    assert.match(r.reason, /requests model '.*', not 'opus'/);
    assert.equal(fs.existsSync(permitPath), false);
  }
});

test('F29 NEGATIVE: wrong subagent_type is denied before materialization, no permit written', () => {
  // subagent_type is one of the three fields canonicalNativeCallSha256 hashes, so changing it
  // already changes the hash away from any frozen row -- the same "no frozen row matches"
  // denial that a changed prompt produces (covered above). That IS the enforcement; the guard
  // never reaches a state where the hash matches but subagent_type still differs.
  const ctx = makeG2();
  const permitPath = permitPathFor(ctx.receiptDir, REF_A);
  const nativeCalls = nativeCallsFor(ctx, permitPath, REF_A);
  const call = dispatch(permitPath, REF_A, { subagent_type: 'fork' });
  const r = run(ctx, call, { permitPath, nativeCalls, transition: fakeTransition() });
  assert.equal(r.allow, false);
  assert.match(r.reason, /no frozen native-call row matches this exact call/);
  assert.equal(fs.existsSync(permitPath), false);
});

test('F29 NEGATIVE: a permit marker naming any path other than the frozen derivation is denied, no file written at either path', () => {
  const ctx = makeG2();
  const wrongPath = path.join(ctx.root, 'anywhere-i-like.json');
  const nativeCalls = nativeCallsFor(ctx, wrongPath, REF_A);
  const r = run(ctx, dispatch(wrongPath, REF_A), { permitPath: wrongPath, nativeCalls, transition: fakeTransition() });
  assert.equal(r.allow, false);
  assert.match(r.reason, /frozen derivation for .* is/);
  assert.equal(fs.existsSync(wrongPath), false);
  assert.equal(fs.existsSync(permitPathFor(ctx.receiptDir, REF_A)), false);
});

test('F29 NEGATIVE: an already-spent condition (queue witness) is denied, no permit materialized', () => {
  const ctx = makeG2({ attempts: { [REF_A]: { attempt: 1 } } });
  const permitPath = permitPathFor(ctx.receiptDir, REF_A);
  const nativeCalls = nativeCallsFor(ctx, permitPath, REF_A);
  const r = run(ctx, dispatch(permitPath, REF_A), { permitPath, nativeCalls, transition: fakeTransition() });
  assert.equal(r.allow, false);
  assert.match(r.reason, /already spent\/claimed/);
  assert.equal(fs.existsSync(permitPath), false);
});

test('F29 NEGATIVE: an already-spent condition (receipt-file witness) is denied, no permit materialized', () => {
  const ctx = makeG2({ receipts: [`${safeName(REF_A)}.attempt.json`] });
  const permitPath = permitPathFor(ctx.receiptDir, REF_A);
  const nativeCalls = nativeCallsFor(ctx, permitPath, REF_A);
  const r = run(ctx, dispatch(permitPath, REF_A), { permitPath, nativeCalls, transition: fakeTransition() });
  assert.equal(r.allow, false);
  assert.match(r.reason, /already spent\/claimed/);
  assert.equal(fs.existsSync(permitPath), false);
});

test('F29 NEGATIVE: no native-call manifest loaded means no materialization is possible', () => {
  // NOTE: called directly, not via the run() helper -- run()'s `opts.nativeCalls ?? fallback`
  // treats an explicit `null` the same as "not provided" and would silently substitute a real
  // manifest, defeating exactly what this test needs to prove.
  const ctx = makeG2();
  const permitPath = permitPathFor(ctx.receiptDir, REF_A);
  const r = evaluateG2PreCall({
    ...dispatch(permitPath, REF_A),
    g2: ctx.g2,
    cwd: ctx.root,
    nativeCalls: null,
    transition: fakeTransition(),
  });
  assert.equal(r.allow, false);
  assert.match(r.reason, /no frozen native-call identity manifest is loaded/);
  assert.equal(fs.existsSync(permitPath), false);
});

test('F29 POSITIVE: a permit that already exists is read and validated, never overwritten', () => {
  const ctx = makeG2();
  const permitPath = permitPathFor(ctx.receiptDir, REF_A);
  fs.mkdirSync(path.dirname(permitPath), { recursive: true });
  const preplaced = {
    schema: G2_PERMIT_SCHEMA, condition_ref: REF_A, queue_artifact_sha256: ctx.g2.queueSha256,
    task_input_sha256: TASK_SHA_A, requested_model: 'opus', attempt: 1, _preplaced_marker: 'do-not-touch',
  };
  fs.writeFileSync(permitPath, JSON.stringify(preplaced));
  const beforeMtime = fs.statSync(permitPath).mtimeMs;

  const nativeCalls = nativeCallsFor(ctx, permitPath, REF_A);
  const r = run(ctx, dispatch(permitPath, REF_A), { permitPath, nativeCalls, transition: fakeTransition() });

  assert.equal(r.allow, true, r.reason);
  const after = JSON.parse(fs.readFileSync(permitPath, 'utf8'));
  assert.equal(after._preplaced_marker, 'do-not-touch', 'a pre-existing permit must never be overwritten');
  assert.equal(fs.statSync(permitPath).mtimeMs, beforeMtime, 'mtime unchanged -- no write occurred');
});

test('F29 MUTATION: proves the permit-path derivation check is load-bearing by first reproducing the bypass without it, then showing the real function refuses it', () => {
  const ctx = makeG2();
  const attackerPath = path.join(ctx.root, 'attacker-chosen.json');
  const nativeCalls = nativeCallsFor(ctx, attackerPath, REF_A);

  function materializeWithoutPathCheck({ g2, toolInput, actualModel, permitPath: reqPath, nativeCalls: nc }) {
    if (fs.existsSync(reqPath)) return { materialized: false };
    const actualSha = canonicalNativeCallSha256(toolInput);
    let row = null;
    for (const r of nc.rows.values()) { if (r.native_call_sha256 === actualSha) { row = r; break; } }
    if (!row || actualModel !== 'opus') return { materialized: false, denyReason: 'setup' };
    const entry = g2.entries.get(row.condition_ref);
    fs.writeFileSync(reqPath, JSON.stringify({
      schema: G2_PERMIT_SCHEMA, queue_artifact_sha256: g2.queueSha256, condition_ref: row.condition_ref,
      task_input_sha256: entry.task_input_sha256, requested_model: 'opus', attempt: 1,
    }, null, 2), { flag: 'wx' });
    return { materialized: true };
  }
  const unchecked = materializeWithoutPathCheck({
    g2: ctx.g2, toolInput: dispatch(attackerPath, REF_A).toolInput, actualModel: 'opus',
    permitPath: attackerPath, nativeCalls,
  });
  assert.equal(unchecked.materialized, true, 'the unchecked stand-in DOES materialize at the attacker path (proves the scenario is reachable)');
  assert.equal(fs.existsSync(attackerPath), true);

  fs.rmSync(attackerPath);
  const real = materializePermitIfNeeded({
    g2: ctx.g2, toolInput: dispatch(attackerPath, REF_A).toolInput, actualModel: 'opus',
    permitPath: attackerPath, nativeCalls,
  });
  assert.equal(real.materialized, false);
  assert.match(real.denyReason, /frozen derivation/);
  assert.equal(fs.existsSync(attackerPath), false, 'the real, checked function refuses to write at the attacker path');
});
