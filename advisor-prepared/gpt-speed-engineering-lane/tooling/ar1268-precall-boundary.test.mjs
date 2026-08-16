// AR-1268 controls — the four load-bearing edges AR-1267 §9 left open.
//
// A  self-protect the actual live control surface        (§3, F-1)
// C  freeze the exact native-call execution identity     (§6.2, F-4)
// D  move `claim -> dispatch` into the trusted PreToolUse transaction (§5, F-3)
// E  force capture before the next frozen call           (§9E)
//
// EVERY artifact here is synthetic. No control touches the real frozen queue, the real receipt
// directory, or the real durable law — the eight one-shot attempts stay at 0/8 (§8).
//
// The `.mjs` doorway/activator controls for §9B (stale toolbox cache) live in the REAL SEAT,
// against the actually-registered command, because a cache defect proven against an imported
// function is a claim about a function and not about the thing Claude executes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { classifyPath, SELF_PROTECTED_RULES } from './lane-boundary-guard.mjs';
import {
  loadG2Context,
  loadNativeCallManifest,
  evaluateG2PreCall,
  canonicalNativeCallSha256,
  outstandingCapture,
  safeName,
  G2_PERMIT_SCHEMA,
  NATIVE_CALL_MANIFEST_SCHEMA,
  APPROVED_ACTUAL_MODEL,
} from './g2-precall-guard.mjs';

const REF = 'entry_sequence[0].rationale';
const REF2 = 'entry_sequence[1].action';
const TASK_SHA = 'a'.repeat(64);
const TASK_SHA2 = 'b'.repeat(64);
const SUBAGENT_TYPE = 'general-purpose';

// ---------------------------------------------------------------------------
// A — the live control surface (§3, F-1)
// ---------------------------------------------------------------------------

const LIVE_CONTROL_FILES = [
  '.claude/worker1-hook-guard-manifest.json',
  '.claude/settings.json',
  'scripts/claude_guard_hook.mjs',
  'scripts/claude_toolbox.mjs',
  'scripts/g2d_precall_transition.py',
  'scripts/g2d_freeze_native_calls.py',
  'docs/replay-results/svkm-extraction-certified/grade/opus-v2/native_call_manifest_t1.json',
];

for (const file of LIVE_CONTROL_FILES) {
  test(`A: ${file} is SELF_PROTECTED — the guarded worker cannot edit its own control surface`, () => {
    const r = classifyPath('worker-1', file);
    assert.equal(r.verdict, 'SELF_PROTECTED', `${file} -> ${r.verdict}: ${r.reason}`);
  });
}

test('A DISCRIMINATES: ordinary authorized script work is still allowed', () => {
  // Without this the suite cannot tell "protects the doorway" from "froze the whole lane".
  // A `scripts/` PREFIX rule would pass every test above and fail this one.
  for (const ordinary of ['scripts/system_inventory.py', 'scripts/g2d_real_queue_preflight.py']) {
    const r = classifyPath('worker-1', ordinary);
    assert.notEqual(r.verdict, 'SELF_PROTECTED', `${ordinary} must remain editable, got ${r.reason}`);
  }
});

test('A MUTATION: removing the doorway rule makes the doorway wrongly editable', () => {
  const withoutDoorway = SELF_PROTECTED_RULES.filter((r) => r.value !== 'scripts/claude_guard_hook.mjs');
  const mutated = classifyPath('worker-1', 'scripts/claude_guard_hook.mjs', { selfProtectedRules: withoutDoorway });
  const unmutated = classifyPath('worker-1', 'scripts/claude_guard_hook.mjs');
  assert.equal(unmutated.verdict, 'SELF_PROTECTED', 'the unmutated control must deny');
  assert.notEqual(mutated.verdict, 'SELF_PROTECTED', 'the mutation must BITE — this rule is what does the work');
});

// ---------------------------------------------------------------------------
// Synthetic G2 rig
// ---------------------------------------------------------------------------

function makeRig({ receipts = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar1268-'));
  const receiptDir = path.join(root, 'isolated-receipts-t1');
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, 'README.md'), 'synthetic\n');
  for (const r of receipts) fs.writeFileSync(path.join(receiptDir, r), '{}\n');

  const queuePath = path.join(root, 'isolated_fallback_queue_t1.json');
  fs.writeFileSync(queuePath, JSON.stringify({
    law_version: 'isolated-fallback-law-v1',
    input_route_version: 'opus-phase1-route-v2',
    max_attempts_per_condition: 1,
    queue: [
      { condition_ref: REF, task_input_sha256: TASK_SHA },
      { condition_ref: REF2, task_input_sha256: TASK_SHA2 },
    ],
    attempts: {},
  }, null, 2));

  const g2 = loadG2Context({ queuePath, receiptDir });

  const permitPath = path.join(root, 'permit.json');
  fs.writeFileSync(permitPath, JSON.stringify({
    schema: G2_PERMIT_SCHEMA,
    condition_ref: REF,
    queue_artifact_sha256: g2.queueSha256,
    task_input_sha256: TASK_SHA,
    requested_model: 'opus',
    attempt: 1,
  }));

  // THE FROZEN PROMPT. Its only property that matters here is that it is fixed before the call;
  // its content is irrelevant to the binding, which is the point of hashing it.
  const prompt = `CONDITION:\n${REF}\n\nTRANSCRIPT:\n<pinned>\n\nReturn the literal grounding quote, or null.`;
  const authorized = {
    description: `G2D-PERMIT: ${permitPath} ${REF}`,
    prompt,
    subagent_type: SUBAGENT_TYPE,
    model: APPROVED_ACTUAL_MODEL,
  };

  const manifestPath = path.join(root, 'native_call_manifest_t1.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    schema: NATIVE_CALL_MANIFEST_SCHEMA,
    queue_artifact_sha256: g2.queueSha256,
    calls: [{
      condition_ref: REF,
      task_input_sha256: TASK_SHA,
      model: APPROVED_ACTUAL_MODEL,
      subagent_type: SUBAGENT_TYPE,
      // COMPUTED by the guard's own canonicaliser — a hand-copied hash embalms a dead number.
      native_call_sha256: canonicalNativeCallSha256(authorized),
    }],
  }, null, 2));

  return {
    root, queuePath, receiptDir, g2, permitPath, authorized, prompt,
    nativeCalls: loadNativeCallManifest({ manifestPath }),
  };
}

function transitionSpy(outcome = { ok: true }) {
  const fn = (args) => { fn.calls.push(args); return outcome; };
  fn.calls = [];
  return fn;
}

function gate(rig, toolInput, opts = {}) {
  const transition = opts.transition ?? transitionSpy();
  const verdict = evaluateG2PreCall({
    toolName: 'Agent',
    toolInput,
    g2: rig.g2,
    cwd: rig.root,
    nativeCalls: opts.nativeCalls === undefined ? rig.nativeCalls : opts.nativeCalls,
    transition,
    strictSession: opts.strictSession ?? true,
  });
  return { verdict, transition };
}

// ---------------------------------------------------------------------------
// D — the transition IS the allow (§5, F-3)
// ---------------------------------------------------------------------------

test('D POSITIVE: a READY exact-Opus exact-prompt call writes attempt+dispatch BEFORE the allow', () => {
  const rig = makeRig();
  const { verdict, transition } = gate(rig, rig.authorized);
  assert.equal(verdict.allow, true, verdict.reason);
  assert.equal(verdict.transitioned, true);
  // POSITIVE WITNESS: allow alone is satisfied by a guard that skipped the transition entirely.
  assert.equal(transition.calls.length, 1);
  assert.equal(transition.calls[0].conditionRef, REF);
  assert.equal(transition.calls[0].taskInputSha256, TASK_SHA);
  assert.equal(transition.calls[0].receiptDir, rig.receiptDir);
});

test('D: THE INVERSION IS GONE — the guard, not the caller, is what claims', () => {
  // Under AR-1266 the caller was expected to claim first, and then `conditionIsSpent` denied for
  // seeing that very claim. This asserts the resolved order directly: at gate time the condition
  // is READY (no receipts), and the claim happens inside the ALLOW path.
  const rig = makeRig();
  assert.deepEqual(fs.readdirSync(rig.receiptDir), ['README.md'], 'must be READY at gate time');
  const { verdict, transition } = gate(rig, rig.authorized);
  assert.equal(verdict.allow, true, verdict.reason);
  assert.equal(transition.calls.length, 1);
});

test('D NEGATIVE: a failed transition denies — the model call never happens', () => {
  const rig = makeRig();
  const { verdict } = gate(rig, rig.authorized, {
    transition: transitionSpy({ ok: false, error: 'claim landed, dispatch refused' }),
  });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /transition did not complete/);
  assert.match(verdict.reason, /dispatch refused/);
});

test('D MUTATION: a transition that silently succeeds without being called is what this catches', () => {
  // The mutation is a guard that never invokes the transition. Assert on the SPY, not on
  // `allow` — the two are different claims, and the old code satisfied one of them.
  const rig = makeRig();
  const { transition } = gate(rig, rig.authorized);
  assert.notEqual(transition.calls.length, 0, 'a guard that allows without transitioning is the AR-1266 defect');
});

test('D NEGATIVE: a pre-existing attempt is denied and is not resumed as a new invocation', () => {
  const rig = makeRig({ receipts: [`${safeName(REF)}.attempt.json`] });
  const { verdict, transition } = gate(rig, rig.authorized);
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /already spent\/claimed/);
  assert.equal(transition.calls.length, 0, 'nothing may be claimed on top of a prior claim');
});

test('D NEGATIVE: a pre-existing dispatch/raw/completion is denied', () => {
  for (const part of ['dispatch', 'raw', 'completion']) {
    const rig = makeRig({ receipts: [`${safeName(REF)}.${part}.json`] });
    const { verdict } = gate(rig, rig.authorized);
    assert.equal(verdict.allow, false, `${part} must deny`);
  }
});

// ---------------------------------------------------------------------------
// F-4 — the permit is bound to the ACTUAL model and the ACTUAL prompt (§6)
// ---------------------------------------------------------------------------

test('F-4.1 NEGATIVE: Agent model sonnet with a valid Opus permit is denied', () => {
  const rig = makeRig();
  const { verdict, transition } = gate(rig, { ...rig.authorized, model: 'sonnet' });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /requests model 'sonnet'/);
  assert.equal(transition.calls.length, 0);
});

test('F-4.1 NEGATIVE: an omitted model field is denied — inherited is not requested', () => {
  const rig = makeRig();
  const withoutModel = { ...rig.authorized };
  delete withoutModel.model;
  const { verdict } = gate(rig, withoutModel);
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /sets no 'model' field/);
});

test("F-4.1 NEGATIVE: subagent_type 'fork' is denied — fork ignores the model field entirely", () => {
  const rig = makeRig();
  const { verdict } = gate(rig, { ...rig.authorized, subagent_type: 'fork' });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /subagent_type 'fork'/);
});

test('F-4.2 NEGATIVE: a ONE-BYTE prompt mutation is denied', () => {
  const rig = makeRig();
  const { verdict, transition } = gate(rig, { ...rig.authorized, prompt: `${rig.prompt} ` });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /does not match the frozen execution identity/);
  assert.equal(transition.calls.length, 0, 'nothing is claimed for a call that will not be allowed');
});

test('F-4.2 NEGATIVE: an appended hint / batch answer is denied', () => {
  const rig = makeRig();
  const leaked = `${rig.prompt}\n\nHINT: the batch answer was "we can enter the trade".`;
  const { verdict } = gate(rig, { ...rig.authorized, prompt: leaked });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /does not match the frozen execution identity/);
});

test('F-4 NEGATIVE: a forged permit with the wrong actual call is denied', () => {
  // The permit itself is internally valid — right queue, right condition, right task hash,
  // requested_model opus. Only the ACTUAL call is wrong. This is the exact gap §6 named.
  const rig = makeRig();
  const { verdict } = gate(rig, { ...rig.authorized, prompt: 'Answer entry_sequence[0].rationale however you like.' });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /does not match the frozen execution identity/);
});

test('F-4 NEGATIVE: no native-call manifest loaded is a DENIAL, never an unbound allow', () => {
  const rig = makeRig();
  const { verdict } = gate(rig, rig.authorized, { nativeCalls: null });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /no frozen native-call identity manifest/);
});

test('F-4 NEGATIVE: a manifest frozen against a different queue is denied', () => {
  const rig = makeRig();
  const wrongQueue = {
    ...rig.nativeCalls,
    queueArtifactSha256: 'c'.repeat(64),
  };
  const { verdict } = gate(rig, rig.authorized, { nativeCalls: wrongQueue });
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /was frozen against queue/);
});

test('F-4 DISCRIMINATES: the unmutated authorized call still passes', () => {
  // Without this, every assertion above is satisfied by a gate that denies everything.
  const rig = makeRig();
  assert.equal(gate(rig, rig.authorized).verdict.allow, true);
});

// ---------------------------------------------------------------------------
// E — forced capture before the next frozen call (§9E)
// ---------------------------------------------------------------------------

test('E: a dispatch outstanding without raw+completion denies the NEXT ref', () => {
  // REF2 is dispatched and uncaptured; the call under test is for REF. Racing on would spend a
  // second one-shot attempt while the first answer is unrecoverable.
  const rig = makeRig({ receipts: [`${safeName(REF2)}.dispatch.json`] });
  const { verdict, transition } = gate(rig, rig.authorized);
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /has not been captured/);
  assert.equal(transition.calls.length, 0);
});

test('E: a completed quartet does NOT block the next ref', () => {
  const rig = makeRig({
    receipts: [
      `${safeName(REF2)}.attempt.json`,
      `${safeName(REF2)}.dispatch.json`,
      `${safeName(REF2)}.raw.json`,
      `${safeName(REF2)}.completion.json`,
    ],
  });
  assert.equal(outstandingCapture(rig.g2), null);
  const { verdict } = gate(rig, rig.authorized);
  assert.equal(verdict.allow, true, verdict.reason);
});

test('E: raw WITHOUT completion still blocks — a stranded answer is not a captured one', () => {
  const rig = makeRig({
    receipts: [`${safeName(REF2)}.dispatch.json`, `${safeName(REF2)}.raw.json`],
  });
  const found = outstandingCapture(rig.g2);
  assert.equal(found.ref, REF2);
  assert.deepEqual(found.missing, ['completion']);
  assert.equal(gate(rig, rig.authorized).verdict.allow, false);
});

test('E DISCRIMINATES: an untouched receipt directory reports nothing outstanding', () => {
  assert.equal(outstandingCapture(makeRig().g2), null);
});
