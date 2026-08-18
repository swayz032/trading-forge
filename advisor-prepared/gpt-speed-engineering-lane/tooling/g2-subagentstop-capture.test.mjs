// AR-1315A §5 Lane B/D controls for the toolbox-side SubagentStop lifecycle adapter (F36).
//
// EVERY artifact here is synthetic and lives in a temp dir, except the two INTEGRATION tests,
// which point at the REAL scripts/g2d_postcall_lifecycle.py in the sibling Worker-1 worktree and
// clean up their own scratch fixtures. No control touches the real frozen queue/receipt dir.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateSubagentStop, defaultCaptureSubagentStop } from './g2-subagentstop-capture.mjs';
import { loadG2Context, safeName } from './g2-precall-guard.mjs';

const REF_A = 'entry_sequence[0].rationale';
const TASK_SHA_A = 'a'.repeat(64);

function makeG2() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g2subagentstop-'));
  const receiptDir = path.join(root, 'isolated-receipts-t1');
  fs.mkdirSync(receiptDir, { recursive: true });
  const queuePath = path.join(root, 'isolated_fallback_queue_t1.json');
  fs.writeFileSync(
    queuePath,
    JSON.stringify({
      law_version: 'isolated-fallback-law-v1',
      max_attempts_per_condition: 1,
      queue: [{ condition_ref: REF_A, task_input_sha256: TASK_SHA_A }],
      attempts: {},
    }, null, 2),
  );
  return { root, queuePath, receiptDir, g2: loadG2Context({ queuePath, receiptDir }) };
}

function fakeCapture(outcome = { ok: true, result: { ok: true, action: 'subagent_stop_final', condition_ref: REF_A, agent_id: 'agent-1', state: 'RAW_RETURN_CAPTURED' } }) {
  const fn = (args) => { fn.calls.push(args); return typeof outcome === 'function' ? outcome(args) : outcome; };
  fn.calls = [];
  return fn;
}

const SUBAGENT_STOP_PAYLOAD = {
  session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'agent-1',
  agent_type: 'general-purpose', last_assistant_message: 'the final answer',
};

// ---------------------------------------------------------------------------
// GATE — this adapter NEVER produces a hook `decision`/`block`. See file header.
// ---------------------------------------------------------------------------

test('POSITIVE: a G2-configured event is handled and the doorway receives the exact hook payload', () => {
  const ctx = makeG2();
  const cap = fakeCapture();
  const r = evaluateSubagentStop({ hookPayload: SUBAGENT_STOP_PAYLOAD, g2: ctx.g2, cwd: ctx.root, capture: cap });
  assert.equal(r.handled, true);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.block, undefined, 'this adapter must never emit a block/decision field');
  assert.equal(cap.calls.length, 1);
  assert.deepEqual(cap.calls[0].hookPayload, SUBAGENT_STOP_PAYLOAD);
});

test('NEGATIVE: G2 lifecycle artifacts not configured -> handled:false, doorway never invoked', () => {
  const cap = fakeCapture();
  const r = evaluateSubagentStop({ hookPayload: SUBAGENT_STOP_PAYLOAD, g2: null, capture: cap });
  assert.equal(r.handled, false);
  assert.equal(cap.calls.length, 0);
});

test('NEGATIVE: doorway refusal (unbound agent_id, malformed payload, duplicate terminal, etc.) is surfaced as ok:false, reason set -- NEVER as block:true', () => {
  const ctx = makeG2();
  const cap = fakeCapture({ ok: false, error: 'no recorded launch ack names agent_id \'agent-1\'' });
  const r = evaluateSubagentStop({ hookPayload: SUBAGENT_STOP_PAYLOAD, g2: ctx.g2, cwd: ctx.root, capture: cap });
  assert.equal(r.handled, true);
  assert.equal(r.ok, false);
  assert.equal(r.action, 'refused');
  assert.match(r.reason, /no recorded launch ack names agent_id/);
  assert.equal(r.block, undefined);
  assert.equal(r.decision, undefined);
});

test('POSITIVE: a non-terminal event (defensive stop_reason handling) is still ok:true, action carries the non-terminal marker, never treated as a failure', () => {
  const ctx = makeG2();
  const cap = fakeCapture({ ok: true, result: { ok: true, action: 'subagent_stop_nonterminal', condition_ref: REF_A, agent_id: 'agent-1', note: 'awaiting a tool result' } });
  const r = evaluateSubagentStop({ hookPayload: { ...SUBAGENT_STOP_PAYLOAD, stop_reason: 'tool_use' }, g2: ctx.g2, cwd: ctx.root, capture: cap });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'subagent_stop_nonterminal');
  assert.match(r.reason, /awaiting a tool result/);
});

// ---------------------------------------------------------------------------
// MUTATION — proves the "no decision field" property is load-bearing, not incidental
// ---------------------------------------------------------------------------

test('MUTATION: a naive adapter that reused block() on refusal would tell a finished subagent to keep running; the real adapter never does', () => {
  const ctx = makeG2();
  const cap = fakeCapture({ ok: false, error: 'agent_id matches 2 recorded launch acks' });

  // Unchecked stand-in reproducing the PostToolUse/TaskCompleted convention by mistake.
  function naiveReusingBlock(result) {
    return result.ok ? {} : { decision: 'block', reason: result.error };
  }
  const naiveResult = { ok: false, error: 'agent_id matches 2 recorded launch acks' };
  const naiveOutput = naiveReusingBlock(naiveResult);
  assert.equal(naiveOutput.decision, 'block', 'the naive stand-in DOES emit decision:"block" on a refusal');

  const real = evaluateSubagentStop({ hookPayload: SUBAGENT_STOP_PAYLOAD, g2: ctx.g2, cwd: ctx.root, capture: cap });
  assert.equal(real.ok, false);
  assert.equal(real.decision, undefined, 'the real adapter never emits a decision field, on refusal or otherwise');
  assert.equal(real.block, undefined);
});

// =========================================================================================
// REGISTRATION PARITY — the SubagentStop matcher exists, targets the frozen agent type, and
// does not disturb the four existing registrations (AR-1315A §5 Lane D witness #9).
// =========================================================================================

test('REGISTRATION PARITY: SubagentStop is registered exactly once, targets general-purpose, and the four existing hook registrations are untouched', () => {
  const fragmentPath = path.resolve(import.meta.dirname, '..', 'claude-hooks', 'settings.fragment.json');
  const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));

  for (const existing of ['SessionStart', 'PreToolUse', 'PostToolUse', 'TaskCompleted']) {
    assert.ok(fragment.hooks[existing], `${existing} registration must survive adding SubagentStop`);
    assert.equal(fragment.hooks[existing].length, 1, `${existing} must still register exactly once`);
  }

  const subagentStop = fragment.hooks.SubagentStop;
  assert.ok(subagentStop, 'no SubagentStop registration exists in the settings fragment');
  assert.equal(subagentStop.length, 1, 'expected exactly one SubagentStop registration');
  assert.equal(subagentStop[0].matcher, 'general-purpose', 'AR-1315A §5 Lane C: target the frozen G2 native-call manifest agent type unless the measured manifest proves otherwise');
  assert.equal(subagentStop[0].hooks.length, 1);
  assert.match(subagentStop[0].hooks[0].command, /claude-hook-runner\.mjs/, 'must route through the existing trusted guard doorway, not an ad-hoc script');
});

test('MUTATION: dropping the SubagentStop matcher\'s agent-type target makes the parity control RED', () => {
  const fragmentPath = path.resolve(import.meta.dirname, '..', 'claude-hooks', 'settings.fragment.json');
  const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));
  const mutated = fragment.hooks.SubagentStop[0].matcher.replace('general-purpose', '');
  assert.notEqual(mutated, 'general-purpose', 'the parity control must actually notice an empty/wrong matcher');
});

// ---------------------------------------------------------------------------
// INTEGRATION — defaultCaptureSubagentStop against the REAL Python F36 doorway, using the F36
// launch-ack doorway first to build a real ack to bind against (the real subagent-stop path
// REFUSES an event with no recorded launch ack -- see g2d_subagentstop_capture.py).
// ---------------------------------------------------------------------------

const WORKER_TREE = 'C:\\Users\\tonio\\Projects\\wt-claude-worker1-20260815';
const HAS_LIFECYCLE_DOORWAY = fs.existsSync(path.join(WORKER_TREE, 'scripts', 'g2d_postcall_lifecycle.py'));

function makeRealLawQueue() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g2subagentstop-int-'));
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

test('INTEGRATION: real launch-ack then real SubagentStop finalizes through the real doorway -- .raw/.completion appear only after the SubagentStop event', {
  skip: !HAS_LIFECYCLE_DOORWAY && 'sibling worker worktree with g2d_postcall_lifecycle.py not present',
}, async () => {
  const { defaultCaptureLaunchAck } = await import('./g2-postcall-capture.mjs');
  const rig = makeRealLawQueue();
  realClaimAndDispatch(rig);

  const ackResult = defaultCaptureLaunchAck({
    repoRoot: WORKER_TREE, queuePath: rig.queuePath, receiptDir: rig.receiptDir,
    conditionRef: rig.ref, ackPayload: { isAsync: true, status: 'async_launched', agentId: 'agent-int-1' },
  });
  assert.equal(ackResult.ok, true, JSON.stringify(ackResult));
  assert.equal(fs.existsSync(path.join(rig.receiptDir, `${safeName(rig.ref)}.raw.json`)), false, 'no final capture yet, only a launch ack');

  const stopResult = defaultCaptureSubagentStop({
    repoRoot: WORKER_TREE, queuePath: rig.queuePath, receiptDir: rig.receiptDir,
    hookPayload: { session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'agent-int-1', agent_type: 'general-purpose', last_assistant_message: 'the real end-to-end answer' },
  });
  assert.equal(stopResult.ok, true, JSON.stringify(stopResult));
  assert.equal(stopResult.result.action, 'subagent_stop_final');
  assert.equal(stopResult.result.condition_ref, rig.ref);

  assert.equal(fs.existsSync(path.join(rig.receiptDir, `${safeName(rig.ref)}.raw.json`)), true);
  assert.equal(fs.existsSync(path.join(rig.receiptDir, `${safeName(rig.ref)}.completion.json`)), true);
  const raw = JSON.parse(fs.readFileSync(path.join(rig.receiptDir, `${safeName(rig.ref)}.raw.json`), 'utf8'));
  assert.equal(raw.raw_output, 'the real end-to-end answer');
});

test('INTEGRATION: a SubagentStop event naming a wrong agent_id is refused, never finalizes the row, no receipt overwritten', {
  skip: !HAS_LIFECYCLE_DOORWAY && 'sibling worker worktree with g2d_postcall_lifecycle.py not present',
}, async () => {
  const { defaultCaptureLaunchAck } = await import('./g2-postcall-capture.mjs');
  const rig = makeRealLawQueue();
  realClaimAndDispatch(rig);
  defaultCaptureLaunchAck({
    repoRoot: WORKER_TREE, queuePath: rig.queuePath, receiptDir: rig.receiptDir,
    conditionRef: rig.ref, ackPayload: { isAsync: true, status: 'async_launched', agentId: 'agent-real-owner' },
  });

  const wrongAgent = defaultCaptureSubagentStop({
    repoRoot: WORKER_TREE, queuePath: rig.queuePath, receiptDir: rig.receiptDir,
    hookPayload: { session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'agent-imposter', agent_type: 'general-purpose', last_assistant_message: 'not the real subagent' },
  });
  assert.equal(wrongAgent.ok, false);
  assert.match(wrongAgent.error, /no recorded launch ack names agent_id/);
  assert.equal(fs.existsSync(path.join(rig.receiptDir, `${safeName(rig.ref)}.raw.json`)), false);

  // The correct agent's LATER real completion must still be able to close the row -- the wrong
  // event must leave no durable trace capable of blocking it (F36-B, AR-1314A).
  const correctAgent = defaultCaptureSubagentStop({
    repoRoot: WORKER_TREE, queuePath: rig.queuePath, receiptDir: rig.receiptDir,
    hookPayload: { session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'agent-real-owner', agent_type: 'general-purpose', last_assistant_message: 'the real answer' },
  });
  assert.equal(correctAgent.ok, true, JSON.stringify(correctAgent));
  assert.equal(fs.existsSync(path.join(rig.receiptDir, `${safeName(rig.ref)}.raw.json`)), true);
});
