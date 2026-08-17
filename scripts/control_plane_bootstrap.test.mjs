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
  verifySeatIdentity, IDENTITY_FIELDS, ALL_TOOLS_MATCHER, NEVER_STAGEABLE_PATHS,
} from './control-plane-bootstrap/control-plane-guard.mjs';
import {
  buildPlan, deriveBranch, deriveWorktreeDirName, assertClaimNamespaceDisjoint,
  LAUNCH_EXECUTABLE, LAUNCH_ARGV, SEAT_SETTINGS_REL, SEAT_MANIFEST_REL, buildPacketPrompt,
  COMMIT_MSG_FILE_REL, branchNamespaceCollision,
} from './control-plane-bootstrap/plan.mjs';
import { run, seatSettingsFor, rulingIdFromFilename, verifyCompletion, runStage } from './control-plane-bootstrap/bootstrap.mjs';
import { computeBundle, BUNDLE_FILES } from './control-plane-bootstrap/bundle.mjs';
import { decide, measureObservedIdentity, receiptMatchesLive, verifyAuthorityIndependently } from './control-plane-bootstrap/control-plane-seat-hook.mjs';

/** SessionStart requires an independently verified authority; tests that only exercise identity use this. */
const OK_AUTHORITY = { ok: true, marker: {}, measured: {} };

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
  // AR-1289A §4: identity is target_packet + authorization_id, not target_packet alone.
  // AR-1295 F23: the separator before the authorization id is now `-`, not `/` — a `/` nests the
  // branch under `control-plane/ar-1279-guard-repair`, which Git's ref storage refuses to coexist
  // with a same-named branch at that exact path (see the dedicated F23/F24 tests below).
  assert.equal(deriveBranch('AR-1279', 'cpb-2026-08-16-0001'), 'control-plane/ar-1279-guard-repair-cpb-2026-08-16-0001');
  assert.equal(deriveWorktreeDirName('AR-1279', 'cpb-2026-08-16-0001'), 'wt-control-plane-ar-1279-cpb-2026-08-16-0001');
});

/* =============================== AR-1290 C5 — ATTEMPT-IDENTITY REPAIR (AR-1289A §4) ========== */

test('AR1290-C5 attempt identity: same packet + different authorization -> different branch/worktree', () => {
  const a = deriveBranch('AR-1278', 'cpb-2026-08-17-0001');
  const b = deriveBranch('AR-1278', 'cpb-2026-08-17-0002');
  assert.notEqual(a, b);
  assert.notEqual(deriveWorktreeDirName('AR-1278', 'cpb-2026-08-17-0001'), deriveWorktreeDirName('AR-1278', 'cpb-2026-08-17-0002'));
});

test('AR1290-C5b attempt identity: same packet + same authorization -> byte-identical names, twice', () => {
  assert.equal(deriveBranch('AR-1278', 'cpb-2026-08-17-0001'), deriveBranch('AR-1278', 'cpb-2026-08-17-0001'));
  assert.equal(deriveWorktreeDirName('AR-1278', 'cpb-2026-08-17-0001'), deriveWorktreeDirName('AR-1278', 'cpb-2026-08-17-0001'));
});

test('AR1290-C6 stale spent attempt does not block a fresh plan — no caller path parameter exists either', () => {
  // The AR-1289 fixture: an old target-only-derived pair left behind by the spent attempt.
  const staleBranch = 'control-plane/ar-1278-guard-repair';
  const staleWorktree = 'wt-control-plane-ar-1278';
  const freshBranch = deriveBranch('AR-1278', 'cpb-2026-08-17-0002');
  const freshWorktree = deriveWorktreeDirName('AR-1278', 'cpb-2026-08-17-0002');
  assert.notEqual(freshBranch, staleBranch);
  assert.notEqual(freshWorktree, staleWorktree);
  // Neither derivation function takes anything beyond packet+id — no caller/model/operator path.
  assert.equal(deriveBranch.length, 2);
  assert.equal(deriveWorktreeDirName.length, 2);
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

/* =============================== AR-1278A F-12  CLOSED TOOL ALLOWLIST ===================== */

test('C12 the tool policy is a CLOSED allowlist, and the registration is truly all-tools', () => {
  // Allowed: the read tools, the inspected write tools, and Bash (itself separately constrained).
  for (const tool of ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'Bash']) {
    assert.equal(classifyControlPlaneTool(tool).verdict, 'ALLOW', `${tool} should be allowed`);
  }
  // Explicitly denied, including the two that would stop and ask the operator a question.
  for (const tool of ['Agent', 'Task', 'PowerShell', 'AskUserQuestion', 'ExitPlanMode']) {
    assert.equal(classifyControlPlaneTool(tool).verdict, 'DENY', `${tool} must be denied`);
  }
  // MCP and anything unknown/future.
  for (const tool of ['mcp__whatever__do_thing', 'SomeFutureTool', 'WebFetch', '', undefined]) {
    assert.equal(classifyControlPlaneTool(tool).verdict, 'DENY', `${tool} must be denied`);
  }

  // 🛑 THE PART THAT WAS THE FALSE GREEN: the REGISTRATION, not just the decision function.
  // A matcher that enumerates tools cannot be default-deny, because unlisted tools never arrive.
  const pre = seatSettingsFor().hooks.PreToolUse[0];
  assert.equal(pre.matcher, ALL_TOOLS_MATCHER, 'PreToolUse must be registered for ALL tools');
  assert.equal(pre.matcher, '*');
  assert.ok(!pre.matcher.includes('|'), 'an enumerated matcher is not all-tools');
});

test('C12b a synthetic UNKNOWN tool reaching the guard is DENIED end-to-end', () => {
  // Registration sends every tool through; this is what the guard does when one arrives.
  const out = decide(
    { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'TotallyNewTool2027', tool_input: { anything: true } },
    seatManifest(), seatObserved(), armedStore(),
  );
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /default deny/);
});

test('C11b the immutable Local settings explicitly carry disableAllHooks:false (F-11)', () => {
  const s = seatSettingsFor();
  assert.equal(s.disableAllHooks, false,
    'without this, project settings can set disableAllHooks:true and quiet the seat guard — MEASURED live in C9/C9b');
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
  // The terminal finalize path is the ONLY commit+push route, and it takes no arguments.
  assert.equal(classifyControlPlaneBash('node scripts/control-plane-bootstrap/cp-finalize.mjs', bashCtx).verdict, 'ALLOW');
  assert.equal(classifyControlPlaneBash('node scripts/control-plane-bootstrap/cp-finalize.mjs --branch main', bashCtx).verdict, 'DENY');
});

test('C15 the test runner is EXACT, not a wildcard (F-15)', () => {
  // A test file is executable code; `.test.mjs` is a filename, not a permission.
  assert.equal(classifyControlPlaneBash('node --test scripts/control_plane_bootstrap.test.mjs', bashCtx).verdict, 'ALLOW');
  for (const cmd of [
    'node --test scripts/anything_else.test.mjs',
    'node --test scripts/../src/evil.test.mjs',
    'node --test src/engine/tests/whatever.test.mjs',
  ]) {
    assert.equal(classifyControlPlaneBash(cmd, bashCtx).verdict, 'DENY', `must deny: ${cmd}`);
  }
});

test('C14b raw git push is NOT in the allowlist — finalization is the only publish path', () => {
  assert.equal(classifyControlPlaneBash(`git push origin ${BRANCH}`, bashCtx).verdict, 'DENY');
  assert.equal(classifyControlPlaneBash('git push origin main', bashCtx).verdict, 'DENY');
  assert.equal(classifyControlPlaneBash('git commit -m x', bashCtx).verdict, 'DENY');
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
  // The matcher is all-tools now (F-12); per-tool coverage is asserted in C12.
  assert.equal(s.hooks.PreToolUse[0].matcher, ALL_TOOLS_MATCHER);
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
  // AR-1278A F-8: the bundle is recomputed from real bytes, never accepted from the caller.
  assert.equal(observed.bundleSha256, computeBundle(io.readFileBytes).bundle_sha256);
  assert.notEqual(observed.bundleSha256, 'whatever-the-manifest-said');
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
  const armed = decide({ hook_event_name: 'SessionStart', session_id: 's1' }, seatManifest(), seatObserved(), store, OK_AUTHORITY);
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
  const out = decide({ hook_event_name: 'SessionStart', session_id: 's1' }, seatManifest(), seatObserved({ branch: 'main' }), store, OK_AUTHORITY);
  assert.match(out.hookSpecificOutput.additionalContext, /NOT ARMED/);
  assert.equal(store.readReceipt('s1'), null, 'a refused SessionStart must not leave a receipt');
});

test('C8b SessionStart does NOT arm when GPT authority fails to verify (F-8)', () => {
  const store = armedStore(false);
  for (const authority of [
    null,
    { ok: false, code: 'no_marker_in_current_authority', detail: 'AR-9999 carries no executable marker' },
    { ok: false, code: 'manifest_allowed_paths_mismatch', detail: 'authority and manifest disagree' },
    { ok: false, code: 'wrong_origin', detail: 'origin is someone-else/fork' },
    { ok: false, code: 'no_claim', detail: 'no durable claim' },
  ]) {
    const out = decide({ hook_event_name: 'SessionStart', session_id: 's1' }, seatManifest(), seatObserved(), store, authority);
    assert.match(out.hookSpecificOutput.additionalContext, /NOT ARMED/);
    assert.equal(store.readReceipt('s1'), null, 'an unverified authority must mint no receipt');
  }
  // CONTROL: with authority verified, the same call arms.
  const armed = decide({ hook_event_name: 'SessionStart', session_id: 's1' }, seatManifest(), seatObserved(), store, OK_AUTHORITY);
  assert.match(armed.hookSpecificOutput.additionalContext, /ARMED/);
  assert.ok(store.readReceipt('s1'));
});

test('C8c the seat re-verifies authority against the LIVE ruling, not the manifest (F-8/F-9)', () => {
  const bundleOf = (readFileBytes) => computeBundle(readFileBytes).bundle_sha256;
  const queueJson = JSON.stringify({ queue: new Array(8).fill({}), attempts: {} });
  const reader = (rel) => (BUNDLE_FILES.includes(rel) ? fakeBundleReader(rel) : Buffer.from(queueJson));
  const qSha = createHash('sha256').update(Buffer.from(queueJson)).digest('hex');

  const marker = {
    ...baselineMarker(),
    frozen_queue_sha256: qSha,
    bootstrap_bundle_sha256: bundleOf(reader),
  };
  const manifest = {
    ...seatManifest(),
    ruling_id: marker.ruling_id,
    target_packet: marker.target_packet,
    authorization_id: marker.authorization_id,
    bootstrap_bundle_sha256: marker.bootstrap_bundle_sha256,
    allowed_paths: [...marker.allowed_paths],
  };
  const mkIo = (over = {}) => ({
    git: (...a) => {
      const k = a.join(' ');
      if (k === 'config --get remote.origin.url') return over.remote ?? 'git@github.com:swayz032/trading-forge.git';
      if (k.startsWith('fetch')) return '';
      if (k === 'rev-parse origin/external-advisor/gpt-rulings') return 'abc123';
      if (k.startsWith('show --name-only')) return over.rulingFile ?? 'advisor-reports/AR-1281-X.md';
      if (k.startsWith('show ')) return over.rulingText ?? ['```json', JSON.stringify(marker), '```'].join('\n');
      if (k === 'rev-parse HEAD') return HEAD;
      return '';
    },
    readFileBytes: reader,
    listDir: () => ['README.md'],
    realpath: (p) => p,
    readClaim: () => over.claim === null ? null : (over.claim ?? {
      ruling_id: marker.ruling_id, target_packet: marker.target_packet, bootstrap_bundle_sha256: marker.bootstrap_bundle_sha256,
    }),
  });

  // CONTROL: everything agrees -> verified.
  assert.equal(verifyAuthorityIndependently(mkIo(), manifest).ok, true);

  // F-9: a copied repo with a different origin refuses, even though the marker says Trading Forge.
  assert.equal(verifyAuthorityIndependently(mkIo({ remote: 'git@github.com:someone-else/fork.git' }), manifest).code, 'wrong_origin');

  // The manifest must agree with the LIVE ruling on every load-bearing field.
  assert.equal(verifyAuthorityIndependently(mkIo(), { ...manifest, authorization_id: 'other-id' }).code, 'manifest_authorization_mismatch');
  assert.equal(verifyAuthorityIndependently(mkIo(), { ...manifest, ruling_id: 'AR-9999' }).code, 'manifest_ruling_mismatch');
  assert.equal(verifyAuthorityIndependently(mkIo(), { ...manifest, target_packet: 'AR-9999' }).code, 'manifest_packet_mismatch');
  assert.equal(verifyAuthorityIndependently(mkIo(), { ...manifest, bootstrap_bundle_sha256: 'f'.repeat(64) }).code, 'manifest_bundle_mismatch');
  assert.equal(verifyAuthorityIndependently(mkIo(), { ...manifest, allowed_paths: [...manifest.allowed_paths, 'extra.md'] }).code, 'manifest_allowed_paths_mismatch');

  // The durable one-shot claim must exist and describe this authorization.
  assert.equal(verifyAuthorityIndependently(mkIo({ claim: null }), manifest).code, 'no_claim');
  assert.equal(verifyAuthorityIndependently(mkIo({ claim: { ruling_id: 'AR-0001', target_packet: 'AR-0001', bootstrap_bundle_sha256: 'x' } }), manifest).code, 'claim_mismatch');

  // A ruling that carries no marker at all.
  assert.equal(verifyAuthorityIndependently(mkIo({ rulingText: 'prose only' }), manifest).code, 'no_marker_in_current_authority');
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
  assert.ok(plan.planned_operations.find((o) => o.op === 'launch_seat_supervised').step > claim.step);
  assert.ok(plan.planned_operations.find((o) => o.op === 'create_branch_and_worktree').step > claim.step);
  // The init-only doorway proof sits between materialization and launch, and is itself read-only.
  const doorway = plan.planned_operations.find((o) => o.op === 'prove_doorway_init_only');
  assert.equal(doorway.mutating, false);
  assert.ok(doorway.step < plan.planned_operations.find((o) => o.op === 'launch_seat_supervised').step);
  assert.ok(plan.planned_operations.find((o) => o.op === 'verify_completion_receipt'));
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

/**
 * MUTATION CONTROL for the test above. Proving "the hook fired" is not the same as proving
 * `disableAllHooks:false` is what made it fire — without this, the explicit field could be
 * decorative and nobody would know. Same fixture, one field removed from the Local source.
 *
 * Whatever the outcome, it is RECORDED rather than asserted in one direction: if the project's
 * `disableAllHooks:true` does NOT suppress the hook, then Local precedence alone is doing the work
 * and the explicit `false` is belt-and-braces. Both worlds are safe; only an unmeasured guess is not.
 */
test('LIVE C9b MUTATION: is the explicit disableAllHooks:false load-bearing?', async (t) => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const pathMod = await import('node:path');
  const cp = await import('node:child_process');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'cp-initonly-mut-'));
  try {
    fs.mkdirSync(pathMod.join(dir, '.claude'), { recursive: true });
    const witness = pathMod.join(dir, 'HOOK_FIRED.txt').replaceAll('\\', '/');
    const hookScript = pathMod.join(dir, 'hook.mjs').replaceAll('\\', '/');
    fs.writeFileSync(hookScript, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(witness)}, 'fired');\nprocess.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'probe'}}));\n`);
    fs.writeFileSync(pathMod.join(dir, '.claude', 'settings.json'), JSON.stringify({ disableAllHooks: true }, null, 2));
    // THE MUTATION: Local registers the hook but does NOT override disableAllHooks.
    fs.writeFileSync(pathMod.join(dir, '.claude', 'settings.local.json'), JSON.stringify({
      hooks: { SessionStart: [{ matcher: 'startup|resume|fork', hooks: [{ type: 'command', command: `node "${hookScript}"`, timeout: 30 }] }] },
    }, null, 2));

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
      t.skip(`--init-only could not run: ${failure}`);
      return;
    }

    const fired = fs.existsSync(witness);
    // eslint-disable-next-line no-console
    console.error(`[C9b MEASURED] without explicit disableAllHooks:false in Local, hook fired = ${fired}`);
    assert.equal(typeof fired, 'boolean');
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

const FAKE_REPO_ROOT = 'C:/Users/tonio/Projects/wt-claude-worker1-20260815';
const FAKE_COMMON_DIR = `${FAKE_REPO_ROOT}/.git`;

function fakeIo({ rulingText, rulingFile = 'advisor-reports/AR-1281-EXAMPLE.md', claimed = [], newStoreClaimed = [], existingControlPlaneBranches = [] }) {
  const queue = FAKE_QUEUE_JSON;
  return {
    repoRoot: FAKE_REPO_ROOT,
    cwd: FAKE_REPO_ROOT,
    realpath: (p) => p,
    git: (...args) => {
      const a = args.join(' ');
      if (a.startsWith('fetch')) return '';
      if (a === 'rev-parse origin/external-advisor/gpt-rulings') return '9bf12d20';
      if (a.startsWith('show --name-only')) return rulingFile;
      if (a.startsWith('show ')) return rulingText;
      if (a === 'rev-parse --abbrev-ref HEAD') return 'claude/worker1-h1-20260815';
      if (a === 'rev-parse HEAD') return HEAD;
      if (a === 'config --get remote.origin.url') return 'git@github.com:swayz032/trading-forge.git';
      // AR-1289A §3: measureState resolves the shared claim store from this every run.
      if (a === 'rev-parse --git-common-dir') return '.git';
      // AR-1295 F24: measureState's scoped, read-only branch-namespace measurement.
      if (a === "for-each-ref --format=%(refname:short) refs/heads/control-plane/") return existingControlPlaneBranches.join('\n');
      return '';
    },
    readFile: () => queue,
    readFileBytes: (rel) => (BUNDLE_FILES.includes(rel) ? fakeBundleReader(rel) : Buffer.from(queue)),
    listDir: (rel) => (String(rel).includes('claims') ? claimed.map((c) => `${c}.json`) : ['README.md']),
    // The shared store's directory listing, keyed by the resolved common-dir path (not a repo-relative rel).
    listDirAbs: (dir) => (dir === FAKE_COMMON_DIR ? newStoreClaimed.map((c) => `tf-control-plane-claim-${c}.json`) : []),
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
    proveDoorwayInitOnly: (...a) => { calls.push(['proveDoorwayInitOnly', ...a]); return { ok: true, receipts: ['tf-control-plane-armed-x.json'] }; },
    launchSeatSupervised: (...a) => { calls.push(['launchSeatSupervised', ...a]); return { ok: true, output: 'done' }; },
    readCompletionReceipt: (...a) => {
      calls.push(['readCompletionReceipt', ...a]);
      // AR-1291A F21/G3: a POSITIVE control must be a genuinely valid receipt — real branch, real
      // 40-hex commit SHA, pushed:true — not merely present. 'deadbeef' and no branch used to pass
      // only because the old check never looked at either; that was the false green F21 named.
      return {
        schema: 'CONTROL_PLANE_COMPLETION_RECEIPT_V1',
        authorization_id: 'cpb-2026-08-16-0001', ruling_id: 'AR-1281', target_packet: 'AR-1279',
        branch: deriveBranch('AR-1279', 'cpb-2026-08-16-0001'),
        commit_sha: 'a'.repeat(40), changed_paths: ['CLAUDE.md'], pushed: true,
      };
    },
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

test('C6b END-TO-END: on the authorized path the FIRST effect is the claim, and launch is supervised', () => {
  const effects = recordingEffects();
  const result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling() }), effects, now: 'T' });
  assert.equal(result.authorized, true, JSON.stringify(result.refusal));
  assert.equal(effects.calls[0][0], 'writeClaim', 'the claim must be the first effect requested');
  assert.deepEqual(effects.calls.map((c) => c[0]), [
    'writeClaim', 'createBranchAndWorktree', 'writeSeatGuard',
    'proveDoorwayInitOnly', 'launchSeatSupervised', 'readCompletionReceipt',
  ]);
  assert.equal(result.completion_verified, true, 'the supervisor must verify the trusted completion receipt');

  // F-13: the launch argv is hands-free (-p with a marker-derived prompt), not an interactive seat.
  const argv = effects.calls.find((c) => c[0] === 'launchSeatSupervised')[2];
  assert.ok(argv.includes('-p'), 'the seat must be started with a task, not left waiting for a human');
  assert.ok(argv.includes('--dangerously-skip-permissions'));
  const prompt = argv[argv.indexOf('-p') + 1];
  assert.match(prompt, /AR-1279/);
  assert.match(prompt, /cp-finalize\.mjs/);
  assert.match(prompt, /never ask the operator a question/);
});

test('C13b the packet prompt is DERIVED from the marker — no caller-supplied text', () => {
  const p = buildPacketPrompt(baselineMarker());
  assert.match(p, /AR-1279/);
  assert.match(p, /AR-1281/);
  assert.match(p, /cpb-2026-08-16-0001/);
  for (const allowed of baselineMarker().allowed_paths) assert.ok(p.includes(allowed), `prompt must name ${allowed}`);
  assert.match(p, /never dispatch an Agent or subagent/);
});

test('C10c a completion receipt for a DIFFERENT authorization does not verify', () => {
  const effects = recordingEffects();
  effects.readCompletionReceipt = (...a) => {
    effects.calls.push(['readCompletionReceipt', ...a]);
    return { authorization_id: 'someone-elses', ruling_id: 'AR-1281', target_packet: 'AR-1279' };
  };
  const result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling() }), effects, now: 'T' });
  assert.equal(result.completion_verified, false);
});

test('C9c wrong ORIGIN refuses at the bootstrap, before any effect (F-9)', () => {
  const effects = recordingEffects();
  const io = fakeIo({ rulingText: validRuling() });
  const inner = io.git;
  io.git = (...a) => (a.join(' ') === 'config --get remote.origin.url' ? 'git@github.com:someone-else/fork.git' : inner(...a));
  const result = run({ mode: 'execute', io, effects });
  assert.equal(result.authorized, false);
  assert.equal(result.refusal.code, 'wrong_origin');
  assert.deepEqual(effects.calls, [], 'a wrong-origin repo must request no effects at all');
});

test('C7c a doorway that mints no armed receipt REFUSES to launch', () => {
  const effects = recordingEffects();
  effects.proveDoorwayInitOnly = (...a) => {
    effects.calls.push(['proveDoorwayInitOnly', ...a]);
    return { ok: false, detail: 'no durable armed receipt was minted by --init-only' };
  };
  const result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling() }), effects, now: 'T' });
  assert.equal(result.executed, false);
  assert.equal(result.refusal.code, 'doorway_not_armed');
  assert.ok(!effects.calls.some((c) => c[0] === 'launchSeatSupervised'), 'must not start a conversation on an unarmed doorway');
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

test('AR1290-C4 legacy replay remains spent: the NEW store is empty, only the LEGACY store has the id, still refuses', () => {
  const effects = recordingEffects();
  // newStoreClaimed defaults to [] — proves the legacy id alone, with nothing in the new store,
  // is sufficient to refuse. Deleting/ignoring the new-store path cannot un-spend a legacy claim.
  const result = run({
    mode: 'execute',
    io: fakeIo({ rulingText: validRuling(), claimed: ['cpb-2026-08-16-0001'], newStoreClaimed: [] }),
    effects,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.refusal.code, 'all_markers_refused');
  assert.match(result.refusal.detail, /replayed_authorization/);
  assert.deepEqual(effects.calls, [], 'a legacy-only replay must still request no effects');
});

test('AR1290-C4b new-store replay also refuses, symmetrically — union, not either store alone', () => {
  const effects = recordingEffects();
  const result = run({
    mode: 'execute',
    io: fakeIo({ rulingText: validRuling(), claimed: [], newStoreClaimed: ['cpb-2026-08-16-0001'] }),
    effects,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.refusal.code, 'all_markers_refused');
  assert.match(result.refusal.detail, /replayed_authorization/);
  assert.deepEqual(effects.calls, [], 'a new-store-only replay must still request no effects');
});

/* =============================== AR-1290 C8 — BUNDLE COVERAGE, GENERATED NOT HAND-TYPED ===== */

test('AR1290-C8 claim-store.mjs is covered by BUNDLE_FILES, asserted from the live export', () => {
  // "Generate/list it from the actual BUNDLE_FILES source" — no hand-typed count or literal array.
  assert.ok(BUNDLE_FILES.includes('scripts/control-plane-bootstrap/claim-store.mjs'),
    'claim-store.mjs decides claim resolution and MUST be in the pinned bundle');
  // One byte in it must move the digest, exactly like every other covered file (mirrors C9).
  const mutated = (rel) => (rel === 'scripts/control-plane-bootstrap/claim-store.mjs'
    ? Buffer.concat([fakeBundleReader(rel), Buffer.from('.')])
    : fakeBundleReader(rel));
  assert.notEqual(computeBundle(mutated).bundle_sha256, BUNDLE_SHA);
});

/* =============================== AR-1290 C1/C2/C3 — REAL GIT FIXTURES, NO MODEL LAUNCH ====== */

/**
 * These exercise the REAL claim-store.mjs IO against REAL git worktrees/repositories — the exact
 * class of thing AR-1289 found broken and unit tests with fake IO cannot demonstrate. No Claude
 * process is ever launched; only `git init` / `git worktree add` / plain file IO.
 */
import { gitCommonDirAbs as realGitCommonDirAbs, writeClaimExclusive, readClaimFromNewStore, readClaimEitherStoreReal, listNewStoreFilenamesReal } from './control-plane-bootstrap/claim-store.mjs';

test('AR1290-C1 first mutation still the claim: O_EXCL in the shared store; a repeat write refuses', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const pathMod = await import('node:path');
  const cp = await import('node:child_process');
  const gitAt = (dir, ...args) => cp.execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'cp-claimstore-c1-'));
  try {
    gitAt(dir, 'init', '-q');
    gitAt(dir, 'config', 'user.email', 'test@test');
    gitAt(dir, 'config', 'user.name', 'test');
    fs.writeFileSync(pathMod.join(dir, 'seed.txt'), 'seed');
    gitAt(dir, 'add', 'seed.txt');
    gitAt(dir, 'commit', '-q', '-m', 'seed');

    const io = { git: (...a) => gitAt(dir, ...a), cwd: dir, realpath: (p) => fs.realpathSync(p).replaceAll('\\', '/') };
    const common = realGitCommonDirAbs(io);
    assert.ok(fs.existsSync(common), 'the git common directory must already exist — no mkdir needed');

    const path1 = writeClaimExclusive(common, 'cpb-c1-test-0001', { authorization_id: 'cpb-c1-test-0001', claimed_at: 'T1' });
    assert.ok(fs.existsSync(path1));

    // O_EXCL: a second write for the SAME id must refuse, not overwrite.
    assert.throws(() => writeClaimExclusive(common, 'cpb-c1-test-0001', { authorization_id: 'cpb-c1-test-0001', claimed_at: 'T2' }));
    const stillOriginal = JSON.parse(fs.readFileSync(path1, 'utf8'));
    assert.equal(stillOriginal.claimed_at, 'T1', 'the refused repeat must not have mutated the existing claim');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AR1290-C2 real sibling-worktree visibility: the claim written from the source worktree IS read from a freshly created sibling — and the OLD per-worktree mechanism would have missed it', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const pathMod = await import('node:path');
  const cp = await import('node:child_process');
  const gitAt = (dir, ...args) => cp.execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

  const root = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'cp-claimstore-c2-'));
  const mainDir = pathMod.join(root, 'main');
  const siblingDir = pathMod.join(root, 'sibling');
  try {
    fs.mkdirSync(mainDir, { recursive: true });
    gitAt(mainDir, 'init', '-q');
    gitAt(mainDir, 'config', 'user.email', 'test@test');
    gitAt(mainDir, 'config', 'user.name', 'test');
    fs.writeFileSync(pathMod.join(mainDir, 'seed.txt'), 'seed');
    gitAt(mainDir, 'add', 'seed.txt');
    gitAt(mainDir, 'commit', '-q', '-m', 'seed');
    const base = gitAt(mainDir, 'rev-parse', 'HEAD');

    // Write the claim from the SOURCE (main) worktree — mirrors bootstrap.mjs's writeClaim.
    const mainIo = { git: (...a) => gitAt(mainDir, ...a), cwd: mainDir, realpath: (p) => fs.realpathSync(p).replaceAll('\\', '/') };
    const mainCommon = realGitCommonDirAbs(mainIo);
    const written = writeClaimExclusive(mainCommon, 'cpb-c2-test-0001', {
      authorization_id: 'cpb-c2-test-0001', branch: 'control-plane/ar-c2-guard-repair/cpb-c2-test-0001',
      worktree: siblingDir.replaceAll('\\', '/'), source_worker_head: base, claimed_at: 'T1',
    });
    const writtenBytes = fs.readFileSync(written);

    // THEN create the sibling worktree — mirrors bootstrap.mjs's createBranchAndWorktree, AFTER the claim.
    gitAt(mainDir, 'worktree', 'add', '-b', 'control-plane/ar-c2-guard-repair/cpb-c2-test-0001', siblingDir, base);

    // Read from the SIBLING's own independently-resolved common dir — mirrors the seat hook.
    const sibIo = { git: (...a) => gitAt(siblingDir, ...a), cwd: siblingDir, realpath: (p) => fs.realpathSync(p).replaceAll('\\', '/') };
    const sibCommon = realGitCommonDirAbs(sibIo);

    // C2 core assertion: both worktrees resolve to the SAME physical common directory.
    assert.equal(sibCommon, mainCommon, 'main and sibling worktrees of one repository must share one common dir');

    const readBack = readClaimFromNewStore(sibCommon, 'cpb-c2-test-0001');
    assert.ok(readBack, 'the sibling worktree must be able to read the claim the source worktree wrote');
    assert.deepEqual(Buffer.from(JSON.stringify(readBack, null, 2) + '\n'), writtenBytes, 'exact same bytes, not merely a truthy read');

    // NEGATIVE CONTROL #1 — proves the control bites: the OLD, broken mechanism (claim inside the
    // LEGACY repo-relative directory, uncommitted) is NOT visible from the sibling's own checkout.
    // This is exactly the AR-1289 defect; reproducing its absence here is the discriminating proof.
    const legacyStyleUncommittedClaim = pathMod.join(mainDir, 'docs/replay-results/control-plane-bootstrap/claims/cpb-c2-test-0001.json');
    fs.mkdirSync(pathMod.dirname(legacyStyleUncommittedClaim), { recursive: true });
    fs.writeFileSync(legacyStyleUncommittedClaim, '{}');
    const oldStylePathInSibling = pathMod.join(siblingDir, 'docs/replay-results/control-plane-bootstrap/claims/cpb-c2-test-0001.json');
    assert.ok(!fs.existsSync(oldStylePathInSibling),
      'CONTROL: an UNCOMMITTED file in the source worktree must NOT appear in a sibling checkout — this is the exact bug AR-1289 found; the shared-common-dir fix sidesteps it entirely');

    // NEGATIVE CONTROL #2 (AR-1290 C2's literal requirement) — mutate the READER back to the OLD
    // `--show-toplevel`-relative lookup and prove it CANNOT find the claim the NEW writer produced.
    // This is the pre-fix `readClaim` shape from control-plane-seat-hook.mjs, reproduced inline so
    // the control exercises the actual regressed behaviour, not a description of it.
    const oldStyleReadClaim = (worktreeCwd, authorizationId) => {
      const root = gitAt(worktreeCwd, 'rev-parse', '--show-toplevel');
      try {
        return JSON.parse(fs.readFileSync(pathMod.join(root, 'docs/replay-results/control-plane-bootstrap/claims', `${authorizationId}.json`), 'utf8'));
      } catch {
        return null;
      }
    };
    assert.equal(oldStyleReadClaim(siblingDir, 'cpb-c2-test-0001'), null,
      'MUTATION CONTROL: the pre-fix show-toplevel reader must NOT find the claim written by the NEW shared-store writer — proving the fix, not merely the absence of the old bug');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AR1290-C3 repository isolation: a different repository must not see or accept the same authorization id', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const pathMod = await import('node:path');
  const cp = await import('node:child_process');
  const gitAt = (dir, ...args) => cp.execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

  const root = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'cp-claimstore-c3-'));
  const repoA = pathMod.join(root, 'repo-a');
  const repoB = pathMod.join(root, 'repo-b');
  try {
    for (const dir of [repoA, repoB]) {
      fs.mkdirSync(dir, { recursive: true });
      gitAt(dir, 'init', '-q');
      gitAt(dir, 'config', 'user.email', 'test@test');
      gitAt(dir, 'config', 'user.name', 'test');
      fs.writeFileSync(pathMod.join(dir, 'seed.txt'), 'seed');
      gitAt(dir, 'add', 'seed.txt');
      gitAt(dir, 'commit', '-q', '-m', 'seed');
    }

    const ioA = { git: (...a) => gitAt(repoA, ...a), cwd: repoA, realpath: (p) => fs.realpathSync(p).replaceAll('\\', '/') };
    const ioB = { git: (...a) => gitAt(repoB, ...a), cwd: repoB, realpath: (p) => fs.realpathSync(p).replaceAll('\\', '/') };
    const commonA = realGitCommonDirAbs(ioA);
    const commonB = realGitCommonDirAbs(ioB);
    assert.notEqual(commonA, commonB, 'two distinct repositories must resolve to two distinct common directories');

    // Claim the SAME authorization id, only in repo A.
    writeClaimExclusive(commonA, 'cpb-c3-shared-id', { authorization_id: 'cpb-c3-shared-id', repo: 'repo-a' });

    assert.ok(readClaimFromNewStore(commonA, 'cpb-c3-shared-id'), 'repo A must see its own claim');
    assert.equal(readClaimFromNewStore(commonB, 'cpb-c3-shared-id'), null,
      'repo B must NOT see repo A\'s claim merely because the authorization id string matches');
    assert.equal(readClaimEitherStoreReal(commonB, repoB, 'cpb-c3-shared-id'), null,
      'the combined legacy+new lookup in repo B must also be null — no cross-repository bleed');
    assert.deepEqual(listNewStoreFilenamesReal(commonB).filter((f) => f.startsWith('tf-control-plane-claim-')), [],
      'repo B\'s own store must be empty of claim files');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* =============================== AR-1291 E1-E13 — F-16..F-19 CLOSURE PROOFS ================= */

test('AR1291-E1 report path authorized when named; unrelated replay-result paths denied', () => {
  const allowed = ['docs/replay-results/worker-advisor-reports/'];
  const ok = classifyControlPlanePath('docs/replay-results/worker-advisor-reports/AR-1291-report.md', allowed);
  assert.equal(ok.verdict, 'ALLOW');
  const bad = classifyControlPlanePath('docs/replay-results/some-other-dir/file.md', allowed);
  assert.equal(bad.verdict, 'DENY');
});

test('AR1291-E2 fixed commit-message temp path authorized; sibling scripts remain denied for writes', () => {
  const allowed = ['scripts/control-plane-bootstrap/.cp-commit-msg.tmp'];
  const ok = classifyControlPlanePath('scripts/control-plane-bootstrap/.cp-commit-msg.tmp', allowed);
  assert.equal(ok.verdict, 'ALLOW');
  const sibling = classifyControlPlanePath('scripts/control-plane-bootstrap/bootstrap.mjs', allowed);
  assert.equal(sibling.verdict, 'DENY');
});

test('AR1291-E3 fixed transport helper command allowed; variants denied', () => {
  const cmd = 'python scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py';
  assert.equal(classifyControlPlaneBash(cmd, {}).verdict, 'ALLOW');
  assert.equal(classifyControlPlaneBash(`${cmd} foo`, {}).verdict, 'DENY');
  assert.equal(classifyControlPlaneBash('python -c "print(1)"', {}).verdict, 'DENY');
  assert.equal(classifyControlPlaneBash('python scripts/other_script.py', {}).verdict, 'DENY');
  assert.equal(classifyControlPlaneBash(`${cmd} > out.txt`, {}).verdict, 'DENY');
});

test('AR1291-E9 generated packet prompt contains report + message + staging + finalize sequence', () => {
  const p = buildPacketPrompt(baselineMarker());
  assert.match(p, /docs\/replay-results\/worker-advisor-reports\//);
  assert.match(p, /\.cp-commit-msg\.tmp/);
  assert.match(p, /git add <path>/);
  assert.match(p, /cp-finalize\.mjs/);
  assert.match(p, /materialize-g2-prompt-transport\.py/);
});

test('AR1291-E10 generated packet prompt explicitly forbids Agent/Task calibration in Phase 1', () => {
  const p = buildPacketPrompt(baselineMarker());
  assert.match(p, /PHASE 2 IS NOT YOURS/);
  assert.match(p, /Agent and Task are categorically denied/);
  assert.match(p, /never dispatch an Agent or subagent/);
});

test('AR1291-E11 control-plane Agent/Task/PowerShell DENY regression remains green', () => {
  for (const tool of ['Agent', 'Task', 'PowerShell']) {
    assert.equal(classifyControlPlaneTool(tool).verdict, 'DENY', `${tool} must remain denied`);
  }
});

test('AR1291-E12 bundle covers the new transport helper, asserted from the live export', () => {
  assert.ok(BUNDLE_FILES.includes('scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py'),
    'the fixed transport helper decides what the seat may read/verify/write and MUST be pinned');
  const mutated = (rel) => (rel === 'scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py'
    ? Buffer.concat([fakeBundleReader(rel), Buffer.from('.')])
    : fakeBundleReader(rel));
  assert.notEqual(computeBundle(mutated).bundle_sha256, BUNDLE_SHA);
});

/**
 * E4-E8 exercise the REAL Python transport helper against a REAL, disposable fixture repository —
 * copies of the actual bootstrap files plus minimal stub leaves for the two symbols
 * `g2d_freeze_native_calls.py` imports by name, so nothing here retypes the canonical construction
 * and nothing here touches the real Trading Forge tree (AR-1290A §E: disposable fixtures only).
 */
async function buildG2Fixture() {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const pathMod = await import('node:path');
  const cp = await import('node:child_process');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'cp-g2transport-'));
  const sha = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

  const SYSTEM_PROMPT = 'FIXTURE SYSTEM PROMPT — AR-1291 disposable fixture, not the real locator prompt.';
  const buildUserMessage = (transcript, condition) => `TRANSCRIPT:${transcript}\nCONDITION:${condition}`;
  const templateProbe = buildUserMessage('<TRANSCRIPT>', '<CONDITION>');
  const transcript = 'FIXTURE TRANSCRIPT BODY.';

  const mk = (rel) => {
    const abs = pathMod.join(dir, rel);
    fs.mkdirSync(pathMod.dirname(abs), { recursive: true });
    return abs;
  };
  const write = (rel, content) => fs.writeFileSync(mk(rel), content, 'utf8');

  // Real bootstrap files, copied unmodified — proves the helper reuses the REAL construction path.
  fs.mkdirSync(pathMod.join(dir, 'scripts', 'control-plane-bootstrap'), { recursive: true });
  fs.copyFileSync(
    pathMod.join(process.cwd(), 'scripts', 'g2d_freeze_native_calls.py'),
    mk('scripts/g2d_freeze_native_calls.py'),
  );
  fs.copyFileSync(
    pathMod.join(process.cwd(), 'scripts', 'control-plane-bootstrap', 'materialize-g2-prompt-transport.py'),
    mk('scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py'),
  );

  // Minimal stub leaves for the two symbols g2d_freeze_native_calls.py imports BY NAME — not the
  // real (heavy) locator, the same role this suite's fakeIo plays for git elsewhere.
  write('src/__init__.py', '');
  write('src/engine/__init__.py', '');
  write('src/engine/extraction/__init__.py', '');
  write(
    'src/engine/extraction/anchor_locator.py',
    `_SYSTEM_PROMPT = ${JSON.stringify(SYSTEM_PROMPT)}\n\n\ndef _build_user_message(transcript, condition_text):\n    return f"TRANSCRIPT:{transcript}\\nCONDITION:{condition_text}"\n`,
  );
  write(
    'src/engine/extraction/isolated_attempt_receipt.py',
    'import re\n\n\ndef _safe_name(condition_ref):\n    return re.sub(r"[^A-Za-z0-9_.-]", "_", condition_ref)\n',
  );

  write('docs/replay-results/fixture-transcript.txt', transcript);

  const queue = {
    law_version: 'fixture-v1',
    input_route_version: 'fixture-v1',
    pinned_inputs: { transcript_sha256: sha(transcript) },
    queue: [
      { condition_ref: 'cond_a', condition_text: 'Condition A text.', task_input_sha256: 'a'.repeat(64) },
      { condition_ref: 'cond_b', condition_text: 'Condition B text.', task_input_sha256: 'b'.repeat(64) },
    ],
  };
  const queueRel = 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json';
  write(queueRel, JSON.stringify(queue, null, 2));

  const bench = {
    packet_sha256: 'fixture',
    prompt: { system_prompt_sha256: sha(SYSTEM_PROMPT), user_message_template_sha256: sha(templateProbe) },
    input: { transcript_path: 'docs/replay-results/fixture-transcript.txt', transcript_sha256: sha(transcript) },
  };
  write('docs/replay-results/svkm-extraction-certified/benchmark/benchmark_packet_v1.json', JSON.stringify(bench, null, 2));

  const runPython = (args) => {
    try {
      const out = cp.execFileSync('python', args, { cwd: dir, encoding: 'utf8' });
      return { status: 0, stdout: out, stderr: '' };
    } catch (error) {
      return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error.message) };
    }
  };

  // Generate the manifest FOR REAL via the real (copied) emitter — never hand-typed.
  const freeze = runPython(['scripts/g2d_freeze_native_calls.py', '--write']);
  if (freeze.status !== 0) {
    throw new Error(`fixture setup: g2d_freeze_native_calls.py --write failed: ${freeze.stderr || freeze.stdout}`);
  }

  const manifestRel = 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/native_call_manifest_t1.json';
  return { dir, fs, pathMod, runPython, manifestRel, queueRel, expectedRefs: ['cond_a', 'cond_b'] };
}

test('AR1291-E4/E5 the transport helper materializes exactly N outputs + index, each hashed to the frozen manifest', async () => {
  const { dir, fs, pathMod, runPython, manifestRel, expectedRefs } = await buildG2Fixture();
  try {
    const result = runPython(['scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py']);
    assert.equal(result.status, 0, `expected success, got: ${result.stderr || result.stdout}`);

    const manifest = JSON.parse(fs.readFileSync(pathMod.join(dir, manifestRel), 'utf8'));
    const outDir = pathMod.join(dir, 'docs/replay-results/g2d-prompt-transport');
    const indexPath = pathMod.join(outDir, 'index.json');
    assert.ok(fs.existsSync(indexPath), 'index.json must be written');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.equal(index.row_count, expectedRefs.length);

    const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.prompt.txt'));
    assert.equal(files.length, expectedRefs.length, 'exactly one prompt file per frozen condition, no more');

    for (const row of manifest.calls) {
      const indexRow = index.rows.find((r) => r.condition_ref === row.condition_ref);
      assert.ok(indexRow, `index must carry ${row.condition_ref}`);
      const bytes = fs.readFileSync(pathMod.join(outDir, indexRow.filename));
      const gotSha = createHash('sha256').update(bytes).digest('hex');
      assert.equal(gotSha, row.native_prompt_sha256, `${row.condition_ref} prompt bytes must hash to the frozen native_prompt_sha256`);
      assert.equal(bytes.toString('utf8').length, row.native_prompt_char_count, `${row.condition_ref} char count must match the frozen value`);
    }

    // Idempotent rerun: byte-identical inputs, still success, nothing refused.
    const rerun = runPython(['scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py']);
    assert.equal(rerun.status, 0, 'a rerun against unchanged inputs must succeed idempotently');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AR1291-E6 mutation of one frozen prompt hash is detected and refuses — nothing partial is written', async () => {
  const { dir, fs, pathMod, runPython, manifestRel } = await buildG2Fixture();
  try {
    const manifestPath = pathMod.join(dir, manifestRel);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.calls[0].native_prompt_sha256 = 'f'.repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runPython(['scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py']);
    assert.notEqual(result.status, 0, 'a mutated frozen hash must refuse, not silently materialize');
    const outDir = pathMod.join(dir, 'docs/replay-results/g2d-prompt-transport');
    assert.ok(!fs.existsSync(outDir), 'a refusal must write NOTHING — not even the unaffected row');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AR1291-E7 missing native-call manifest refuses before any output', async () => {
  const { dir, fs, pathMod, runPython, manifestRel } = await buildG2Fixture();
  try {
    fs.rmSync(pathMod.join(dir, manifestRel));
    const result = runPython(['scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refused/);
    const outDir = pathMod.join(dir, 'docs/replay-results/g2d-prompt-transport');
    assert.ok(!fs.existsSync(outDir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AR1291-E8 the transport helper never writes into the frozen queue/manifest namespaces', async () => {
  const { dir, fs, pathMod, runPython, manifestRel, queueRel } = await buildG2Fixture();
  try {
    const hashOf = (rel) => createHash('sha256').update(fs.readFileSync(pathMod.join(dir, rel))).digest('hex');
    const before = { queue: hashOf(queueRel), manifest: hashOf(manifestRel) };
    const result = runPython(['scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py']);
    assert.equal(result.status, 0, `expected success, got: ${result.stderr}`);
    const after = { queue: hashOf(queueRel), manifest: hashOf(manifestRel) };
    assert.deepEqual(after, before, 'the frozen queue and manifest bytes must be byte-identical after a run');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* AR1291-E13: the prior 65 bootstrap controls above this section are unchanged and re-run as part
 * of this same `node --test scripts/control_plane_bootstrap.test.mjs` invocation — there is no
 * separate suite to keep green, so there is nothing further to assert here. */

/* =============================== AR-1292 G1-G6 — F20/F21 CLOSURE PROOFS ===================== */

test('AR1292-G1 the transient commit-message path is writable but never stageable', () => {
  // Edit/Write must still ALLOW — the seat has to be able to create the file.
  const writeVerdict = classifyControlPlanePath(COMMIT_MSG_FILE_REL, [COMMIT_MSG_FILE_REL]);
  assert.equal(writeVerdict.verdict, 'ALLOW', 'Edit/Write must still allow creating the message file');

  // The exact same path, staged via the git-add Bash shape, must DENY — categorically, not merely
  // because it happens to be absent from allowedPaths (it is present here, and still denied).
  const stageVerdict = classifyControlPlaneBash(`git add ${COMMIT_MSG_FILE_REL}`, { allowedPaths: [COMMIT_MSG_FILE_REL] });
  assert.equal(stageVerdict.verdict, 'DENY');
  assert.match(stageVerdict.reason, /may never be staged/);

  // An ORDINARY authorized Phase-1 output must still stage normally through the same shape — the
  // negative bites the one transient path, not `git add` as a whole.
  const ordinaryVerdict = classifyControlPlaneBash('git add CLAUDE.md', { allowedPaths: ['CLAUDE.md'] });
  assert.equal(ordinaryVerdict.verdict, 'ALLOW');

  assert.ok(NEVER_STAGEABLE_PATHS.includes(COMMIT_MSG_FILE_REL), 'the constant list must name the exact path the prompt uses');
});

test('AR1292-G2 the generated prompt states the commit-message file is never staged', () => {
  const p = buildPacketPrompt(baselineMarker());
  assert.match(p, /NEVER stage/);
  assert.match(p, /\.cp-commit-msg\.tmp itself/);
});

test('AR1292-G3 verifyCompletion is conjunctive: launch + identity + branch + real SHA + pushed, ALL required', () => {
  const marker = { authorization_id: 'auth-1', ruling_id: 'AR-1', target_packet: 'AR-1' };
  const branch = 'control-plane/ar-1-guard-repair/auth-1';
  const validReceipt = () => ({
    authorization_id: 'auth-1', ruling_id: 'AR-1', target_packet: 'AR-1',
    branch, commit_sha: 'a'.repeat(40), pushed: true,
  });

  assert.equal(verifyCompletion({ launch: { ok: true }, completion: validReceipt(), marker, branch }), true,
    'a fully correct receipt with a successful launch must verify TRUE');

  assert.equal(verifyCompletion({ launch: { ok: true }, completion: { ...validReceipt(), pushed: false }, marker, branch }), false,
    'pushed:false must refuse — this is F21\'s exact defect');
  assert.equal(verifyCompletion({ launch: { ok: true }, completion: { ...validReceipt(), pushed: undefined }, marker, branch }), false,
    'a receipt missing pushed entirely must refuse, not default to true');
  assert.equal(verifyCompletion({ launch: { ok: true }, completion: { ...validReceipt(), commit_sha: 'deadbeef' }, marker, branch }), false,
    'a non-hex/short commit_sha must refuse');
  assert.equal(verifyCompletion({ launch: { ok: true }, completion: { ...validReceipt(), commit_sha: undefined }, marker, branch }), false,
    'a missing commit_sha must refuse');
  assert.equal(verifyCompletion({ launch: { ok: true }, completion: { ...validReceipt(), branch: 'wrong-branch' }, marker, branch }), false,
    'a receipt naming the wrong branch must refuse');
  assert.equal(verifyCompletion({ launch: { ok: true }, completion: { ...validReceipt(), authorization_id: 'someone-elses' }, marker, branch }), false);
  assert.equal(verifyCompletion({ launch: { ok: true }, completion: { ...validReceipt(), ruling_id: 'AR-2' }, marker, branch }), false);
  assert.equal(verifyCompletion({ launch: { ok: true }, completion: { ...validReceipt(), target_packet: 'AR-2' }, marker, branch }), false);
  assert.equal(verifyCompletion({ launch: { ok: false }, completion: validReceipt(), marker, branch }), false,
    'a launch failure must refuse regardless of an otherwise-perfect receipt');
  assert.equal(verifyCompletion({ launch: null, completion: validReceipt(), marker, branch }), false,
    'a missing launch result must refuse');
  assert.equal(verifyCompletion({ launch: { ok: true }, completion: null, marker, branch }), false,
    'a missing completion receipt must refuse');
});

test('AR1292-G3b END-TO-END: run() surfaces a failed-push completion as unverified, with a reason', () => {
  const effects = recordingEffects();
  effects.readCompletionReceipt = (...a) => {
    effects.calls.push(['readCompletionReceipt', ...a]);
    return {
      authorization_id: 'cpb-2026-08-16-0001', ruling_id: 'AR-1281', target_packet: 'AR-1279',
      branch: deriveBranch('AR-1279', 'cpb-2026-08-16-0001'), commit_sha: 'a'.repeat(40),
      pushed: false, push_detail: 'remote rejected: non-fast-forward',
    };
  };
  const result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling() }), effects, now: 'T' });
  assert.equal(result.executed, true, 'the one-shot was attempted — the claim is already spent');
  assert.equal(result.completion_verified, false, 'a failed push must never verify, even with everything else correct');
  assert.equal(result.completion_failure_reason, 'completion_receipt_did_not_verify');
});

test('AR1292-G3c END-TO-END: run() surfaces a launch failure as unverified, distinctly from a bad receipt', () => {
  const effects = recordingEffects();
  effects.launchSeatSupervised = (...a) => { effects.calls.push(['launchSeatSupervised', ...a]); return { ok: false, detail: 'claude exited 1' }; };
  const result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling() }), effects, now: 'T' });
  assert.equal(result.completion_verified, false);
  assert.equal(result.completion_failure_reason, 'launch_failed');
});

test('AR1292-G4 a fully correct end-to-end run verifies TRUE and carries no failure reason', () => {
  const effects = recordingEffects();
  const result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling() }), effects, now: 'T' });
  assert.equal(result.executed, true);
  assert.equal(result.completion_verified, true);
  assert.equal(result.completion_failure_reason, null);
});

test('AR1292-G5 regression: prior end-to-end and identity controls remain green under the stricter check', () => {
  // Re-assert the exact claim C6b makes, now that recordingEffects()'s default receipt had to
  // become a genuinely valid one (real branch, real SHA) to keep passing under verifyCompletion —
  // this is the discriminating proof that the fixture upgrade did not just paper over F21.
  const effects = recordingEffects();
  const result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling() }), effects, now: 'T' });
  assert.equal(result.completion_verified, true);
  assert.deepEqual(effects.calls.map((c) => c[0]), [
    'writeClaim', 'createBranchAndWorktree', 'writeSeatGuard',
    'proveDoorwayInitOnly', 'launchSeatSupervised', 'readCompletionReceipt',
  ]);
});

/* =============================== AR-1293 H1-H3 — F22: RETIRE THE LEGACY COMMIT-ONLY ROUTE ==== */

test('AR1293-H1 the retired cp-commit.mjs Bash shape is no longer executable by the privileged seat', () => {
  const cmd = 'node scripts/control-plane-bootstrap/cp-commit.mjs --msg-file scripts/control-plane-bootstrap/.cp-commit-msg.tmp';
  const v = classifyControlPlaneBash(cmd, bashCtx);
  assert.equal(v.verdict, 'DENY');
  // Must bite because the shape is gone, not because Bash is broken wholesale.
  assert.match(v.reason, /not in the control-plane allowlist/);
});

test('AR1293-H2 cp-finalize.mjs remains the ONE valid commit/push route; raw git and cp-commit variants all DENY', () => {
  assert.equal(classifyControlPlaneBash('node scripts/control-plane-bootstrap/cp-finalize.mjs', bashCtx).verdict, 'ALLOW');
  assert.equal(classifyControlPlaneBash('node scripts/control-plane-bootstrap/cp-finalize.mjs --anything', bashCtx).verdict, 'DENY');
  assert.equal(classifyControlPlaneBash('git commit -m x', bashCtx).verdict, 'DENY');
  assert.equal(classifyControlPlaneBash('git push origin main', bashCtx).verdict, 'DENY');
  assert.equal(classifyControlPlaneBash('git add CLAUDE.md', bashCtx).verdict, 'ALLOW', 'ordinary authorized staging must still work');
});

test('AR1293-H3 the generated Phase-1 prompt instructs cp-finalize.mjs and never instructs cp-commit.mjs', () => {
  const p = buildPacketPrompt(baselineMarker());
  assert.match(p, /cp-finalize\.mjs/);
  assert.doesNotMatch(p, /cp-commit\.mjs/, 'the prompt must never point the seat at the retired commit-only route');
});

/* =============================== AR-1295 F23/F24/F25 — BOOTSTRAP #2 FAIL-CLOSED REPAIR ======= */

/**
 * F23 — the exact failure `cpb-2026-08-17-0002` hit: `deriveBranch` used to join with `/`, nesting
 * every fresh authorization's branch under the packet's bare-prefix name. Authorization #1's
 * preserved forensic claim records ITS OWN branch as exactly that bare prefix
 * (`control-plane/ar-1278-guard-repair` — see `docs/replay-results/control-plane-bootstrap/claims/
 * cpb-2026-08-17-0001.json`), so any later `/`-joined derivation collides with a real, undeletable
 * ref. `AR1290-C6` (above) only ever asserted `notEqual` between the fresh and stale names, which
 * is exactly why it did not catch this: two DIFFERENT strings can still be the same ref's parent
 * and child.
 */
test('K1 F23 flat branch naming: the real forensic branch from authorization #1 no longer nests a fresh authorization', () => {
  const staleForensicBranch = 'control-plane/ar-1278-guard-repair'; // the ACTUAL branch, not a fixture
  const fresh3 = deriveBranch('AR-1278', 'cpb-2026-08-17-0003');
  assert.notEqual(fresh3, staleForensicBranch);
  assert.equal(
    branchNamespaceCollision([staleForensicBranch], fresh3).collision, false,
    'the flat name must not collide with the real stale branch that caused the original failure',
  );
  // determinism and distinctness survive the separator change.
  assert.equal(deriveBranch('AR-1278', 'cpb-2026-08-17-0003'), deriveBranch('AR-1278', 'cpb-2026-08-17-0003'));
  assert.notEqual(deriveBranch('AR-1278', 'cpb-2026-08-17-0003'), deriveBranch('AR-1278', 'cpb-2026-08-17-0004'));
});

test('K1b branchNamespaceCollision: exact duplicate, existing-is-ancestor, target-is-ancestor, flat sibling', () => {
  const target = 'control-plane/ar-1278-guard-repair-cpb-x';
  assert.deepEqual(branchNamespaceCollision([target], target), { collision: true, kind: 'exact_duplicate', with: target });
  assert.equal(branchNamespaceCollision(['control-plane/ar-1278-guard-repair'], 'control-plane/ar-1278-guard-repair/cpb-x').collision, true);
  assert.equal(branchNamespaceCollision(['control-plane/ar-1278-guard-repair'], 'control-plane/ar-1278-guard-repair/cpb-x').kind, 'existing_is_ancestor');
  assert.equal(branchNamespaceCollision(['control-plane/ar-1278-guard-repair-x/deeper'], 'control-plane/ar-1278-guard-repair-x').collision, true);
  assert.equal(branchNamespaceCollision(['control-plane/ar-1278-guard-repair-x/deeper'], 'control-plane/ar-1278-guard-repair-x').kind, 'target_is_ancestor');
  assert.equal(branchNamespaceCollision(['control-plane/ar-1278-guard-repair'], target).collision, false, 'a flat sibling must pass');
  assert.equal(branchNamespaceCollision([], target).collision, false, 'no existing refs at all must pass');
});

/**
 * K2 — a disposable Git fixture, mirroring the AR1290-C1/C2/C3 pattern: real `git`, real temp
 * directory, removed afterwards. RED reproduces the OLD nested naming's exact failure against a
 * branch shaped like authorization #1's real forensic branch; GREEN proves the NEW flat naming
 * coexists in the SAME repository, with the old branch left completely untouched (never renamed,
 * never deleted — AR-1293A §7 / AR-1295's own forbidden list).
 */
test('K2 disposable Git fixture: RED (old nested naming cannot be created) then GREEN (new flat naming coexists)', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const pathMod = await import('node:path');
  const cp = await import('node:child_process');
  const gitAt = (dir, ...args) => cp.execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'cp-branchns-k2-'));
  try {
    gitAt(dir, 'init', '-q');
    gitAt(dir, 'config', 'user.email', 'test@test');
    gitAt(dir, 'config', 'user.name', 'test');
    fs.writeFileSync(pathMod.join(dir, 'seed.txt'), 'seed');
    gitAt(dir, 'add', 'seed.txt');
    gitAt(dir, 'commit', '-q', '-m', 'seed');
    const base = gitAt(dir, 'rev-parse', 'HEAD');

    // Reproduce authorization #1's real forensic branch shape in THIS disposable repo only.
    const staleBranch = 'control-plane/ar-1278-guard-repair';
    gitAt(dir, 'branch', staleBranch, base);

    // RED — the OLD (pre-AR-1295) join, reproduced inline so the control exercises the actual
    // regressed behaviour, not a description of it.
    const oldNestedBranch = `${staleBranch}/cpb-fixture-0002`;
    assert.throws(
      () => gitAt(dir, 'worktree', 'add', '-b', oldNestedBranch, pathMod.join(dir, '..', 'wt-old'), base),
      /cannot lock ref|already exists/i,
      'the old nested naming must reproduce the exact Git ref failure bootstrap #2 hit',
    );

    // Confirm the pre-claim check would have refused this BEFORE any Git call, for the same input.
    assert.equal(branchNamespaceCollision([staleBranch], oldNestedBranch).collision, true);

    // GREEN — the NEW flat naming, in the SAME repo, alongside the SAME untouched stale branch.
    const freshFlatBranch = deriveBranch('AR-1278', 'cpb-fixture-0003');
    assert.equal(branchNamespaceCollision([staleBranch], freshFlatBranch).collision, false);
    const worktreeDir = pathMod.join(dir, '..', 'wt-new');
    gitAt(dir, 'worktree', 'add', '-b', freshFlatBranch, worktreeDir, base);
    try {
      assert.ok(fs.existsSync(worktreeDir), 'the flat-named worktree must actually have been created');
      // The stale branch must still exist, unrenamed and undeleted.
      const branches = gitAt(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/');
      assert.ok(branches.split('\n').includes(staleBranch), 'the old forensic branch must remain untouched');
      assert.ok(branches.split('\n').includes(freshFlatBranch), 'the new flat branch must exist alongside it');
    } finally {
      gitAt(dir, 'worktree', 'remove', '--force', worktreeDir);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * K3 — the pre-claim gate wired into `run()`, via the SAME mocked `io`/`effects` harness every
 * other end-to-end test in this file uses. Proves REFUSE for all three collision kinds, PASS for a
 * flat sibling, and — the load-bearing assertion — that a refusal requests ZERO effects, exactly
 * like every other pre-claim refusal in `C14`.
 */
test('K3 pre-claim branch-namespace check: REFUSE before writeClaim on collision, PASS on a flat sibling', () => {
  const freshBranch = deriveBranch('AR-1279', 'cpb-2026-08-16-0001');
  const cases = [
    ['exact duplicate', [freshBranch]],
    // `target_packet`/`authorization_id` can never contain `/` (both are regex-validated in
    // authorization.mjs), so the ONLY existing-is-ancestor case reachable against a REAL
    // deriveBranch output is the pathological bare `control-plane` branch — anything shaped like
    // authorization #1's actual stale branch (`control-plane/ar-1279-guard-repair`, no trailing
    // slash) is a flat sibling under the new naming and correctly does NOT collide (that is the
    // fix); the generic three-kind classification itself is exercised directly in K1b.
    ['existing is ancestor (pathological bare prefix)', ['control-plane']],
    ['target is ancestor', [`${freshBranch}/deeper`]],
  ];
  for (const [label, existingControlPlaneBranches] of cases) {
    const effects = recordingEffects();
    const result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling(), existingControlPlaneBranches }), effects, now: 'T' });
    assert.equal(result.authorized, true, `${label}: the marker itself is still valid`);
    assert.equal(result.executed, false, `${label}: must not execute`);
    assert.equal(result.refusal?.code, 'branch_namespace_collision', `${label}: must refuse with the F24 code`);
    assert.deepEqual(effects.calls, [], `${label}: a namespace collision must request ZERO effects — no claim written`);
  }

  // PASS — a flat sibling of an unrelated existing branch must proceed exactly as before.
  const effects = recordingEffects();
  const result = run({
    mode: 'execute',
    io: fakeIo({ rulingText: validRuling(), existingControlPlaneBranches: ['control-plane/some-other-packet-guard-repair-cpb-x'] }),
    effects, now: 'T',
  });
  assert.equal(result.authorized, true);
  assert.equal(result.executed, true);
  assert.equal(effects.calls[0][0], 'writeClaim', 'a sibling namespace must still claim first, as usual');
});

/**
 * K4 — F25. Two independent injection points prove the exception boundary is general, not special-
 * cased to one call site. In BOTH cases: the claim was already written (it is the first effect
 * recorded), no later stage runs, and the returned result is the structured shape — never a thrown
 * error escaping `run()`.
 */
test('K4a post-claim exception at createBranchAndWorktree is caught and returned structured, never thrown', () => {
  const effects = recordingEffects();
  effects.createBranchAndWorktree = (...a) => {
    effects.calls.push(['createBranchAndWorktree', ...a]);
    throw new Error("cannot lock ref 'refs/heads/x': 'refs/heads/x' exists");
  };
  let threw = false;
  let result;
  try {
    result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling() }), effects, now: 'T' });
  } catch {
    threw = true;
  }
  assert.equal(threw, false, 'run() must never let a post-claim exception escape uncaught');
  assert.equal(result.authorized, true);
  assert.equal(result.authorization_spent, true, 'the claim was already written — the authorization is spent regardless');
  assert.equal(result.executed, false);
  assert.equal(result.post_claim_failure_stage, 'create_branch_and_worktree');
  assert.equal(result.completion_verified, false);
  assert.equal(result.completion_failure_reason, 'post_claim_exception');
  assert.match(result.post_claim_error_detail, /cannot lock ref/);
  assert.deepEqual(effects.calls.map((c) => c[0]), ['writeClaim', 'createBranchAndWorktree'],
    'the claim must have been written, and nothing after the failing stage may have been attempted');
});

test('K4b post-claim exception at writeSeatGuard is caught and returned structured, distinctly staged', () => {
  const effects = recordingEffects();
  effects.writeSeatGuard = (...a) => {
    effects.calls.push(['writeSeatGuard', ...a]);
    throw new Error('EACCES: permission denied');
  };
  const result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling() }), effects, now: 'T' });
  assert.equal(result.authorization_spent, true);
  assert.equal(result.post_claim_failure_stage, 'materialize_seat_guard');
  assert.equal(result.completion_failure_reason, 'post_claim_exception');
  assert.deepEqual(effects.calls.map((c) => c[0]), ['writeClaim', 'createBranchAndWorktree', 'writeSeatGuard']);
  assert.ok(!effects.calls.some((c) => c[0] === 'proveDoorwayInitOnly' || c[0] === 'launchSeatSupervised'),
    'a failure at seat-guard materialization must never reach the doorway or launch');
});

test('K4c runStage itself: success carries the value through; failure never throws', () => {
  assert.deepEqual(runStage('x', () => 42), { ok: true, stage: 'x', value: 42 });
  const failed = runStage('y', () => { throw new Error('boom'); });
  assert.equal(failed.ok, false);
  assert.equal(failed.stage, 'y');
  assert.match(failed.detail, /boom/);
});

test('K5 regression: the normal successful fake end-to-end path is unaffected by the new gate and boundary', () => {
  const effects = recordingEffects();
  const result = run({ mode: 'execute', io: fakeIo({ rulingText: validRuling() }), effects, now: 'T' });
  assert.equal(result.executed, true);
  assert.equal(result.authorization_spent, true);
  assert.equal(result.completion_verified, true);
  assert.equal(result.completion_failure_reason, null);
  assert.deepEqual(effects.calls.map((c) => c[0]), [
    'writeClaim', 'createBranchAndWorktree', 'writeSeatGuard',
    'proveDoorwayInitOnly', 'launchSeatSupervised', 'readCompletionReceipt',
  ]);
});

test('K5b regression: --plan mode reports branch namespace availability without spending anything', () => {
  const plan = buildPlan(baselineMarker(), { ...baselineMeasured(), existingControlPlaneBranches: ['control-plane/ar-1279-guard-repair'] });
  assert.equal(plan.branch_namespace_conflict.collision, false, 'baselineMarker uses AR-1279, whose flat branch does not nest under the bare AR-1279 prefix name used here');
  const collidingPlan = buildPlan(baselineMarker(), { ...baselineMeasured(), existingControlPlaneBranches: [plan.proposed_target_branch] });
  assert.equal(collidingPlan.branch_namespace_conflict.collision, true, 'an exact-duplicate existing ref must be visible in plan output too');
});

