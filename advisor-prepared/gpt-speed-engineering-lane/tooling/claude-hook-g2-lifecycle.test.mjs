/**
 * AR-1305A F32/F33/F34/F35 -- THE FULL G2-D HANDSHAKE, THROUGH THE REAL RUNNER/BRIDGE PROCESS
 * BOUNDARY, ON SCRATCH/TEMP ARTIFACTS ONLY.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM g2-precall-guard.test.mjs / g2-postcall-capture.test.mjs
 *   Both of those files prove their own gate function directly, with `transition`/`capture`/
 *   `stateReport` FAKES standing in for the real Python doorways, and neither ever spawns the
 *   real claude-hook-runner.mjs. AR-1305A F32 convicted exactly that shape: "g2-postcall-
 *   capture.test.mjs calls evaluatePostCallCapture() directly instead of proving a synthetic
 *   PostToolUse event traverses the real runner/bridge doorway... Two green halves are not a
 *   handshake." This file is the wire: every call below is a REAL claude-hook-runner.mjs child
 *   process, and every receipt file it produces is written by the REAL Python law (F29's
 *   g2d_precall_transition.py, F30's g2d_postcall_capture.py, F33/F34's g2d_bridge_report.py),
 *   not a stand-in.
 *
 * WHY THIS RUNS INSIDE THE SIBLING WORKER WORKTREE INSTEAD OF A FRESH `git init` FIXTURE
 *   `repoRoot` for a spawned hook process is derived from `git rev-parse --show-toplevel` of
 *   wherever the process runs, and the default (non-injected) transition/capture/stateReport
 *   functions all resolve `scripts/g2d_*.py` and `src/engine/extraction/*.py` relative to THAT
 *   root. A throwaway `git init` fixture was tried first and its dependency chain (isolated_
 *   attempt_receipt -> isolated_fallback_law -> opus_phase1_route -> four more siblings ->
 *   spec_family_bindings -> ...) turned out to reach well outside `src/engine/extraction/`
 *   into the wider `src/engine` package, which is 36MB/696 files and not something this
 *   fixture should hand-copy and risk silently diverging from. So this witness runs `cwd`
 *   inside the REAL sibling worker worktree, where the full dependency graph already works,
 *   using ONLY:
 *     - a SCRATCH g2 queue/receipt/native-manifest directory under that worktree (created
 *       fresh, fully cleaned up in a `finally`, never the real frozen namespace);
 *     - the worktree's OWN real current branch/head, read live, for the SessionStart anchor
 *       (so this witness is a genuine anchor check, not a fabricated one) with
 *       `require_clean: false`, because the shared tree may legitimately carry unrelated
 *       in-progress work at any given moment and this witness asserts nothing about that;
 *     - a uniquely-generated `session_id` per run, so the guard session marker this test mints
 *       (`<repoRoot>/.git/tf-claude-guard-session-<id>.json`) can never collide with a real
 *       seat's own marker, and is deleted in the same `finally`.
 *
 * SCRATCH/TEMP ONLY. Nothing here touches the real frozen queue, receipt directory, or any
 * tracked file in the worker tree. Zero real Agent/Task/model calls -- "the model call" in
 * every scenario below is a synthetic PostToolUse `tool_response` payload, never a live
 * dispatch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { canonicalNativeCallSha256, safeName } from './g2-precall-guard.mjs';

const RUNNER = path.join(import.meta.dirname, 'claude-hook-runner.mjs');
const WORKER_TREE = 'C:\\Users\\tonio\\Projects\\wt-claude-worker1-20260815';
const HAS_WORKER_TREE = fs.existsSync(path.join(WORKER_TREE, 'scripts', 'g2d_precall_transition.py'));

const PIN = '18108039056a0994c1fc1be9583812b0838dba50';
const BUNDLE = '1d12f61277d8d3c502df9bd7dea5dac541e64335e469fd7176187f4b02144b06';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

const REF_1 = 'entry_sequence[0].rationale';
const REF_2 = 'entry_sequence[1].action';
const FROZEN_SUBAGENT_TYPE = 'general-purpose';

function toolInputFor(ref, permitMarkerPath) {
  return {
    description: 'isolated G2-D call',
    prompt: `Answer the frozen condition ${ref}. G2D-PERMIT: ${permitMarkerPath}`,
    subagent_type: FROZEN_SUBAGENT_TYPE,
    model: 'opus',
  };
}

function permitPathFor(receiptDir, ref) {
  return path.join(receiptDir, `${safeName(ref)}.permit.json`);
}

/**
 * Builds a SCRATCH g2 queue/receipt/native-manifest directory inside the real worker worktree,
 * using a real two-row frozen queue built by the actual isolated_fallback_law (never
 * hand-typed -- the real DurableAttemptLedger.load() rejects a hand-typed shape for missing
 * substitution_rule/substitution_rule_sha256, as g2-postcall-capture.test.mjs already
 * discovered once).
 */
function makeG2Scratch() {
  const branch = git(WORKER_TREE, 'rev-parse', '--abbrev-ref', 'HEAD');
  const head = git(WORKER_TREE, 'rev-parse', 'HEAD');

  const g2Dir = fs.mkdtempSync(path.join(WORKER_TREE, 'tmp-g2-lifecycle-witness-'));
  const g2DirRel = path.relative(WORKER_TREE, g2Dir).replaceAll('\\', '/');
  const receiptDir = path.join(g2Dir, 'receipts');
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, 'README.md'), 'synthetic\n');

  const buildQueuePy = `
import json
from src.engine.extraction import isolated_fallback_law as law
record = {
    "route_version": "opus-phase1-route-v2",
    "outcomes": [
        {"condition_ref": ${JSON.stringify(REF_1)}, "disposition": "REFUSED_RELEVANCE", "gate": "g", "reason": "r"},
        {"condition_ref": ${JSON.stringify(REF_2)}, "disposition": "RED_SOURCE_FIDELITY", "gate": "g", "reason": "r"},
    ],
}
pinned = {"transcript_sha256": "a" * 64, "extraction_sha256": "b" * 64}
texts = {${JSON.stringify(REF_1)}: "Wait for a close outside of the range.", ${JSON.stringify(REF_2)}: "The stop includes the wick."}
q = law.freeze_isolated_queue(record, pinned, texts).as_dict()
print(json.dumps(q))
`.trim();
  const res = spawnSync(process.env.TF_PYTHON || 'python', ['-c', buildQueuePy], { encoding: 'utf8', cwd: WORKER_TREE });
  if (res.status !== 0) throw new Error(`could not build the real-law queue fixture: ${res.stderr}`);
  const queue = JSON.parse(res.stdout);

  const queuePath = path.join(g2Dir, 'queue.json');
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));

  const taskSha1 = queue.queue.find((e) => e.condition_ref === REF_1).task_input_sha256;
  const taskSha2 = queue.queue.find((e) => e.condition_ref === REF_2).task_input_sha256;

  const nativeManifestPath = path.join(g2Dir, 'native-calls.json');
  const nativeManifest = {
    schema: 'g2d-native-call-identity-v1',
    queue_artifact_sha256: crypto.createHash('sha256').update(fs.readFileSync(queuePath)).digest('hex'),
    calls: [REF_1, REF_2].map((ref) => ({
      condition_ref: ref,
      task_input_sha256: ref === REF_1 ? taskSha1 : taskSha2,
      model: 'opus',
      subagent_type: FROZEN_SUBAGENT_TYPE,
      native_call_sha256: canonicalNativeCallSha256(toolInputFor(ref, permitPathFor(receiptDir, ref))),
    })),
  };
  fs.writeFileSync(nativeManifestPath, JSON.stringify(nativeManifest, null, 2));

  return {
    branch, head, g2Dir, g2DirRel, receiptDir,
    queuePathRel: `${g2DirRel}/queue.json`,
    receiptDirRel: `${g2DirRel}/receipts`,
    nativeManifestPathRel: `${g2DirRel}/native-calls.json`,
  };
}

function cleanupScratch(scratch, sessionId) {
  try { fs.rmSync(scratch.g2Dir, { recursive: true, force: true }); } catch { /* best effort */ }
  try {
    const gitDir = git(WORKER_TREE, 'rev-parse', '--absolute-git-dir');
    const markerName = `tf-claude-guard-session-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128)}.json`;
    fs.rmSync(path.join(gitDir, markerName), { force: true });
  } catch { /* best effort */ }
}

function writeManifest(scratch, overrides = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-g2-lifecycle-manifest-')), 'manifest.json');
  fs.writeFileSync(file, JSON.stringify({
    schema: 'gpt-claude-hook-guard-v1',
    worker: 'worker-1',
    _toolbox_pin: PIN,
    _toolbox_bundle_sha256: BUNDLE,
    // require_clean:false and a real, LIVE-READ branch/head -- this witness is a genuine
    // anchor check against the actual shared tree's actual state, not a fabricated pass. The
    // dirty-tree dimension is already covered by claude-hook-lifecycle.test.mjs's own controls.
    session_anchor: { expected_branch: scratch.branch, expected_head: scratch.head, require_clean: false },
    edit_scope: { allowed_exact: ['README.md'], allowed_prefixes: [] },
    finish: { enabled: false },
    g2_precall: {
      enabled: true,
      strict_session: true,
      queue_path: scratch.queuePathRel,
      receipt_dir: scratch.receiptDirRel,
      native_call_manifest_path: scratch.nativeManifestPathRel,
    },
    ...overrides,
  }, null, 2));
  return file;
}

function hookEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.TF_CLAUDE_GUARD_ANCHOR_OK;
  if (!('CLAUDE_ENV_FILE' in extra)) delete env.CLAUDE_ENV_FILE;
  return env;
}

function runHook(manifestPath, payload, extraEnv = {}) {
  const child = spawnSync(process.execPath, [RUNNER, '--manifest', manifestPath], {
    cwd: WORKER_TREE, input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv(extraEnv),
  });
  if (child.error) throw child.error;
  const stdout = (child.stdout || '').trim();
  return { status: child.status, stdout, stderr: (child.stderr || '').trim(), json: stdout ? JSON.parse(stdout) : null };
}

function sessionStart(manifestPath, sessionId) {
  const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-g2-lifecycle-envfile-')), 'claude-env');
  return runHook(manifestPath, { cwd: WORKER_TREE, hook_event_name: 'SessionStart', source: 'startup', session_id: sessionId }, { CLAUDE_ENV_FILE: envFile });
}

function preToolUse(manifestPath, sessionId, ref, permitMarkerPath) {
  return runHook(manifestPath, {
    cwd: WORKER_TREE, hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: sessionId,
    tool_input: toolInputFor(ref, permitMarkerPath),
  });
}

function postToolUse(manifestPath, sessionId, ref, permitMarkerPath, toolResponse) {
  return runHook(manifestPath, {
    cwd: WORKER_TREE, hook_event_name: 'PostToolUse', tool_name: 'Agent', session_id: sessionId,
    tool_input: toolInputFor(ref, permitMarkerPath),
    tool_response: toolResponse,
  });
}

function preDecision(result) { return result.json?.hookSpecificOutput?.permissionDecision ?? null; }
function preReason(result) { return result.json?.hookSpecificOutput?.permissionDecisionReason ?? ''; }
function postDecision(result) { return result.json?.decision ?? null; }
function postReason(result) { return result.json?.reason ?? ''; }

// ---------------------------------------------------------------------------------------------
// THE FULL WITNESS
// ---------------------------------------------------------------------------------------------

test('THE FULL G2-D HANDSHAKE, end to end, through the real runner/bridge process boundary', { skip: !HAS_WORKER_TREE && 'sibling worker worktree with the Python G2 law not present' }, () => {
  const scratch = makeG2Scratch();
  const sessionId = `g2-lifecycle-witness-${crypto.randomBytes(6).toString('hex')}`;
  const manifestPath = writeManifest(scratch);
  const permit1 = permitPathFor(scratch.receiptDir, REF_1);
  const permit2 = permitPathFor(scratch.receiptDir, REF_2);

  try {
    // 1. Fresh armed session, against the worktree's OWN real branch/head.
    const start = sessionStart(manifestPath, sessionId);
    assert.match(start.json.hookSpecificOutput.additionalContext, /anchor verified/, start.stderr);

    // 2. Row 2 submitted first -> DENY (frozen row order), zero receipts written for row 2.
    const row2First = preToolUse(manifestPath, sessionId, REF_2, permit2);
    assert.equal(preDecision(row2First), 'deny', preReason(row2First));
    assert.match(preReason(row2First), /frozen row order violation/);
    assert.equal(fs.existsSync(permit2), false);

    // 3. Row 1 PreToolUse -> materialize -> claim -> dispatch -> ALLOW, through the REAL doorways.
    const row1Pre = preToolUse(manifestPath, sessionId, REF_1, permit1);
    assert.equal(preDecision(row1Pre), null, `row 1 must be allowed: ${preReason(row1Pre)}`);
    assert.equal(fs.existsSync(permit1), true, 'the real materialization wrote the permit');
    assert.equal(fs.existsSync(path.join(scratch.receiptDir, `${safeName(REF_1)}.attempt.json`)), true, 'the real g2d_precall_transition.py wrote .attempt');
    assert.equal(fs.existsSync(path.join(scratch.receiptDir, `${safeName(REF_1)}.dispatch.json`)), true, 'the real g2d_precall_transition.py wrote .dispatch');

    // 4. Row 2 while row 1 is uncaptured (NATIVE_TASK_DISPATCHED) -> DENY (global interlock).
    const row2WhileUncaptured = preToolUse(manifestPath, sessionId, REF_2, permit2);
    assert.equal(preDecision(row2WhileUncaptured), 'deny');
    assert.match(preReason(row2WhileUncaptured), /stuck at NATIVE_TASK_DISPATCHED/);
    assert.equal(fs.existsSync(permit2), false);

    // 5. Row 1 PostToolUse, a synthetic runtime-shaped response -> .raw + .completion, through
    //    the REAL g2d_postcall_capture.py (never a hand-planted receipt).
    const responsePayload = { success: true, result: 'the model answered: wait for the close.' };
    const row1Post = postToolUse(manifestPath, sessionId, REF_1, permit1, responsePayload);
    assert.equal(postDecision(row1Post), null, `row 1 capture must not block: ${postReason(row1Post)}`);
    assert.equal(fs.existsSync(path.join(scratch.receiptDir, `${safeName(REF_1)}.raw.json`)), true);
    assert.equal(fs.existsSync(path.join(scratch.receiptDir, `${safeName(REF_1)}.completion.json`)), true);
    const rawDoc = JSON.parse(fs.readFileSync(path.join(scratch.receiptDir, `${safeName(REF_1)}.raw.json`), 'utf8'));
    assert.equal(
      rawDoc.raw_output_sha256,
      crypto.createHash('sha256').update(JSON.stringify(responsePayload)).digest('hex'),
      'the persisted raw return hashes the EXACT synthetic tool_response bytes this test supplied',
    );

    // 6. Row 2 PreToolUse -> now ALLOW, only after its OWN permit -> claim -> dispatch.
    const row2Now = preToolUse(manifestPath, sessionId, REF_2, permit2);
    assert.equal(preDecision(row2Now), null, `row 2 must now be allowed: ${preReason(row2Now)}`);
    assert.equal(fs.existsSync(permit2), true);
    assert.equal(fs.existsSync(path.join(scratch.receiptDir, `${safeName(REF_2)}.attempt.json`)), true);
    assert.equal(fs.existsSync(path.join(scratch.receiptDir, `${safeName(REF_2)}.dispatch.json`)), true);

    // 7. Duplicate row 1 PostToolUse -> BLOCK/STOP, first capture provably unchanged.
    const beforeDup = fs.readFileSync(path.join(scratch.receiptDir, `${safeName(REF_1)}.raw.json`), 'utf8');
    const dup = postToolUse(manifestPath, sessionId, REF_1, permit1, { success: true, result: 'a different, second answer' });
    assert.equal(postDecision(dup), 'block', postReason(dup));
    assert.match(postReason(dup), /already has a captured raw return/);
    assert.equal(fs.readFileSync(path.join(scratch.receiptDir, `${safeName(REF_1)}.raw.json`), 'utf8'), beforeDup, 'the first capture is untouched by the duplicate attempt');

    // 8. Zero real model calls anywhere in this witness -- every "model call" was a synthetic
    //    PreToolUse ALLOW decision or a synthetic PostToolUse tool_response payload this test
    //    authored; nothing here ever invoked the Agent tool for real.
  } finally {
    cleanupScratch(scratch, sessionId);
  }
});

test('MUTATION: an unarmed session denies PostToolUse just like PreToolUse (fail-closed, not silently skipped)', { skip: !HAS_WORKER_TREE && 'sibling worker worktree with the Python G2 law not present' }, () => {
  const scratch = makeG2Scratch();
  const sessionId = `g2-lifecycle-unarmed-${crypto.randomBytes(6).toString('hex')}`;
  const manifestPath = writeManifest(scratch);
  try {
    // No sessionStart call at all.
    const result = postToolUse(manifestPath, sessionId, REF_1, permitPathFor(scratch.receiptDir, REF_1), { result: 'x' });
    assert.equal(postDecision(result), 'block');
    assert.match(postReason(result), /worker session is not armed/);
  } finally {
    cleanupScratch(scratch, sessionId);
  }
});
