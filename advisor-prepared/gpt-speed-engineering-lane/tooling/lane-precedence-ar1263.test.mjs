// AR-1263 §7A — the guard-decision precedence law.
//
//   self-protected guard/control policy -> DENY
//   BLOCK                               -> DENY
//   HANDOFF_REQUIRED                    -> DENY
//   REVIEW_REQUIRED                     -> allow ONLY with explicit authorized packet scope
//   normal editable lane                -> still must satisfy packet scope
//
// WHY THE SELF-PROTECTED CONTROLS ASSERT A VERDICT AND NOT JUST A DECISION:
// before this repair, EVERY unmatched path (including the guard manifest) landed on
// REVIEW_REQUIRED, and auditPaths folded REVIEW_REQUIRED into `blocking`, so the bridge
// denied it. A control that only asserted `deny` would therefore have been GREEN on the
// broken code and stayed green through the scope-gating change that opens the hole.
// `A CONTROL THAT PASSES FOR THE WRONG REASON IS NOT A CONTROL.`

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyPath, auditPaths, decideEditPermission } from './lane-boundary-guard.mjs';
import { evaluateScope } from './edit-scope-guard.mjs';
import { evaluateHookEvent } from './claude-hook-bridge.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar1263-'));
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  fs.mkdirSync(path.join(root, 'src/engine/extraction'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/engine/extraction/g2d_finalizer.py'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  git(root, 'branch', '-M', 'worker-one');
  return { root, base: git(root, 'rev-parse', 'HEAD') };
}

// The real Worker-1 packet scope: `.claude/` IS an allowed prefix. That is precisely the
// broad prefix AR-1263 §7A says must NOT confer permission over the worker's own guard.
function manifest(base) {
  return {
    schema: 'gpt-claude-hook-guard-v1',
    worker: 'worker-1',
    session_anchor: { expected_branch: 'worker-one', expected_head: base, require_clean: true },
    edit_scope: {
      allowed_prefixes: ['src/engine/extraction/', 'src/engine/tests/', 'scripts/', '.claude/'],
      allowed_exact: ['docs/designs/SYSTEM-INVENTORY.md'],
    },
    finish: { enabled: false },
  };
}

function pre(root, file_path) {
  return {
    cwd: root,
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path },
    session_id: 's1',
  };
}

// Arms through the REAL SessionStart event rather than handing PreToolUse a fabricated
// `{ TF_CLAUDE_GUARD_ANCHOR_OK: '1' }`. That constant was never something production could
// produce: SessionStart wrote it to CLAUDE_ENV_FILE, which is only ever placed in the
// environment of SessionStart/Setup/CwdChanged/FileChanged hooks and is applied to the Bash
// tool's shell, never to a later hook process. Arming is now bound state, so it has to be
// established the way the seat establishes it.
function arm(root, m) {
  const started = evaluateHookEvent({ input: { cwd: root, hook_event_name: 'SessionStart', source: 'startup', session_id: 's1' }, manifest: m });
  assert.equal(started._audit.anchor.ok, true, 'fixture failed to arm the guard session');
}

function decisionFor(root, base, file_path) {
  const m = manifest(base);
  arm(root, m);
  const result = evaluateHookEvent({
    input: pre(root, file_path),
    manifest: m,
  });
  return {
    decision: result.hookSpecificOutput?.permissionDecision || 'allow',
    reason: result.hookSpecificOutput?.permissionDecisionReason || '',
  };
}

// ---------------------------------------------------------------------------
// 1. SELF-PROTECTED — the load-bearing new category
// ---------------------------------------------------------------------------

test('AR-1263: the worker guard manifest is SELF_PROTECTED, not merely review-required', () => {
  const r = classifyPath('worker-1', '.claude/worker1-hook-guard-manifest.json');
  assert.equal(r.verdict, 'SELF_PROTECTED');
});

test('AR-1263: the pinned toolbox that implements the guard is SELF_PROTECTED', () => {
  const r = classifyPath(
    'worker-1',
    'advisor-prepared/gpt-speed-engineering-lane/tooling/lane-boundary-guard.mjs',
  );
  assert.equal(r.verdict, 'SELF_PROTECTED');
});

test('AR-1263: live hook settings are SELF_PROTECTED', () => {
  assert.equal(classifyPath('worker-1', '.claude/settings.json').verdict, 'SELF_PROTECTED');
  assert.equal(classifyPath('worker-1', '.claude/settings.local.json').verdict, 'SELF_PROTECTED');
  assert.equal(classifyPath('worker-1', '.claude/hooks/grading-guard.ps1').verdict, 'SELF_PROTECTED');
});

test('AR-1263: self-protected denial survives a packet scope that allows its prefix', () => {
  const { root, base } = makeRepo();
  // `.claude/` IS in allowed_prefixes. The edit must still be denied.
  const d = decisionFor(root, base, '.claude/worker1-hook-guard-manifest.json');
  assert.equal(d.decision, 'deny');
  assert.match(d.reason, /self-protected/i);
});

test('AR-1263: audit marks self-protected as deny-regardless-of-scope', () => {
  const a = auditPaths('worker-1', ['.claude/worker1-hook-guard-manifest.json']);
  assert.equal(a.deny_regardless_of_scope, true);
  assert.equal(a.summary.self_protected, 1);
});

// ---------------------------------------------------------------------------
// 2. BLOCK / HANDOFF_REQUIRED still deny regardless of scope
// ---------------------------------------------------------------------------

test('AR-1263: Worker 2 ownership still denies regardless of scope', () => {
  const a = auditPaths('worker-1', ['src/server/services/paper-engine.ts']);
  assert.equal(a.deny_regardless_of_scope, true);
});

test('AR-1263: coordination path still denies regardless of scope', () => {
  const a = auditPaths('worker-1', ['package.json']);
  assert.equal(a.deny_regardless_of_scope, true);
});

// ---------------------------------------------------------------------------
// 3. REVIEW_REQUIRED is scope-gated — this is the blocker AR-1256 hit
// ---------------------------------------------------------------------------

test('AR-1263: REVIEW_REQUIRED inside authorized packet scope is ALLOWED', () => {
  const { root, base } = makeRepo();
  // This is Worker-1's real, authorized G2 file. Before the repair it was denied,
  // which would have made an activated P1 guard refuse the worker's own packet.
  const d = decisionFor(root, base, 'src/engine/extraction/g2d_finalizer.py');
  assert.equal(d.decision, 'allow');
});

test('AR-1263: REVIEW_REQUIRED outside authorized packet scope is DENIED', () => {
  const { root, base } = makeRepo();
  const d = decisionFor(root, base, 'docs/designs/SOME-UNSCOPED-DOC.md');
  assert.equal(d.decision, 'deny');
});

test('AR-1263: audit reports REVIEW_REQUIRED as scope-gated, not deny-regardless', () => {
  const a = auditPaths('worker-1', ['src/engine/extraction/g2d_finalizer.py']);
  assert.equal(a.deny_regardless_of_scope, false);
  assert.equal(a.scope_gated, true);
  // The strict legacy field keeps its honest meaning: review IS still required.
  assert.equal(a.safe_to_edit_without_handoff, false);
});

// ---------------------------------------------------------------------------
// 4. A normal lane match still must satisfy packet scope
// ---------------------------------------------------------------------------

test('AR-1263: lane-matched path outside packet scope is still DENIED', () => {
  const { root, base } = makeRepo();
  assert.equal(classifyPath('worker-1', 'src/server/compiler/lower.ts').verdict, 'ALLOW_LANE_MATCH');
  const d = decisionFor(root, base, 'src/server/compiler/lower.ts');
  assert.equal(d.decision, 'deny');
});

// ---------------------------------------------------------------------------
// 5. MUTATION CONTROL — prove the self-protected category is what does the work
// ---------------------------------------------------------------------------

test('AR-1263 MUTATION: without the self-protected category the guard manifest becomes editable', () => {
  const MANIFEST = '.claude/worker1-hook-guard-manifest.json';
  const scopeOf = (p) =>
    evaluateScope({
      changedPaths: [p],
      allowedExact: [],
      // the real Worker-1 packet prefix that makes this dangerous
      allowedPrefixes: ['.claude/'],
    });

  // 1. WITH the repair: self-protected wins over the allowing packet scope.
  const repaired = decideEditPermission(auditPaths('worker-1', [MANIFEST]), scopeOf(MANIFEST));
  assert.equal(repaired.allow, false);
  assert.match(repaired.reason, /self-protected/i);

  // 2. WITH THE CATEGORY REMOVED: the manifest falls through to REVIEW_REQUIRED and the
  //    `.claude/` packet prefix now WRONGLY confers permission over the worker's own guard.
  //    Rules are injected, not globally mutated — production keeps no switch that can
  //    turn self-protection off.
  const mutatedAudit = auditPaths('worker-1', [MANIFEST], { selfProtectedRules: [] });
  assert.equal(mutatedAudit.summary.self_protected, 0);
  assert.equal(mutatedAudit.summary.review_required, 1);

  const mutated = decideEditPermission(mutatedAudit, scopeOf(MANIFEST));
  assert.equal(
    mutated.allow,
    true,
    'MUTATION FAILED TO BITE: something other than the self-protected category was refusing this edit',
  );
});
