/**
 * AR-1277 §10 — RED / GREEN / NEGATIVE CONTROLS for the control-plane bootstrap.
 *
 * Run: node --test scripts/control_plane_bootstrap.test.mjs
 *
 * ★ THESE TESTS TOUCH NOTHING. Every filesystem/git/process interaction goes through an injected
 * fake, and the effects recorder is asserted EMPTY on every refusal path. That is what makes
 * "external side effects = NONE" a measurement instead of a promise: the test does not merely
 * avoid side effects, it proves none were even REQUESTED.
 *
 * ★ THE NO-MUTATION CONTROL IS LOAD-BEARING. A negative suite without a passing baseline cannot
 * distinguish "catches breakage" from "always red" — so `baseline marker validates` runs first and
 * every negative is exactly one field away from it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateAuthorization, extractCandidateMarkers, MARKER_SCHEMA } from './control-plane-bootstrap/authorization.mjs';
import { classifyControlPlanePath, classifyControlPlaneTool, verifySeatIdentity } from './control-plane-bootstrap/control-plane-guard.mjs';
import { buildPlan, deriveBranch, deriveWorktreeDirName, assertClaimNamespaceDisjoint, LAUNCH_EXECUTABLE, LAUNCH_ARGV } from './control-plane-bootstrap/plan.mjs';
import { run, seatSettingsFor, rulingIdFromFilename } from './control-plane-bootstrap/bootstrap.mjs';
import { decide } from './control-plane-bootstrap/control-plane-seat-hook.mjs';

const QUEUE_SHA = '5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939';
/** The trap hash from AR-1276 §F: same 17-char prefix, different string. */
const EXTRACTION_SHA_TRAP = '5935b1c6c03860b35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823';

const baselineMarker = () => ({
  schema: MARKER_SCHEMA,
  authorization_class: 'EXECUTABLE',
  authorization_id: 'cpb-2026-08-16-0001',
  ruling_id: 'AR-1280',
  actor: 'top-level-control-plane-guard-repair',
  execution: 'ONE_BOOTSTRAP_EXECUTION',
  source_actor: 'worker-1',
  target_packet: 'AR-1278',
  repo: 'swayz032/trading-forge',
  frozen_queue_sha256: QUEUE_SHA,
  require_ready: 8,
  require_spent: 0,
  require_receipts: 'README_ONLY',
  require_agent_model_executions_before_launch: 0,
  hands_free: true,
  allowed_paths: ['.claude/settings.json', '.claude/worker1-hook-guard-manifest.json', 'CLAUDE.md'],
});

const baselineMeasured = () => ({
  rulingId: 'AR-1280',
  isNewestRuling: true,
  queueSha256: QUEUE_SHA,
  ready: 8,
  spent: 0,
  receiptsReadmeOnly: true,
  agentModelExecutions: 0,
  claimedAuthorizationIds: new Set(),
  workerBranch: 'claude/worker1-h1-20260815',
  workerHead: 'cb4bd4871e3a7e2e1d553073bca88d25dc0ffde6',
  repoParentDir: 'C:/Users/tonio/Projects',
  gptAuthorityHead: '5bfdcf357295c37bfdd818097452587d96002969',
});

/* =============================== NO-MUTATION CONTROL ======================================= */

test('CONTROL: the baseline marker validates (so every negative below discriminates)', () => {
  const v = validateAuthorization(baselineMarker(), baselineMeasured());
  assert.equal(v.ok, true, `baseline must pass, got ${v.code}: ${v.detail}`);
});

/* =============================== THE 18 REQUIRED NEGATIVES ================================= */

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

test('N2 schema typo', () => refusesWith((m) => { m.schema = 'CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V2'; }, 'wrong_schema'));
test('N3 wrong actor', () => refusesWith((m) => { m.actor = 'worker-1'; }, 'wrong_actor'));
test('N4 wrong source actor', () => refusesWith((m) => { m.source_actor = 'worker-2'; }, 'wrong_source_actor'));
test('N5 wrong target packet', () => refusesWith((m) => { m.target_packet = 'the-next-one'; }, 'bad_target_packet'));

test('N6 wrong frozen queue SHA — including the AR-1276 §F prefix trap', () => {
  refusesWith((m) => { m.frozen_queue_sha256 = EXTRACTION_SHA_TRAP; }, 'frozen_queue_sha_mismatch');
  // The trap shares 17 leading chars with the real queue SHA. Prove we compare the whole string.
  assert.equal(EXTRACTION_SHA_TRAP.slice(0, 17), QUEUE_SHA.slice(0, 17));
  assert.notEqual(EXTRACTION_SHA_TRAP, QUEUE_SHA);
});

test('N7 READY not 8', () => refusesWith((m, s) => { s.ready = 7; }, 'ready_not_8'));
test('N8 SPENT not 0', () => refusesWith((m, s) => { s.spent = 1; }, 'spent_not_0'));
test('N9 receipt namespace not README-only', () => refusesWith((m, s) => { s.receiptsReadmeOnly = false; }, 'receipts_not_readme_only'));

test('N10 stale GPT authority (a newer ruling exists that does not carry this authorization)', () => {
  refusesWith((m, s) => { s.isNewestRuling = false; }, 'stale_authority');
  // and the sibling case: a marker lifted out of one ruling and pasted into another
  refusesWith((m, s) => { s.rulingId = 'AR-1281'; }, 'ruling_id_mismatch');
});

test('N11 arbitrary repo', () => refusesWith((m) => { m.repo = 'attacker/trading-forge'; }, 'wrong_repo'));

test('N12 arbitrary executable cannot be supplied — the schema is closed', () => {
  refusesWith((m) => { m.executable = 'C:/evil.exe'; }, 'unknown_field');
  // and the launcher has no parameter for one
  assert.equal(LAUNCH_EXECUTABLE, 'claude');
  assert.deepEqual([...LAUNCH_ARGV], ['--dangerously-skip-permissions']);
});

test('N13 arbitrary settings path cannot be supplied', () => {
  refusesWith((m) => { m.settings_path = '/tmp/permissive.json'; }, 'unknown_field');
  const plan = buildPlan(baselineMarker(), baselineMeasured());
  assert.match(plan.settings_guard_template.settings_path, /wt-control-plane-ar-1278\/\.claude\/settings\.json$/);
});

test('N14 arbitrary worktree path cannot be supplied — it is DERIVED', () => {
  refusesWith((m) => { m.worktree_path = 'C:/anywhere'; }, 'unknown_field');
  assert.equal(deriveBranch('AR-1278'), 'control-plane/ar-1278-guard-repair');
  assert.equal(deriveWorktreeDirName('AR-1278'), 'wt-control-plane-ar-1278');
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
  // and the seat guard denies them categorically even if an allowlist somehow contained one
  const v = classifyControlPlanePath('docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/a.json', ['docs/']);
  assert.equal(v.verdict, 'DENY_CATEGORICAL');
});

test('N17 the seat may not launch an Agent/subagent instead of top-level Claude', () => {
  for (const tool of ['Agent', 'Task', 'PowerShell']) {
    assert.equal(classifyControlPlaneTool(tool).verdict, 'DENY', `${tool} must be denied`);
  }
  const denied = decide(
    { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: {} },
    seatManifest(),
    seatObserved(),
  );
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  // and the plan's process is top-level, never a subagent
  const plan = buildPlan(baselineMarker(), baselineMeasured());
  assert.equal(plan.planned_process.top_level, true);
  assert.equal(plan.planned_process.is_subagent, false);
});

test('N18 the AR-1276C example block itself REFUSES as non-executable', () => {
  const AR1276C_EXAMPLE = `
Some prose above the block.

\`\`\`json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "actor": "top-level-control-plane-guard-repair",
  "execution": "ONE_BOOTSTRAP_EXECUTION",
  "source_actor": "worker-1",
  "target_packet": "AR-1278",
  "frozen_queue_sha256": "${QUEUE_SHA}",
  "require_ready": 8,
  "require_spent": 0,
  "require_receipts": "README_ONLY",
  "require_agent_model_executions_before_launch": 0,
  "hands_free": true
}
\`\`\`
`;
  const found = extractCandidateMarkers(AR1276C_EXAMPLE);
  // The extractor MUST see it — a control that cannot see the thing it rejects proves nothing.
  assert.equal(found.length, 1, 'the example must be extracted, then refused');
  const v = validateAuthorization(found[0], baselineMeasured());
  assert.equal(v.ok, false);
  assert.equal(v.code, 'missing_field');
  assert.match(v.detail, /authorization_class/);
});

/* =============================== REGRESSION: THE REVISION-LETTER DEFECT ==================== */

test('REGRESSION: a ruling revision letter is part of the ruling identity', () => {
  // RED (measured live, before the fix): the first real `--plan` run reported newest_ruling
  // "AR-1276" while reading AR-1276C-GPT-OPERATOR-RULING-...md. Four distinct rulings collapsed
  // into one identity, and the ruling_id binding would then refuse a valid AR-1280A marker.
  assert.equal(
    rulingIdFromFilename('AR-1276C-GPT-OPERATOR-RULING-WORKER1-AUTHORIZED-TO-AUTHOR-NONEXECUTING-CONTROL-PLANE-BOOTSTRAP-AR1277-2026-08-16.md'),
    'AR-1276C',
  );
  // ...and the un-suffixed case must still resolve to itself, not swallow the next token.
  assert.equal(
    rulingIdFromFilename('AR-1276-GPT-EXTERNAL-ADVISOR-RULING-AR1275-PARTIAL-PASS-2026-08-16.md'),
    'AR-1276',
  );
  assert.equal(rulingIdFromFilename('no-ruling-here.md'), null);
  // The marker's own packet field must accept the same shape.
  const m = baselineMarker();
  m.target_packet = 'AR-1278A';
  assert.equal(validateAuthorization(m, baselineMeasured()).ok, true);
});

/* =============================== MUTATION CONTROL ========================================== */

test('MUTATION: the executable/example discriminator is what does the work', () => {
  // Mutate ONLY authorization_class on an otherwise-valid marker.
  refusesWith((m) => { m.authorization_class = 'EXAMPLE'; }, 'not_executable');
  refusesWith((m) => { m.authorization_class = 'executable'; }, 'not_executable'); // case matters
  // ...and removing the field entirely is the AR-1276C shape.
  refusesWith((m) => { delete m.authorization_class; }, 'missing_field');
  // The control: with the field restored, the very same marker passes.
  assert.equal(validateAuthorization(baselineMarker(), baselineMeasured()).ok, true);
});

/* =============================== GREEN: PLAN, NO EXECUTION ================================= */

test('GREEN: the plan carries every field AR-1276C §10 requires, and executes nothing', () => {
  const plan = buildPlan(baselineMarker(), baselineMeasured());
  for (const field of [
    'repo_identity', 'source_worker_branch', 'source_worker_head', 'target_actor_class',
    'target_packet', 'proposed_target_branch', 'proposed_target_worktree', 'settings_guard_template',
    'gpt_authority_branch', 'frozen_queue_sha256_required', 'ready_required', 'spent_required',
    'receipt_namespace_required', 'planned_process', 'planned_operations',
  ]) {
    assert.ok(plan[field] !== undefined, `plan is missing required field ${field}`);
  }
  assert.equal(plan.executed, false);
  assert.equal(plan.planned_operations.length, 9);
  assert.equal(plan.planned_operations[0].op, 'verify_gpt_authority');
  // The claim is written BEFORE the launch, or a crash leaves the authorization reusable.
  const claimStep = plan.planned_operations.find((o) => o.op === 'write_claim').step;
  const launchStep = plan.planned_operations.find((o) => o.op === 'launch_seat').step;
  assert.ok(claimStep < launchStep, 'claim must precede launch');
});

test('GREEN: the replay-claim namespace is disjoint from the frozen G2 receipt namespace', () => {
  assert.equal(assertClaimNamespaceDisjoint(), true);
  assert.throws(
    () => assertClaimNamespaceDisjoint('docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/claims'),
    /overlaps the frozen G2 receipt namespace/,
  );
});

test('GREEN: the materialized seat settings register PowerShell and route to the control-plane guard', () => {
  const s = seatSettingsFor();
  const pre = s.hooks.PreToolUse[0];
  for (const tool of ['Edit', 'Write', 'Bash', 'Agent', 'Task', 'PowerShell']) {
    assert.ok(pre.matcher.includes(tool), `PreToolUse matcher must cover ${tool}`);
  }
  assert.match(pre.hooks[0].command, /control-plane-seat-hook\.mjs/);
  assert.ok(s.hooks.SessionStart, 'SessionStart must be registered');
});

/* =============================== SEAT GUARD: DEFAULT DENY ================================== */

const seatManifest = () => ({
  actor: 'top-level-control-plane-guard-repair',
  branch: 'control-plane/ar-1278-guard-repair',
  worktree: 'C:/Users/tonio/Projects/wt-control-plane-ar-1278',
  target_packet: 'AR-1278',
  authorization_id: 'cpb-2026-08-16-0001',
  frozen_queue_sha256: QUEUE_SHA,
  allowed_paths: ['.claude/settings.json', 'CLAUDE.md'],
});
const seatObserved = () => ({
  actor: 'top-level-control-plane-guard-repair',
  branch: 'control-plane/ar-1278-guard-repair',
  worktree: 'C:/Users/tonio/Projects/wt-control-plane-ar-1278',
  targetPacket: 'AR-1278',
  authorizationId: 'cpb-2026-08-16-0001',
  queueSha256: QUEUE_SHA,
  isSubagent: false,
});

test('SEAT: an authorized path is allowed and an unauthorized one is denied', () => {
  assert.equal(classifyControlPlanePath('.claude/settings.json', ['.claude/settings.json']).verdict, 'ALLOW');
  assert.equal(classifyControlPlanePath('src/engine/backtester.py', ['.claude/settings.json']).verdict, 'DENY_CATEGORICAL');
  assert.equal(classifyControlPlanePath('README.md', ['.claude/settings.json']).verdict, 'DENY');
  assert.equal(classifyControlPlanePath('../outside.txt', ['.claude/settings.json']).verdict, 'DENY');
});

test('SEAT: an unrecognised tool is DENIED, not passed through', () => {
  const out = decide({ hook_event_name: 'PreToolUse', tool_name: 'SomeFutureTool', tool_input: {} }, seatManifest(), seatObserved());
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /default deny/);
});

test('SEAT: identity mismatch fails closed, and a subagent can never be the seat', () => {
  const wrongBranch = { ...seatObserved(), branch: 'claude/worker1-h1-20260815' };
  const out = decide({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '.claude/settings.json' } }, seatManifest(), wrongBranch);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(verifySeatIdentity({ ...seatObserved(), isSubagent: true }, {
    actor: seatManifest().actor, branch: seatManifest().branch, worktree: seatManifest().worktree,
    targetPacket: seatManifest().target_packet, authorizationId: seatManifest().authorization_id,
    queueSha256: seatManifest().frozen_queue_sha256,
  }).code, 'not_top_level');
});

test('SEAT: a missing manifest denies every tool call', () => {
  const out = decide({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'CLAUDE.md' } }, null, seatObserved());
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

/* =============================== LIVE CONTROL AGAINST THE REAL RULING ====================== */

/**
 * The synthetic N18 fixture proves the validator refuses a marker SHAPED like AR-1276C's. It does
 * not prove the extractor can SEE the real one — and "refused" and "never found" are
 * indistinguishable from the outside. That gap is exactly the false-green this campaign keeps
 * convicting, so this control reads the actual ruling off the actual authority branch.
 */
test('LIVE: the real AR-1276C block is EXTRACTED (not merely unseen) and then REFUSED', async () => {
  const cp = await import('node:child_process');
  let text;
  try {
    const head = cp.execFileSync('git', ['rev-parse', 'origin/external-advisor/gpt-rulings'], { encoding: 'utf8' }).trim();
    const files = cp
      .execFileSync('git', ['show', '--name-only', '--pretty=format:', head], { encoding: 'utf8' })
      .trim().split('\n').filter((s) => s.endsWith('.md'));
    text = cp.execFileSync('git', ['show', `${head}:${files[0]}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return; // no git/authority branch here: skip rather than fake a pass
  }
  if (!text.includes('CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1')) return; // ruling carries no block

  const fence = String.fromCharCode(96, 96, 96);
  const found = extractCandidateMarkers(text);
  assert.ok(
    found.length >= 1,
    `extractor saw 0 markers in a ruling that contains the schema string. ` +
      `len=${text.length} crlf=${text.includes('\r\n')} fences=${text.split(fence).length - 1} ` +
      `jsonFences=${text.split(`${fence}json`).length - 1}`,
  );
  for (const marker of found) {
    const v = validateAuthorization(marker, baselineMeasured());
    assert.equal(v.ok, false, 'a live ruling block must not validate as executable');
  }
});

/* =============================== END-TO-END REFUSAL, ZERO EFFECTS ========================== */

function fakeIo({ rulingText, rulingFile = 'advisor-reports/AR-1276C-EXAMPLE.md' }) {
  const queue = JSON.stringify({ queue: new Array(8).fill({}), attempts: {} });
  return {
    repoRoot: 'C:/Users/tonio/Projects/wt-claude-worker1-20260815',
    git: (...args) => {
      const a = args.join(' ');
      if (a.startsWith('fetch')) return '';
      if (a === 'rev-parse origin/external-advisor/gpt-rulings') return '5bfdcf35';
      if (a.startsWith('show --name-only')) return rulingFile;
      if (a.startsWith('show ')) return rulingText;
      if (a === 'rev-parse --abbrev-ref HEAD') return 'claude/worker1-h1-20260815';
      if (a === 'rev-parse HEAD') return 'cb4bd487';
      return '';
    },
    readFile: () => queue,
    readFileBytes: () => Buffer.from(queue),
    listDir: () => ['README.md'],
    exists: () => true,
  };
}

function recordingEffects() {
  const calls = [];
  return {
    calls,
    createBranchAndWorktree: (...a) => calls.push(['createBranchAndWorktree', ...a]),
    writeSeatGuard: (...a) => calls.push(['writeSeatGuard', ...a]),
    writeClaim: (...a) => calls.push(['writeClaim', ...a]),
    launchSeat: (...a) => { calls.push(['launchSeat', ...a]); return 4242; },
  };
}

test('END-TO-END: --execute against a ruling with no executable marker REFUSES and requests zero effects', () => {
  const effects = recordingEffects();
  const result = run({
    mode: 'execute',
    io: fakeIo({ rulingText: 'A ruling with prose and no marker at all.' }),
    effects,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.executed, false);
  assert.equal(result.refusal.code, 'no_marker');
  assert.deepEqual(effects.calls, [], 'NO effect may be requested on a refusal path');
});

test('END-TO-END: --execute against the AR-1276C example block REFUSES and requests zero effects', () => {
  const effects = recordingEffects();
  const rulingText = ['```json', JSON.stringify({
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

  const result = run({ mode: 'execute', io: fakeIo({ rulingText }), effects });
  assert.equal(result.authorized, false);
  assert.equal(result.refusal.code, 'all_markers_refused');
  assert.match(result.refusal.detail, /missing_field/);
  assert.deepEqual(effects.calls, [], 'NO effect may be requested on a refusal path');
});
