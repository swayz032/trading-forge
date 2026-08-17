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
} from './g2-postcall-capture.mjs';
import { loadG2Context, safeName, canonicalNativeCallSha256 } from './g2-precall-guard.mjs';

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
// extractRawResponseText — the honestly-flagged schema-guess boundary
// ---------------------------------------------------------------------------

test('extractRawResponseText: a plain string passes through unchanged', () => {
  assert.equal(extractRawResponseText('hello'), 'hello');
});

test('extractRawResponseText: an object with a text field extracts the text', () => {
  assert.equal(extractRawResponseText({ text: 'the answer' }), 'the answer');
});

test('extractRawResponseText: a content-block array joins its text parts', () => {
  assert.equal(extractRawResponseText({ content: [{ text: 'a' }, { text: 'b' }] }), 'ab');
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

test('POSITIVE: a dispatched G2 row with a matching post-call event is captured, capture receives the exact raw text', () => {
  const ctx = makeG2();
  plantDispatch(ctx, REF_A);
  const cap = fakeCapture();
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'the verbatim answer',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), capture: cap,
  });
  assert.equal(r.handled, true);
  assert.equal(r.captured, true, r.reason);
  assert.equal(cap.calls.length, 1);
  assert.equal(cap.calls[0].conditionRef, REF_A);
  assert.equal(cap.calls[0].rawOutput, 'the verbatim answer');
});

// ---------------------------------------------------------------------------
// NEGATIVE — every shape AR-1304 section 8's post-call checklist names
// ---------------------------------------------------------------------------

test('NEGATIVE: no prior dispatch is refused, capture is never invoked', () => {
  const ctx = makeG2(); // no plantDispatch
  const cap = fakeCapture();
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), capture: cap,
  });
  assert.equal(r.handled, true);
  assert.equal(r.captured, false);
  assert.match(r.reason, /no prior dispatch/);
  assert.equal(cap.calls.length, 0);
});

test('NEGATIVE: a second post-tool event for an already-captured row is refused, capture is never invoked', () => {
  const ctx = makeG2();
  plantDispatch(ctx, REF_A);
  fs.writeFileSync(path.join(ctx.receiptDir, `${safeName(REF_A)}.raw.json`), '{}');
  fs.writeFileSync(path.join(ctx.receiptDir, `${safeName(REF_A)}.completion.json`), '{}');
  const cap = fakeCapture();
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'a second answer',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), capture: cap,
  });
  assert.equal(r.captured, false);
  assert.match(r.reason, /already has a captured raw return/);
  assert.equal(cap.calls.length, 0);
});

test('NEGATIVE: response for a different condition only ever resolves and captures that condition, never REF_A by accident', () => {
  const ctx = makeG2();
  plantDispatch(ctx, REF_A);
  plantDispatch(ctx, REF_B);
  const cap = fakeCapture();
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_B), toolResponse: 'answer for B',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_B), capture: cap,
  });
  assert.equal(r.captured, true, r.reason);
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

test('NEGATIVE: capture doorway refusal is surfaced, not silently swallowed', () => {
  const ctx = makeG2();
  plantDispatch(ctx, REF_A);
  const cap = fakeCapture({ ok: false, error: 'malformed completion metadata' });
  const r = evaluatePostCallCapture({
    toolName: 'Agent', toolInput: toolInputFor(REF_A), toolResponse: 'x',
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), capture: cap,
  });
  assert.equal(r.captured, false);
  assert.match(r.reason, /capture refused: malformed completion metadata/);
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
    g2: ctx.g2, cwd: ctx.root, nativeCalls: nativeCallsFor(ctx, REF_A), capture: cap,
  });
  assert.equal(real.captured, false);
  assert.equal(cap.calls.length, 0, 'the real, checked gate never invokes capture for an undispatched row');
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
