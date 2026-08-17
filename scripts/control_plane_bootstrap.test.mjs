/**
 * RED / GREEN / NEGATIVE CONTROLS for the control-plane bootstrap.
 *
 * Run: node --test scripts/control_plane_bootstrap.test.mjs
 *
 * ★ THESE TESTS TOUCH NOTHING. Every filesystem/git/process interaction goes through an injected
 * fake, and the effects recorder is asserted EMPTY on every refusal path — so "external side
 * effects = NONE" is a measurement, not a promise: no effect was even REQUESTED.
 *
 * ★ THE NO-MUTATION CONTROL IS LOAD-BEARING. A negative suite without a passing baseline cannot
 * distinguish "catches breakage" from "always red", so the baseline runs first and every negative
 * is exactly one field away from it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { validateAuthorization, extractCandidateMarkers, MARKER_SCHEMA } from './control-plane-bootstrap/authorization.mjs';
import {
  classifyControlPlanePath, classifyControlPlaneTool, classifyControlPlaneBash,
  verifySeatIdentity, IDENTITY_FIELDS,
} from './control-plane-bootstrap/control-plane-guard.mjs';
import {
  buildPlan, deriveBranch, deriveWorktreeDirName, assertClaimNamespaceDisjoint,
  LAUNCH_EXECUTABLE, LAUNCH_ARGV, SEAT_SETTINGS_REL, SEAT_MANIFEST_REL,
} from './control-plane-bootstrap/plan.mjs';
import { run, seatSettingsFor, rulingIdFromFilename } from './control-plane-bootstrap/bootstrap.mjs';
import { computeBundle, BUNDLE_FILES } from './control-plane-bootstrap/bundle.mjs';
import { decide, measureObservedIdentity, receiptMatchesLive } from './control-plane-bootstrap/control-plane-seat-hook.mjs';

const QUEUE_SHA = '5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939';
/** The trap hash from AR-1276 §F: same 17-char prefix, different string. */
const EXTRACTION_SHA_TRAP = '5935b1c6c03860b35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823';
const HEAD = 'cb4bd4871e3a7e2e1d553073bca88d25dc0ffde6';
const REPO = 'swayz032/trading-forge';
const WORKTREE = 'C:/Users/tonio/Projects/wt-control-plane-ar-1279';
const BRANCH = 'control-plane/ar-1279-guard-repair';

/** A deterministic reader for the bundle files, so the bundle sha is stable across the suite. */
const fakeBundleReader = (rel) => Buffer.from(`FIXTURE:${rel}`, 'utf8');
const BUNDLE_SHA = computeBundle(fakeBundleReader).bundle_sha256;

const baselineMarker = () => ({
  schema: MARKER_SCHEMA,
  authorization_class: 'EXECUTABLE',
  authorization_id: 'cpb-2026-08-16-0001',
  ruling_id: 'AR-1281',
  actor: 'top-level-control-plane-guard-repair',
  execution: 'ONE_BOOTSTRAP_EXECUTION',
  source_actor: 'worker-1',
  target_packet: 'AR-1279',
  repo: REPO,
  frozen_queue_sha256: QUEUE_SHA,
  require_ready: 8,
  require_spent: 0,
  require_receipts: 'README_ONLY',
  require_agent_model_executions_before_launch: 0,
  hands_free: true,
  allowed_paths: ['.claude/settings.json', '.claude/worker1-hook-guard-manifest.json', 'CLAUDE.md'],
  bootstrap_source_sha: HEAD,
  bootstrap_bundle_sha256: BUNDLE_SHA,
});

const baselineMeasured = () => ({
  rulingId: 'AR-1281',
  isNewestRuling: true,
  queueSha256: QUEUE_SHA,
  ready: 8,
  spent: 0,
  receiptsReadmeOnly: true,
  agentModelExecutions: 0,
  claimedAuthorizationIds: new Set(),
  workerBranch: 'claude/worker1-h1-20260815',
  workerHead: HEAD,
  repoRemote: REPO,
  repoParentDir: 'C:/Users/tonio/Projects',
  gptAuthorityHead: '9bf12d2073bbd3e088c8d8ee907f02aa7c290620',
  bootstrapBundleSha256: BUNDLE_SHA,
});

/* =============================== NO-MUTATION CONTROL ======================================= */

test('CONTROL: the baseline marker validates (so every negative below discriminates)', () => {
  const v = validateAuthorization(baselineMarker(), baselineMeasured());
  assert.equal(v.ok, true, `baseline must pass, got ${v.code}: ${v.detail}`);
});

/* =============================== THE 18 ORIGINAL NEGATIVES (preserved, §10.13) ============= */

const refusesWith = (mutate, expectedCode) => {
  const marker = baselineMarker();
  const measured = baselineMeasured();
  mutate(marker, measured);
  const v = validateAuthorization(marker, measured);
  assert.equal(v.ok, false, 'must refuse');
  assert.equal(v.code, expectedCode, `expected ${expectedCode}, got ${v.code}: ${v.detail}`);
};

test('N1 missing authorization marker', () => {
  const v = validateAuthorization(null, baselineMeasured());
  assert.equal(v.ok, false);
  assert.equal(v.code, 'not_an_object');
});

test('N2 schema typo', () => refusesWith((m) => { m.schema = `${MARKER_SCHEMA}2`; }, 'wrong_schema'));
test('N3 wrong actor', () => refusesWith((m) => { m.actor = 'worker-1'; }, 'wrong_actor'));
test('N4 wrong source actor', () => refusesWith((m) => { m.source_actor = 'worker-2'; }, 'wrong_source_actor'));
test('N5 wrong target packet', () => refusesWith((m) => { m.target_packet = 'the-next-one'; }, 'bad_target_packet'));

test('N6 wrong frozen queue SHA — including the AR-1276 §F prefix trap', () => {
  refusesWith((m) => { m.frozen_queue_sha256 = EXTRACTION_SHA_TRAP; }, 'frozen_queue_sha_mismatch');
  assert.equal(EXTRACTION_SHA_TRAP.slice(0, 17), QUEUE_SHA.slice(0, 17));
  assert.notEqual(EXTRACTION_SHA_TRAP, QUEUE_SHA);
});

test('N7 READY not 8', () => refusesWith((m, s) => { s.ready = 7; }, 'ready_not_8'));
test('N8 SPENT not 0', () => refusesWith((m, s) => { s.spent = 1; }, 'spent_not_0'));
test('N9 receipt namespace not README-only', () => refusesWith((m, s) => { s.receiptsReadmeOnly = false; }, 'receipts_not_readme_only'));

test('N10 stale GPT authority, and a marker lifted from another ruling', () => {
  refusesWith((m, s) => { s.isNewestRuling = false; }, 'stale_authority');
  refusesWith((m, s) => { s.rulingId = 'AR-1282'; }, 'ruling_id_mismatch');
});

test('N11 arbitrary repo', () => refusesWith((m) => { m.repo = 'attacker/trading-forge'; }, 'wrong_repo'));

test('N12 arbitrary executable cannot be supplied — the schema is closed', () => {
  refusesWith((m) => { m.executable = 'C:/evil.exe'; }, 'unknown_field');
  assert.equal(LAUNCH_EXECUTABLE, 'claude');
  assert.ok(LAUNCH_ARGV.includes('--dangerously-skip-permissions'));
});

test('N13 arbitrary settings path cannot be supplied', () => {
  refusesWith((m) => { m.settings_path = '/tmp/permissive.json'; }, 'unknown_field');
  const plan = buildPlan(baselineMarker(), baselineMeasured());
  assert.ok(plan.settings_guard_template.settings_path.endsWith(SEAT_SETTINGS_REL));
});

test('N14 arbitrary worktree path cannot be supplied — it is DERIVED', () => {
  refusesWith((m) => { m.worktree_path = 'C:/anywhere'; }, 'unknown_field');
  assert.equal(deriveBranch('AR-1279'), 'control-plane/ar-1279-guard-repair');
  assert.equal(deriveWorktreeDirName('AR-1279'), 'wt-control-plane-ar-1279');
});

test('N15 replayed authorization identity', () => {
  refusesWith((m, s) => { s.claimedAuthorizationIds = new Set(['cpb-2026-08-16-0001']); }, 'replayed_authorization');
});

test('N16 no ruling may authorize a path in the frozen G2 plane', () => {
  for (const bad of [
    'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json',
    'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/x.json',
    'docs/replay-results/svkm-extraction-certified/grade/opus-v2/native_call_manifest_t1.json',
  ]) {
    refusesWith((m) => { m.allowed_paths = [bad]; }, 'forbidden_g2_path');
  }
  const v = classifyControlPlanePath('docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/a.json', ['docs/']);
  assert.equal(v.verdict, 'DENY_CATEGORICAL');
});

test('N17 the seat may not launch an Agent/subagent instead of top-level Claude', () => {
  for (const tool of ['Agent', 'Task', 'PowerShell']) {
    assert.equal(classifyControlPlaneTool(tool).verdict, 'DENY', `${tool} must be denied`);
  }
  const denied = decide({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Agent', tool_input: {} }, seatManifest(), seatObserved(), armedStore());
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  const plan = buildPlan(baselineMarker(), baselineMeasured());
  assert.equal(plan.planned_process.top_level, true);
  assert.equal(plan.planned_process.is_subagent, false);
});

test('N18 (§10.12 preserved) the AR-1276C example block REFUSES as non-executable', () => {
  const AR1276C_EXAMPLE = ['```json', JSON.stringify({
    schema: MARKER_SCHEMA,
    actor: 'top-level-control-plane-guard-repair',
    execution: 'ONE_BOOTSTRAP_EXECUTION',
    source_actor: 'worker-1',
    target_packet: 'AR-1278',
    frozen_queue_sha256: QUEUE_SHA,
    require_ready: 8,
    require_spent: 0,
    require_receipts: 'README_ONLY',
    require_agent_model_executions_before_launch: 0,
    hands_free: true,
  }, null, 2), '```'].join('\n');
  const found = extractCandidateMarkers(AR1276C_EXAMPLE);
  assert.equal(found.length, 1, 'the example must be EXTRACTED, then refused');
  const v = validateAuthorization(found[0], baselineMeasured());
  assert.equal(v.ok, false);
  assert.equal(v.code, 'missing_field');
  assert.match(v.detail, /authorization_class/);
});

/* =============================== REGRESSIONS ALREADY EARNED ================================ */

test('REGRESSION: a ruling revision letter is part of the ruling identity', () => {
  assert.equal(rulingIdFromFilename('AR-1276C-GPT-OPERATOR-RULING-WORKER1-AUTHORIZED.md'), 'AR-1276C');
  assert.equal(rulingIdFromFilename('AR-1276-GPT-EXTERNAL-ADVISOR-RULING-AR1275.md'), 'AR-1276');
  assert.equal(rulingIdFromFilename('no-ruling-here.md'), null);
});

test('MUTATION: the executable/example discriminator is what does the work', () => {
  refusesWith((m) => { m.authorization_class = 'EXAMPLE'; }, 'not_executable');
  refusesWith((m) => { m.authorization_class = 'executable'; }, 'not_executable');
  refusesWith((m) => { delete m.authorization_class; }, 'missing_field');
  assert.equal(validateAuthorization(baselineMarker(), baselineMeasured()).ok, true);
});

/* =============================== §10.8 / §10.9  SOURCE + BUNDLE PINNING ==================== */

test('C8 source-SHA negative: a marker pinned to a different Worker HEAD refuses', () => {
  refusesWith((m) => { m.bootstrap_source_sha = 'a'.repeat(40); }, 'bootstrap_source_sha_mismatch');
  refusesWith((m) => { m.bootstrap_source_sha = 'not-a-sha'; }, 'bad_bootstrap_source_sha');
});

test('C9 bundle mutation negative: ONE byte in ANY covered file refuses', () => {
  for (const victim of BUNDLE_FILES) {
    const mutated = (rel) => (rel === victim
      ? Buffer.concat([fakeBundleReader(rel), Buffer.from('.')]) // one byte
      : fakeBundleReader(rel));
    const sha = computeBundle(mutated).bundle_sha256;
    assert.notEqual(sha, BUNDLE_SHA, `mutating ${victim} must change the bundle`);
    const measured = baselineMeasured();
    measured.bootstrapBundleSha256 = sha;
    const v = validateAuthorization(baselineMarker(), measured);
    assert.equal(v.ok, false);
    assert.equal(v.code, 'bootstrap_bundle_mismatch', `${victim} must refuse`);
  }
});

test('C9b the bundle is order-independent and length-sensitive', () => {
  assert.equal(computeBundle(fakeBundleReader, [...BUNDLE_FILES].reverse()).bundle_sha256, BUNDLE_SHA);
  const truncated = (rel) => fakeBundleReader(rel).subarray(0, 4);
  assert.notEqual(computeBundle(truncated).bundle_sha256, BUNDLE_SHA);
});

/* =============================== §10.3  BASH SIDE-DOOR ==================================== */

const bashCtx = { allowedPaths: ['.claude/settings.json', 'CLAUDE.md'], branch: BRANCH };

test('C3 Bash side-door negative: a non-G2, non-allowed file mutation DENIES', () => {
  // The exact defect AR-1277A F-2 named: no frozen-G2 token anywhere in the command.
  for (const cmd of [
    'git add README.md',
    'git add src/server/index.ts',
    'cp evil.txt README.md',
    'tee README.md',
    'sed -i s/a/b/ README.md',
  ]) {
    const v = classifyControlPlaneBash(cmd, bashCtx);
    assert.equal(v.verdict, 'DENY', `must deny: ${cmd}`);
  }
});

test('C3b Bash composition and arbitrary passthrough DENY', () => {
  for (const cmd of [
    'git status --porcelain | tee out.txt',
    'git status --porcelain && rm -rf .',
    'git status --porcelain; echo hi',
    'node -e "require(\'fs\').writeFileSync(\'x\',\'y\')"',
    'python -c "open(\'x\',\'w\')"',
    'bash -c "git add README.md"',
    'npx something',
    'git add $(echo README.md)',
  ]) {
    assert.equal(classifyControlPlaneBash(cmd, bashCtx).verdict, 'DENY', `must deny: ${cmd}`);
  }
});

test('C3c the small allowed set still works, and staging respects the path boundary', () => {
  for (const cmd of ['git status --porcelain', 'git rev-parse HEAD', 'git log --oneline -5', 'git diff --stat']) {
    assert.equal(classifyControlPlaneBash(cmd, bashCtx).verdict, 'ALLOW', `must allow: ${cmd}`);
  }
  assert.equal(classifyControlPlaneBash('git add CLAUDE.md', bashCtx).verdict, 'ALLOW');
  assert.equal(classifyControlPlaneBash('git add docs/other.md', bashCtx).verdict, 'DENY');
  assert.equal(classifyControlPlaneBash(`git push origin ${BRANCH}`, bashCtx).verdict, 'ALLOW');
  assert.equal(classifyControlPlaneBash('git push origin main', bashCtx).verdict, 'DENY');
});

/* =============================== §10.4 / §10.5  SELF-DISARM vs REPAIR ===================== */

test('C4 guard-self-disarm negative: the seat cannot touch what registers its own guard', () => {
  for (const target of [SEAT_SETTINGS_REL, SEAT_MANIFEST_REL, 'docs/replay-results/control-plane-bootstrap/claims/x.json']) {
    const v = classifyControlPlanePath(target, ['.claude/', 'docs/']);
    assert.equal(v.verdict, 'DENY_CATEGORICAL', `${target} must be categorically denied`);
  }
  // ...and no ruling may authorize them either.
  refusesWith((m) => { m.allowed_paths = [SEAT_SETTINGS_REL]; }, 'forbidden_g2_path');
  // ...and not via Bash either.
  assert.equal(classifyControlPlaneBash(`git add ${SEAT_SETTINGS_REL}`, { allowedPaths: ['.claude/'], branch: BRANCH }).verdict, 'DENY');
});

test('C5 project-settings-edit control: the repairable file IS still repairable', () => {
  // The whole point of F-3: the packet must be able to do its job.
  assert.equal(classifyControlPlanePath('.claude/settings.json', ['.claude/settings.json']).verdict, 'ALLOW');
  assert.equal(classifyControlPlanePath('.claude/worker1-hook-guard-manifest.json', ['.claude/worker1-hook-guard-manifest.json']).verdict, 'ALLOW');
  assert.equal(classifyControlPlanePath('CLAUDE.md', ['CLAUDE.md']).verdict, 'ALLOW');
  // and the guard that permits that lives somewhere else entirely
  assert.notEqual(SEAT_SETTINGS_REL, '.claude/settings.json');
  const s = seatSettingsFor();
  assert.match(s.hooks.PreToolUse[0].hooks[0].command, /control-plane-seat-hook\.mjs/);
  for (const tool of ['Edit', 'Write', 'Bash', 'Agent', 'Task', 'PowerShell']) {
    assert.ok(s.hooks.PreToolUse[0].matcher.includes(tool), `matcher must cover ${tool}`);
  }
});

/* =============================== §10.1 / §10.2 / §10.11  LIVE IDENTITY =================== */

const seatManifest = () => ({
  actor: 'top-level-control-plane-guard-repair',
  repo: REPO,
  branch: BRANCH,
  worktree: WORKTREE,
  head: HEAD,
  target_packet: 'AR-1279',
  authorization_id: 'cpb-2026-08-16-0001',
  ruling_id: 'AR-1281',
  frozen_queue_sha256: QUEUE_SHA,
  bootstrap_bundle_sha256: BUNDLE_SHA,
  allowed_paths: ['.claude/settings.json', 'CLAUDE.md'],
});

const seatObserved = (over = {}) => ({
  repo: REPO,
  worktree: WORKTREE,
  branch: BRANCH,
  head: HEAD,
  actor: 'top-level-control-plane-guard-repair',
  targetPacket: 'AR-1279',
  authorizationId: 'cpb-2026-08-16-0001',
  rulingId: 'AR-1281',
  queueSha256: QUEUE_SHA,
  bundleSha256: BUNDLE_SHA,
  ready: 8,
  spent: 0,
  receiptsReadmeOnly: true,
  isSubagent: false,
  gitDir: `${WORKTREE}/.git`,
  ...over,
});

function armedStore(seed = true) {
  const map = new Map();
  const store = {
    readReceipt: (sid) => map.get(sid) ?? null,
    writeReceipt: (sid, body) => map.set(sid, body),
    _map: map,
  };
  if (seed) {
    store.writeReceipt('s1', {
      schema: 'CONTROL_PLANE_ARMED_RECEIPT_V1',
      session_id: 's1', repo: REPO, worktree: WORKTREE, branch: BRANCH, head: HEAD,
      frozen_queue_sha256: QUEUE_SHA,
    });
  }
  return store;
}

test('C2 real-measurement control: observed identity comes from the ENVIRONMENT, not the manifest', () => {
  // The manifest LIES about branch/head/worktree/repo. measureObservedIdentity must ignore it.
  const lying = { repo: 'attacker/repo', branch: 'control-plane/ar-1279-guard-repair', worktree: '/fake', head: 'f'.repeat(40) };
  const io = {
    git: (...a) => {
      const k = a.join(' ');
      if (k === 'config --get remote.origin.url') return 'git@github.com:swayz032/trading-forge.git';
      if (k === 'rev-parse --show-toplevel') return '/real/worktree';
      if (k === 'rev-parse --abbrev-ref HEAD') return 'some/other-branch';
      if (k === 'rev-parse HEAD') return 'd'.repeat(40);
      if (k === 'rev-parse --absolute-git-dir') return '/real/worktree/.git';
      return '';
    },
    readFileBytes: () => Buffer.from(JSON.stringify({ queue: new Array(8).fill({}), attempts: {} })),
    listDir: () => ['README.md'],
    realpath: (p) => p,
  };
  const observed = measureObservedIdentity(io, lying);
  assert.equal(observed.repo, REPO, 'repo must come from git remote');
  assert.equal(observed.worktree, '/real/worktree');
  assert.equal(observed.branch, 'some/other-branch', 'branch must come from git, not the manifest');
  assert.equal(observed.head, 'd'.repeat(40), 'head must come from git, not the manifest');
});

test('C1 manifest-lie negative: a lying manifest cannot make the live hook pass', () => {
  // Live git says we are on a different branch than the manifest claims.
  const observed = seatObserved({ branch: 'claude/worker1-h1-20260815' });
  const out = decide(
    { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'CLAUDE.md' } },
    seatManifest(), observed, armedStore(),
  );
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /identity_mismatch_branch/);
});

test('C11 identity mutation matrix: EVERY load-bearing identity field DENIES when it differs', () => {
  const alt = {
    repo: 'attacker/repo', worktree: '/elsewhere', branch: 'main', head: 'e'.repeat(40),
    actor: 'worker-1', targetPacket: 'AR-9999', authorizationId: 'other', rulingId: 'AR-0001',
    queueSha256: EXTRACTION_SHA_TRAP, bundleSha256: 'f'.repeat(64),
  };
  for (const field of IDENTITY_FIELDS) {
    const out = decide(
      { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'CLAUDE.md' } },
      seatManifest(), seatObserved({ [field]: alt[field] }), armedStore(),
    );
    assert.equal(out?.hookSpecificOutput?.permissionDecision, 'deny', `${field} mismatch must DENY`);
  }
  // frozen drift and subagent identity are refused too
  for (const over of [{ ready: 7 }, { spent: 1 }, { receiptsReadmeOnly: false }, { isSubagent: true }]) {
    const out = decide(
      { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'CLAUDE.md' } },
      seatManifest(), seatObserved(over), armedStore(),
    );
    assert.equal(out?.hookSpecificOutput?.permissionDecision, 'deny', `${JSON.stringify(over)} must DENY`);
  }
  // CONTROL: unmutated, the same call is permitted (null = no objection)
  assert.equal(
    decide({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'CLAUDE.md' } }, seatManifest(), seatObserved(), armedStore()),
    null,
  );
});

/* =============================== §10.10  DURABLE START RECEIPT =========================== */

test('C10 durable start receipt: SessionStart writes it, PreToolUse refuses without it', () => {
  const store = armedStore(false);
  assert.equal(store.readReceipt('s1'), null);

  // No receipt yet -> every tool call denies, even a perfectly authorized one.
  const before = decide(
    { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'CLAUDE.md' } },
    seatManifest(), seatObserved(), store,
  );
  assert.equal(before.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(before.hookSpecificOutput.permissionDecisionReason, /no armed receipt/);

  // SessionStart arms it durably.
  const armed = decide({ hook_event_name: 'SessionStart', session_id: 's1' }, seatManifest(), seatObserved(), store);
  assert.match(armed.hookSpecificOutput.additionalContext, /CONTROL-PLANE SEAT ARMED/);
  assert.ok(store.readReceipt('s1'), 'a durable receipt must exist after SessionStart');

  // Now the same call is permitted.
  assert.equal(
    decide({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'CLAUDE.md' } }, seatManifest(), seatObserved(), store),
    null,
  );

  // A receipt from a DIFFERENT session cannot be borrowed.
  const borrowed = decide(
    { hook_event_name: 'PreToolUse', session_id: 's2', tool_name: 'Edit', tool_input: { file_path: 'CLAUDE.md' } },
    seatManifest(), seatObserved(), store,
  );
  assert.equal(borrowed.hookSpecificOutput.permissionDecision, 'deny');
});

test('C10b a stale receipt (seat moved since arming) DENIES', () => {
  const store = armedStore();
  const moved = seatObserved({ head: 'a'.repeat(40) });
  // identity still matches the manifest? no — manifest pins head, so use a manifest that moved too
  const manifest = { ...seatManifest(), head: 'a'.repeat(40) };
  const out = decide(
    { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'CLAUDE.md' } },
    manifest, moved, store,
  );
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /receipt_drift_head/);
  assert.equal(receiptMatchesLive({ repo: REPO, worktree: WORKTREE, branch: BRANCH, head: HEAD, frozen_queue_sha256: QUEUE_SHA }, moved).ok, false);
});

test('SessionStart without identity does NOT arm', () => {
  const store = armedStore(false);
  const out = decide({ hook_event_name: 'SessionStart', session_id: 's1' }, seatManifest(), seatObserved({ branch: 'main' }), store);
  assert.match(out.hookSpecificOutput.additionalContext, /NOT ARMED/);
  assert.equal(store.readReceipt('s1'), null, 'a refused SessionStart must not leave a receipt');
});

/* =============================== SEAT GUARD: DEFAULT DENY ================================= */

test('SEAT: unrecognised tool DENIES; missing manifest DENIES', () => {
  const out = decide({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'SomeFutureTool', tool_input: {} }, seatManifest(), seatObserved(), armedStore());
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /default deny/);

  const noManifest = decide({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'CLAUDE.md' } }, null, seatObserved(), armedStore());
  assert.equal(noManifest.hookSpecificOutput.permissionDecision, 'deny');
});

test('SEAT: verifySeatIdentity refuses when the authorization fails to pin a field', () => {
  const incomplete = { ...seatManifest() };
  delete incomplete.head;
  const v = verifySeatIdentity(seatObserved(), {
    repo: REPO, worktree: WORKTREE, branch: BRANCH, head: undefined,
    actor: 'top-level-control-plane-guard-repair', targetPacket: 'AR-1279',
    authorizationId: 'cpb-2026-08-16-0001', rulingId: 'AR-1281',
    queueSha256: QUEUE_SHA, bundleSha256: BUNDLE_SHA,
  });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'expected_missing_head');
});

/* =============================== PLAN + NAMESPACE ========================================= */

test('GREEN: the plan carries every required field, and executes nothing', () => {
  const plan = buildPlan(baselineMarker(), baselineMeasured());
  for (const field of [
    'repo_identity', 'source_worker_branch', 'source_worker_head', 'target_actor_class',
    'target_packet', 'proposed_target_branch', 'proposed_target_worktree', 'settings_guard_template',
    'gpt_authority_branch', 'frozen_queue_sha256_required', 'ready_required', 'spent_required',
    'receipt_namespace_required', 'planned_process', 'planned_operations',
    'bootstrap_source_sha_required', 'bootstrap_bundle_sha256_required',
  ]) {
    assert.ok(plan[field] !== undefined, `plan is missing required field ${field}`);
  }
  assert.equal(plan.executed, false);
});

test('C6 claim-first control: no mutating step precedes the claim', () => {
  const plan = buildPlan(baselineMarker(), baselineMeasured());
  const claim = plan.planned_operations.find((o) => o.op === 'write_claim');
  const mutatingBefore = plan.planned_operations.filter((o) => o.mutating === true && o.step < claim.step);
  assert.deepEqual(mutatingBefore, [], 'the claim must be the FIRST mutation');
  assert.ok(plan.planned_operations.find((o) => o.op === 'launch_seat').step > claim.step);
  assert.ok(plan.planned_operations.find((o) => o.op === 'create_branch_and_worktree').step > claim.step);
});

test('GREEN: the replay-claim namespace is disjoint from the frozen G2 receipt namespace', () => {
  assert.equal(assertClaimNamespaceDisjoint(), true);
  assert.throws(
    () => assertClaimNamespaceDisjoint('docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/claims'),
    /overlaps the frozen G2 receipt namespace/,
  );
});

/* =============================== LIVE: --init-only LOCAL-HOOK DISCOVERY =================== */

/**
 * AR-1278A §12.9 — the zero-model live proof, explicitly authorized.
 *
 * `claude --init-only` runs Setup + SessionStart hooks and exits WITHOUT starting a conversation,
 * so this costs no model call. It proves two things a unit test cannot:
 *   1. Claude Code itself DISCOVERS and INVOKES a hook registered only in the LOCAL settings source;
 *   2. it still does so when PROJECT settings carry `disableAllHooks: true`, provided the
 *      higher-priority Local source explicitly carries `disableAllHooks: false` (F-11).
 *
 * The fixture lives in the OS temp directory and is removed afterwards: nothing is written into the
 * repository, and no protected surface is touched.
 */
test('LIVE C9: Claude Code invokes a LOCAL-source SessionStart hook even when project settings disable hooks', async (t) => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const pathMod = await import('node:path');
  const cp = await import('node:child_process');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'cp-initonly-'));
  try {
    fs.mkdirSync(pathMod.join(dir, '.claude'), { recursive: true });
    const witness = pathMod.join(dir, 'HOOK_FIRED.txt').replaceAll('\\', '/');
    const hookScript = pathMod.join(dir, 'hook.mjs').replaceAll('\\', '/');
    fs.writeFileSync(hookScript, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(witness)}, 'fired');\nprocess.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'probe'}}));\n`);

    // PROJECT settings try to switch every hook off — the exact F-11 attack.
    fs.writeFileSync(pathMod.join(dir, '.claude', 'settings.json'), JSON.stringify({ disableAllHooks: true }, null, 2));
    // LOCAL settings outrank them and say otherwise, and register the hook.
    fs.writeFileSync(pathMod.join(dir, '.claude', 'settings.local.json'), JSON.stringify({
      disableAllHooks: false,
      hooks: { SessionStart: [{ matcher: 'startup|resume|fork', hooks: [{ type: 'command', command: `node "${hookScript}"`, timeout: 30 }] }] },
    }, null, 2));

    // MEASURED: Claude Code refuses to launch inside another Claude Code session and names the
    // bypass itself — "unset the CLAUDECODE environment variable". The child gets a scrubbed env.
    // This is a separate top-level process, in a temp cwd, running hooks and exiting with NO
    // conversation, which is precisely the mode AR-1278A §12.9 authorized.
    const childEnv = { ...process.env };
    delete childEnv.CLAUDECODE;
    delete childEnv.CLAUDE_CODE_SSE_PORT;
    delete childEnv.CLAUDE_CODE_ENTRYPOINT;

    let failure = null;
    try {
      cp.execFileSync('claude', ['--init-only', '--setting-sources', 'user,project,local'], {
        cwd: dir, encoding: 'utf8', timeout: 120000, stdio: 'pipe', env: childEnv,
      });
    } catch (error) {
      failure = `${error.status ?? error.code} ${String(error.stderr || error.message).slice(0, 300)}`;
    }
    if (failure) {
      // 🛑 SKIP, NOT PASS. An earlier revision of this test `return`ed here and printed a green
      // tick while proving nothing — the same false-green shape convicted twice already in this
      // campaign. An unrunnable probe is an UNKNOWN and must report as one.
      t.skip(`--init-only could not run: ${failure}`);
      return;
    }

    assert.ok(
      fs.existsSync(witness),
      'Claude Code did NOT invoke the LOCAL-source SessionStart hook — the F-3/F-11 design rests on this',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* =============================== END-TO-END, ZERO EFFECTS ================================= */

/**
 * The fake serves a synthetic 8-row queue, so its digest is NOT the production one. The fixture
 * marker must therefore pin the FAKE's digest — computed here by the same hash the code uses, never
 * hand-copied. (Pinning the production SHA here made the authorized-path fixtures refuse at the
 * frozen check, which was a harness defect, not a code defect.)
 */
const FAKE_QUEUE_JSON = JSON.stringify({ queue: new Array(8).fill({}), attempts: {} });
const FAKE_QUEUE_SHA = createHash('sha256').update(Buffer.from(FAKE_QUEUE_JSON)).digest('hex');

function fakeIo({ rulingText, rulingFile = 'advisor-reports/AR-1281-EXAMPLE.md', claimed = [] }) {
  const queue = FAKE_QUEUE_JSON;
  return {
    repoRoot: 'C:/Users/tonio/Projects/wt-claude-worker1-20260815',
    git: (...args) => {
      const a = args.join(' ');
      if (a.startsWith('fetch')) return '';
      if (a === 'rev-parse origin/external-advisor/gpt-rulings') return '9bf12d20';
      if (a.startsWith('show --name-only')) return rulingFile;
      if (a.startsWith('show ')) return rulingText;
      if (a === 'rev-parse --abbrev-ref HEAD') return 'claude/worker1-h1-20260815';
      if (a === 'rev-parse HEAD') return HEAD;
      if (a === 'config --get remote.origin.url') return 'git@github.com:swayz032/trading-forge.git';
      return '';
    },
    readFile: () => queue,
    readFileBytes: (rel) => (BUNDLE_FILES.includes(rel) ? fakeBundleReader(rel) : Buffer.from(queue)),
    listDir: (rel) => (String(rel).includes('claims') ? claimed.map((c) => `${c}.json`) : ['README.md']),
    exists: () => true,
  };
}

function recordingEffects() {
  const calls = [];
  return {
    calls,
    writeClaim: (...a) => calls.push(['writeClaim', ...a]),
    createBranchAndWorktree: (...a) => calls.push(['createBranchAndWorktree', ...a]),
    writeSeatGuard: (...a) => calls.push(['writeSeatGuard', ...a]),
    proveDoorway: (...a) => { calls.push(['proveDoorway', ...a]); return 'CONTROL-PLANE SEAT ARMED: ok'; },
    launchSeat: (...a) => { calls.push(['launchSeat', ...a]); return 4242; },
  };
}

const validRuling = (over = {}) => ['```json', JSON.stringify({ ...baselineMarker(), frozen_queue_sha256: FAKE_QUEUE_SHA, ...over }, null, 2), '```'].join('\n');

test('C14 END-TO-END: refusal paths request ZERO effects', () => {
  for (const [label, text] of [
    ['no marker', 'A ruling with prose and no marker at all.'],
    ['example block', validRuling({ authorization_class: undefined })],
    ['wrong bundle', validRuling({ bootstrap_bundle_sha256: 'f'.repeat(64) })],
    ['wrong source sha', validRuling({ bootstrap_source_sha: 'a'.repeat(40) })],
  ]) {
    const effects = recordingEffects();
    const result = run({ mode: 'execute', io: fakeIo({ rulingText: text }), effects });
    assert.equal(result.authorized, false, `${label} must refuse`);
    assert.equal(result.executed, false);
    assert.deepEqual(effects.calls, [], `${label}: NO effect may be requested on a refusal path`);
  }
});

test('C6b END-TO-END: on the authorized path the FIRST effect is the claim', () => {
  const effects = recordingEffects();
  const result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling() }), effects, now: 'T' });
  assert.equal(result.authorized, true, JSON.stringify(result.refusal));
  assert.equal(effects.calls[0][0], 'writeClaim', 'the claim must be the first effect requested');
  assert.deepEqual(effects.calls.map((c) => c[0]), ['writeClaim', 'createBranchAndWorktree', 'writeSeatGuard', 'proveDoorway', 'launchSeat']);
});

test('C7 crash-shaped replay control: a claimed authorization is never reusable', () => {
  const effects = recordingEffects();
  // Simulates the crash window: the claim landed, everything after it did not.
  const result = run({
    mode: 'execute',
    io: fakeIo({ rulingText: validRuling(), claimed: ['cpb-2026-08-16-0001'] }),
    effects,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.refusal.code, 'all_markers_refused');
  assert.match(result.refusal.detail, /replayed_authorization/);
  assert.deepEqual(effects.calls, [], 'a replay must request no effects at all');
});

test('C7b a doorway that does not arm REFUSES to launch (claim already spent, by design)', () => {
  const effects = recordingEffects();
  effects.proveDoorway = (...a) => { effects.calls.push(['proveDoorway', ...a]); return 'CONTROL-PLANE GUARD NOT ARMED: whatever'; };
  const result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling() }), effects, now: 'T' });
  assert.equal(result.executed, false);
  assert.equal(result.refusal.code, 'doorway_not_armed');
  assert.ok(!effects.calls.some((c) => c[0] === 'launchSeat'), 'must not launch on an unarmed doorway');
});
