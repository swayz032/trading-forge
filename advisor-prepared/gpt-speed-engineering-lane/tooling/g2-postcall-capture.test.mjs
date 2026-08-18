// AR-1303A section 6, AR-1304 section 6/8 controls for the G2-D post-call return-capture
// boundary (F30).
//
// EVERY artifact here is synthetic and lives in a temp dir. No control touches the real frozen
// queue, the real receipt directory, or spends/captures a real attempt.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  evaluatePostCallCapture,
  extractRawResponseText,
  defaultCapture,
  defaultCaptureLaunchAck,
} from './g2-postcall-capture.mjs';
import { loadG2Context, safeName, canonicalNativeCallSha256, SUBAGENT_TOOL_NAMES } from './g2-precall-guard.mjs';

const REF_A = 'entry_sequence[0].rationale';
const REF_B = 'entry_sequence[1].action';
const TASK_SHA_A = 'a'.repeat(64);
const TASK_SHA_B = 'b'.repeat(64);
const FROZEN_SUBAGENT_TYPE = 'general-purpose';

function makeG2() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g2postcall-'));
  const receiptDir = path.join(root, 'isolated-receipts-t1');
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, 'README.md'), 'synthetic\n');

  const queuePath = path.join(root, 'isolated_fallback_queue_t1.json');
  fs.writeFileSync(
    queuePath,
    JSON.stringify({
      law_version: 'isolated-fallback-law-v1',
      max_attempts_per_condition: 1,
      queue: [
        { condition_ref: REF_A, task_input_sha256: TASK_SHA_A },
        { condition_ref: REF_B, task_input_sha256: TASK_SHA_B },
      ],
      attempts: {},
    }, null, 2),
  );

  return { root, queuePath, receiptDir, g2: loadG2Context({ queuePath, receiptDir }) };
}

function toolInputFor(ref) {
  return {
    description: 'isolated G2-D call',
    prompt: `Answer the frozen condition ${ref}. G2D-PERMIT: /some/permit.json`,
    subagent_type: FROZEN_SUBAGENT_TYPE,
    model: 'opus',
  };
}

function nativeCallsFor(ctx, ref = REF_A) {
  const ti = toolInputFor(ref);
  return {
    manifestPath: '<synthetic>',
    queueArtifactSha256: ctx.g2.queueSha256,
    rows: new Map([[ref, {
      condition_ref: ref,
      task_input_sha256: ref === REF_A ? TASK_SHA_A : TASK_SHA_B,
      model: 'opus',
      subagent_type: FROZEN_SUBAGENT_TYPE,
      native_call_sha256: canonicalNativeCallSha256(ti),
    }]]),
  };
}

function plantDispatch(ctx, ref = REF_A) {
  fs.writeFileSync(path.join(ctx.receiptDir, `${safeName(ref)}.dispatch.json`), JSON.stringify({ state: 'NATIVE_TASK_DISPATCHED' }));
}

function fakeCapture(outcome = { ok: true, receipt: { state: 'RAW_RETURN_CAPTURED' } }) {
  const fn = (args) => { fn.calls.push(args); return typeof outcome === 'function' ? outcome(args) : outcome; };
  fn.calls = [];
  return fn;
}

// ---------------------------------------------------------------------------
// extractRawResponseText — AR-1305A: `tool_response` is a CONFIRMED field name (found verbatim
// in the shipped Claude Code binary's own embedded hook docs), but its Agent-tool sub-shape is
// not, so nothing here guesses a sub-field: the whole value is preserved losslessly.
// ---------------------------------------------------------------------------

test('extractRawResponseText: a plain string passes through unchanged', () => {
  assert.equal(extractRawResponseText('hello'), 'hello');
});

test('extractRawResponseText: an object is preserved WHOLE as canonical JSON, never a cherry-picked sub-field (a naive text-key guess would have silently dropped everything else)', () => {
  const out = extractRawResponseText({ text: 'the answer', extra_field_a_guess_would_drop: 'do-not-lose-me' });
  assert.match(out, /"text":"the answer"/);
  assert.match(out, /"extra_field_a_guess_would_drop":"do-not-lose-me"/);
});

test('extractRawResponseText: a content-block array is preserved WHOLE, not joined/flattened by a guessed convention', () => {
  const out = extractRawResponseText({ content: [{ text: 'a' }, { text: 'b' }] });
  assert.equal(out, JSON.stringify({ content: [{ text: 'a' }, { text: 'b' }] }));
});

test('extractRawResponseText: an unrecognized shape is serialized, never dropped', () => {
  const out = extractRawResponseText({ weird: 42 });
  assert.match(out, /"weird":42/);
});

// ---------------------------------------------------------------------------
// GATE — routing and resolution
// ---------------------------------------------------------------------------

test('POSITIVE: non-subagent tool is not handled', () => {
  const ctx = makeG2();
  const r = evaluatePostCallCapture({ toolName: 'Edit', toolInput: {}, toolResponse: 'x', g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx) });
  assert.equal(r.handled, false);
});

test('POSITIVE: a call matching no frozen row is not handled (ordinary non-G2 subagent use is untouched)', () => {
  const ctx = makeG2();
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: { prompt: 'summarize the README' }, toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx),
  });
  assert.equal(r.handled, false);
});

test('POSITIVE: a dispatched G2 row with a matching post-call event records a LAUNCH ACK, never a final capture (F36) -- captureLaunchAck receives the exact response as ackPayload', () => {
  const ctx = makeG2();
  plantDispatch(ctx, REF_A);
  const cap = fakeCapture({ ok: true, receipt: { state: 'ASYNC_LAUNCH_ACK_RECORDED' } });
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: { isAsync: true, status: 'async_launched', agentId: 'agent-1' },
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), captureLaunchAck: cap,
  });
  assert.equal(r.handled, true);
  assert.equal(r.captured, false, 'F36: PostToolUse must never claim a final capture');
  assert.equal(r.launchAck, true, r.reason);
  assert.equal(r.block, false);
  assert.equal(cap.calls.length, 1);
  assert.equal(cap.calls[0].conditionRef, REF_A);
  assert.deepEqual(cap.calls[0].ackPayload, { isAsync: true, status: 'async_launched', agentId: 'agent-1' });
});

// ---------------------------------------------------------------------------
// NEGATIVE — every shape AR-1304 section 8's post-call checklist names
// ---------------------------------------------------------------------------

test('NEGATIVE: no prior dispatch is refused, captureLaunchAck is never invoked', () => {
  const ctx = makeG2(); // no plantDispatch
  const cap = fakeCapture();
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), captureLaunchAck: cap,
  });
  assert.equal(r.handled, true);
  assert.equal(r.captured, false);
  assert.match(r.reason, /no prior dispatch/);
  assert.equal(cap.calls.length, 0);
});

test('NEGATIVE: a second post-tool event for an already-finalized row is refused, captureLaunchAck is never invoked', () => {
  const ctx = makeG2();
  plantDispatch(ctx, REF_A);
  fs.writeFileSync(path.join(ctx.receiptDir, `${safeName(REF_A)}.raw.json`), '{}');
  fs.writeFileSync(path.join(ctx.receiptDir, `${safeName(REF_A)}.completion.json`), '{}');
  const cap = fakeCapture();
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'a second answer',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), captureLaunchAck: cap,
  });
  assert.equal(r.captured, false);
  assert.match(r.reason, /already has a captured raw return/);
  assert.equal(cap.calls.length, 0);
});

test('NEGATIVE: response for a different condition only ever resolves and acks that condition, never REF_A by accident', () => {
  const ctx = makeG2();
  plantDispatch(ctx, REF_A);
  plantDispatch(ctx, REF_B);
  const cap = fakeCapture({ ok: true, receipt: { state: 'ASYNC_LAUNCH_ACK_RECORDED' } });
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_B), toolResponse: 'answer for B',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_B), captureLaunchAck: cap,
  });
  assert.equal(r.launchAck, true, r.reason);
  assert.equal(cap.calls[0].conditionRef, REF_B);
});

test('NEGATIVE: no native-call manifest loaded means nothing is handled (fail-closed, but as "not this doorway\'s business")', () => {
  const ctx = makeG2();
  plantDispatch(ctx, REF_A);
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: null,
  });
  assert.equal(r.handled, false);
});

test('NEGATIVE: a manifest frozen against a different queue is refused', () => {
  const ctx = makeG2();
  plantDispatch(ctx, REF_A);
  const nc = nativeCallsFor(ctx, REF_A);
  nc.queueArtifactSha256 = 'f'.repeat(64);
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nc,
  });
  assert.equal(r.handled, false);
});

test('NEGATIVE: launch-ack doorway refusal is surfaced, not silently swallowed', () => {
  const ctx = makeG2();
  plantDispatch(ctx, REF_A);
  const cap = fakeCapture({ ok: false, error: 'malformed launch-ack payload' });
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), captureLaunchAck: cap,
  });
  assert.equal(r.captured, false);
  assert.equal(r.launchAck, undefined);
  assert.equal(r.block, true);
  assert.match(r.reason, /async launch ack refused: malformed launch-ack payload/);
});

// ---------------------------------------------------------------------------
// MUTATION — proves the dispatch-state check is load-bearing
// ---------------------------------------------------------------------------

test('MUTATION: without the dispatch-existence check, an undispatched row would be captured; the real gate refuses it', () => {
  const ctx = makeG2(); // no plantDispatch
  const cap = fakeCapture();

  // Unchecked stand-in reproducing what a broken gate would do: route straight to capture.
  function unchecked() { return { handled: true, captured: true, viaCapture: cap({ conditionRef: REF_A }) }; }
  const naive = unchecked();
  assert.equal(cap.calls.length, 1, 'the naive stand-in DOES invoke capture for an undispatched row');

  cap.calls.length = 0;
  const real = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), captureLaunchAck: cap,
  });
  assert.equal(real.captured, false);
  assert.equal(cap.calls.length, 0, 'the real, checked gate never invokes captureLaunchAck for an undispatched row');
});

// ---------------------------------------------------------------------------
// AR-1305A F35 — STRICT-SESSION FAIL-CLOSED SEMANTICS
//
// Outside strict G2, an unresolvable PostToolUse event is ordinary unrelated Agent use and
// stays untouched (handled:false). Inside strict G2, the identical unresolvable event is an
// anomaly that must not silently pass through. Once a call IS resolved to a frozen row, every
// remaining anomaly is block:true unconditionally -- strict or not, because the match itself is
// the proof of G2-ness.
// ---------------------------------------------------------------------------

test('F35 NON-STRICT: no manifest loaded stays handled:false (unrelated Agent use untouched)', () => {
  const ctx = makeG2();
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: null, strictSession: false,
  });
  assert.equal(r.handled, false);
  assert.equal(r.block, undefined);
});

test('F35 STRICT: the IDENTICAL no-manifest event becomes handled:true, block:true, captured:false', () => {
  const ctx = makeG2();
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: null, strictSession: true,
  });
  assert.equal(r.handled, true);
  assert.equal(r.captured, false);
  assert.equal(r.block, true);
  assert.match(r.reason, /strict G2 session/);
});

test('F35 NON-STRICT: a queue-mismatched manifest stays handled:false', () => {
  const ctx = makeG2();
  const nc = nativeCallsFor(ctx, REF_A);
  nc.queueArtifactSha256 = 'f'.repeat(64);
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nc, strictSession: false,
  });
  assert.equal(r.handled, false);
});

test('F35 STRICT: a queue-mismatched manifest becomes block:true', () => {
  const ctx = makeG2();
  const nc = nativeCallsFor(ctx, REF_A);
  nc.queueArtifactSha256 = 'f'.repeat(64);
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nc, strictSession: true,
  });
  assert.equal(r.handled, true);
  assert.equal(r.block, true);
});

test('F35 NON-STRICT: a call matching no frozen row (ordinary Agent use) stays handled:false', () => {
  const ctx = makeG2();
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: { prompt: 'summarize the README' }, toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), strictSession: false,
  });
  assert.equal(r.handled, false);
});

test('F35 STRICT: the IDENTICAL unmatched call becomes block:true (every Agent/Task return inside the dedicated session must join to one of the eight)', () => {
  const ctx = makeG2();
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: { prompt: 'summarize the README' }, toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), strictSession: true,
  });
  assert.equal(r.handled, true);
  assert.equal(r.captured, false);
  assert.equal(r.block, true);
});

test('F35: once resolved to a frozen row, "no prior dispatch" is block:true REGARDLESS of strict mode', () => {
  const ctx = makeG2(); // no plantDispatch
  for (const strictSession of [true, false]) {
    const r = evaluatePostCallCapture({
      toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
      g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), strictSession,
    });
    assert.equal(r.handled, true, `strictSession=${strictSession}`);
    assert.equal(r.block, true, `strictSession=${strictSession}`);
  }
});

test('F35: once resolved to a frozen row, a successful launch ack is block:false REGARDLESS of strict mode (never captured:true -- F36)', () => {
  const ctx = makeG2();
  plantDispatch(ctx, REF_A);
  for (const strictSession of [true, false]) {
    const cap = fakeCapture({ ok: true, receipt: { state: 'ASYNC_LAUNCH_ACK_RECORDED' } });
    const r = evaluatePostCallCapture({
      toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: { isAsync: true, status: 'async_launched', agentId: 'agent-1' },
      g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), strictSession, captureLaunchAck: cap,
    });
    assert.equal(r.launchAck, true, `strictSession=${strictSession}`);
    assert.equal(r.captured, false, `strictSession=${strictSession}: F36 -- launch ack is never a final capture`);
    assert.equal(r.block, false, `strictSession=${strictSession}`);
    // Nothing to reset: the fake captureLaunchAck never touches the filesystem, and a launch ack
    // never creates .raw.json/.completion.json, so the dispatch-only gate state is unchanged
    // going into the next loop iteration.
  }
});

test('F35 MUTATION: a bridge that ignored the strict-session upgrade would treat an unresolvable event as handled:false even inside strict G2; the real gate refuses to stay silent', () => {
  const ctx = makeG2();
  // Unchecked stand-in: identical to evaluatePostCallCapture's shape but WITHOUT the strict
  // upgrade -- exactly the pre-F35 behaviour.
  function withoutStrictUpgrade({ nativeCalls: nc }) {
    if (!nc) return { handled: false, reason: 'no frozen native-call identity manifest is loaded' };
    return { handled: true };
  }
  const naive = withoutStrictUpgrade({ nativeCalls: null });
  assert.equal(naive.handled, false, 'the naive stand-in silently passes an unresolvable event through even conceptually inside strict G2');

  const real = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: null, strictSession: true,
  });
  assert.equal(real.handled, true);
  assert.equal(real.block, true, 'the real, strict-aware gate refuses to stay silent');
});

// =========================================================================================
// AR-1305A F32 item 6 — REGISTRATION PARITY for the NEW PostToolUse route.
//
// Mirrors the existing PreToolUse parity control in g2-precall-guard.test.mjs exactly: a
// correct evaluatePostCallCapture() that the installed PostToolUse matcher never routes to is
// not a guard, and every synthetic test above would still pass while the real handshake stayed
// broken -- the exact "two green halves are not a handshake" shape AR-1305A convicted.
// =========================================================================================

test('REGISTRATION PARITY: every subagent tool the post-call gate covers appears in the PostToolUse matcher', () => {
  const fragmentPath = path.resolve(import.meta.dirname, '..', 'claude-hooks', 'settings.fragment.json');
  const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));
  const postToolUse = fragment.hooks.PostToolUse;
  assert.ok(postToolUse, 'no PostToolUse registration exists in the settings fragment at all -- F30/F35 code exists with no route to reach it');
  assert.equal(postToolUse.length, 1, 'expected exactly one PostToolUse registration to reason about');

  const matcher = postToolUse[0].matcher;
  const registered = new Set(matcher.split('|'));

  for (const tool of SUBAGENT_TOOL_NAMES) {
    assert(
      registered.has(tool),
      `the post-call gate covers subagent tool '${tool}' but the installed PostToolUse matcher (${matcher}) does not register it -- the gate would never see the return`,
    );
  }
});

test('MUTATION: narrowing the PostToolUse matcher to drop Task makes the parity control RED', () => {
  const fragmentPath = path.resolve(import.meta.dirname, '..', 'claude-hooks', 'settings.fragment.json');
  const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));
  const narrowedMatcher = fragment.hooks.PostToolUse[0].matcher.split('|').filter((t) => t !== 'Task').join('|');
  const registered = new Set(narrowedMatcher.split('|'));
  let caught = false;
  for (const tool of SUBAGENT_TOOL_NAMES) {
    if (!registered.has(tool)) { caught = true; break; }
  }
  assert.equal(caught, true, 'narrowing the matcher must be something the parity control would actually notice');
});

// ---------------------------------------------------------------------------
// INTEGRATION — defaultCapture actually shells out to the real Python doorway
//
// Points repoRoot at the sibling worker worktree, where scripts/g2d_postcall_capture.py and
// its own already-red-proofed pytest suite live (this toolbox branch does not carry the
// application's Python tree). Skips gracefully if that worktree is not present, rather than
// failing the whole suite on a path this branch does not own.
// ---------------------------------------------------------------------------

const WORKER_TREE = 'C:\\Users\\tonio\\Projects\\wt-claude-worker1-20260815';
const HAS_WORKER_TREE = fs.existsSync(path.join(WORKER_TREE, 'scripts', 'g2d_postcall_capture.py'));

/**
 * The real `DurableAttemptLedger.load()` requires a queue produced by
 * `isolated_fallback_law.freeze_isolated_queue` (it carries `substitution_rule` +
 * `substitution_rule_sha256`, which a hand-typed JSON object omits). Shelling out to the real
 * law to build the fixture -- rather than hand-rolling a JSON object that merely looks like a
 * queue -- is the same "fewest layers between you and the thing" discipline the rest of this
 * campaign already applies; a hand-built fixture that silently drifts from the real schema is
 * exactly the failure this integration test exists to catch, so it must not build its own.
 */
function makeRealLawQueue() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g2postcall-int-'));
  const receiptDir = path.join(root, 'isolated-receipts-t1');
  fs.mkdirSync(receiptDir, { recursive: true });
  const queuePath = path.join(root, 'isolated_fallback_queue_t1.json');
  const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(WORKER_TREE)})
from src.engine.extraction import isolated_fallback_law as law
record = {
    "route_version": "opus-phase1-route-v2",
    "outcomes": [{"condition_ref": "entry_sequence[0].rationale", "disposition": "REFUSED_RELEVANCE", "gate": "g", "reason": "r"}],
}
pinned = {"transcript_sha256": "a" * 64, "extraction_sha256": "b" * 64}
texts = {"entry_sequence[0].rationale": "Wait for a close outside of the range."}
q = law.freeze_isolated_queue(record, pinned, texts).as_dict()
print(json.dumps(q))
`.trim();
  const res = spawnSync(process.env.TF_PYTHON || 'python', ['-c', py], { encoding: 'utf8', cwd: WORKER_TREE });
  if (res.status !== 0) throw new Error(`could not build a real-law queue fixture: ${res.stderr}`);
  const queue = JSON.parse(res.stdout);
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  return { root, queuePath, receiptDir, ref: queue.queue[0].condition_ref };
}

/** Runs the REAL F29 precall-transition doorway to produce a genuine .attempt + .dispatch pair
 *  -- not a hand-planted stand-in -- so this integration test exercises the actual F29-then-F30
 *  sequence a real dispatch would produce. */
function realClaimAndDispatch(rig) {
  const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(WORKER_TREE)})
from src.engine.extraction.isolated_attempt_receipt import DurableAttemptLedger
from src.engine.extraction.isolated_bridge import record_native_dispatch
led = DurableAttemptLedger.load(${JSON.stringify(rig.queuePath)}, ${JSON.stringify(rig.receiptDir)})
sha = next(e["task_input_sha256"] for e in led.queue["queue"] if e["condition_ref"] == ${JSON.stringify(rig.ref)})
led.claim_attempt(${JSON.stringify(rig.ref)}, sha)
record_native_dispatch(led, ${JSON.stringify(rig.ref)})
`.trim();
  const res = spawnSync(process.env.TF_PYTHON || 'python', ['-c', py], { encoding: 'utf8', cwd: WORKER_TREE });
  if (res.status !== 0) throw new Error(`could not claim+dispatch for the integration fixture: ${res.stderr}`);
}

test('INTEGRATION: defaultCapture shells out to the real doorway and the guard-side temp files are cleaned up either way', { skip: !HAS_WORKER_TREE && 'sibling worker worktree with g2d_postcall_capture.py not present' }, () => {
  const rig = makeRealLawQueue();
  realClaimAndDispatch(rig);
  const before = fs.readdirSync(rig.receiptDir).length;
  const result = defaultCapture({
    repoRoot: WORKER_TREE,
    queuePath: rig.queuePath,
    receiptDir: rig.receiptDir,
    conditionRef: rig.ref,
    rawOutput: 'a real end-to-end answer',
    completion: { input_tokens: 10, output_tokens: 20 },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.receipt.state, 'RAW_RETURN_CAPTURED');
  // Exactly two new files (.raw.json + .completion.json) survive; the .tmp handoff files do not.
  const after = fs.readdirSync(rig.receiptDir);
  assert.equal(after.length, before + 2, after.join(','));
  assert.ok(after.every((f) => !f.includes('.tmp')), 'no temp handoff file leaked into the receipt dir');
});

// ---------------------------------------------------------------------------
// AR-1315A §5 Lane B / Lane D — INTEGRATION for the F36 launch-ack doorway against the REAL
// scripts/g2d_postcall_lifecycle.py in the sibling Worker-1 worktree (AR-1315A §5 Lane A).
// ---------------------------------------------------------------------------

const HAS_LIFECYCLE_DOORWAY = fs.existsSync(path.join(WORKER_TREE, 'scripts', 'g2d_postcall_lifecycle.py'));

test('INTEGRATION: defaultCaptureLaunchAck shells out to the real F36 doorway -- ack recorded, row NEVER reaches .raw/.completion, temp files cleaned up', {
  skip: !HAS_LIFECYCLE_DOORWAY && 'sibling worker worktree with g2d_postcall_lifecycle.py not present',
}, () => {
  const rig = makeRealLawQueue();
  realClaimAndDispatch(rig);
  const before = fs.readdirSync(rig.receiptDir).length;
  const ackPayload = { isAsync: true, status: 'async_launched', agentId: 'agent-real-int-1' };
  const result = defaultCaptureLaunchAck({
    repoRoot: WORKER_TREE,
    queuePath: rig.queuePath,
    receiptDir: rig.receiptDir,
    conditionRef: rig.ref,
    ackPayload,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.receipt.state, 'ASYNC_LAUNCH_ACK_RECORDED');
  assert.equal(result.receipt.note, 'row remains NATIVE_TASK_DISPATCHED; capture_native_return was NOT called');

  const after = fs.readdirSync(rig.receiptDir);
  assert.equal(after.length, before + 1, after.join(','));
  assert.ok(after.some((f) => f.endsWith('.launch_ack.json')), 'a launch_ack receipt was written');
  assert.ok(after.every((f) => !f.endsWith('.raw.json') && !f.endsWith('.completion.json')), 'F36: a launch ack must never produce .raw/.completion');
  assert.ok(after.every((f) => !f.includes('.tmp')), 'no temp handoff file leaked into the receipt dir');
});

test('INTEGRATION: defaultCaptureLaunchAck refuses a payload missing the documented async-launch shape, real doorway, real refusal text', {
  skip: !HAS_LIFECYCLE_DOORWAY && 'sibling worker worktree with g2d_postcall_lifecycle.py not present',
}, () => {
  const rig = makeRealLawQueue();
  realClaimAndDispatch(rig);
  const before = fs.readdirSync(rig.receiptDir).length;
  const result = defaultCaptureLaunchAck({
    repoRoot: WORKER_TREE,
    queuePath: rig.queuePath,
    receiptDir: rig.receiptDir,
    conditionRef: rig.ref,
    ackPayload: { success: true, result: 'this looks like a final answer, not a launch ack' },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /async-launch-ack shape/);
  const after = fs.readdirSync(rig.receiptDir);
  assert.equal(after.length, before, 'an unknown shape must fail closed and write nothing');
});
