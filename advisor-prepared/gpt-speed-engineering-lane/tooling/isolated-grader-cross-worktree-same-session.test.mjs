import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const RUNNER = path.join(import.meta.dirname, 'claude-hook-runner.mjs');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function hook(cwd, manifest, payload) {
  const r = spawnSync(process.execPath, [RUNNER, '--manifest', manifest], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env },
  });
  if (r.error) throw r.error;
  const out = (r.stdout || '').trim();
  return { json: out ? JSON.parse(out) : null, stdout: out, stderr: (r.stderr || '').trim(), status: r.status };
}

function decision(r) {
  return r.json?.hookSpecificOutput?.permissionDecision ?? null;
}
function reason(r) {
  return r.json?.hookSpecificOutput?.permissionDecisionReason ?? '';
}

function makeRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-grader-xwt-')));
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(root, 'proof.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  git(root, 'branch', '-M', 'claude/worker1-test');
  return { root, head: git(root, 'rev-parse', 'HEAD') };
}

function makeManifest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-grader-xwt-manifest-'));
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify({
    schema: 'gpt-claude-hook-guard-v1',
    worker: 'worker-1',
    _toolbox_pin: 'test-toolbox-pin',
    _toolbox_bundle_sha256: 'test-toolbox-bundle',
    session_anchor: {
      expected_branch: 'claude/worker1-test',
      expected_head: 'claude/worker1-test',
      require_clean: true,
    },
    // AR-1358: the prior empty scope made SessionStart fail before this control reached the
    // isolated-grader path. Keep a real explicit scope so only place binding can decide the test.
    edit_scope: { allowed_exact: ['proof.txt'], allowed_prefixes: [] },
    finish: { enabled: false },
  }, null, 2));
  return file;
}

function addWorktree(root, branch, head) {
  const p = path.join(os.tmpdir(), `${branch}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  git(root, 'worktree', 'add', '-b', branch, p, head);
  return fs.realpathSync(p);
}

function removeWorktree(root, p) {
  try { git(root, 'worktree', 'remove', '--force', p); } catch { /* cleanup */ }
}

test('same session id + copied marker still cannot authorize a different synthetic worktree', () => {
  const { root, head } = makeRepo();
  const manifest = makeManifest();
  const parentSession = 'parent-same-session';
  const childSession = 'grader-same-session';
  let intended = null;
  let attacker = null;

  try {
    const start = hook(root, manifest, {
      cwd: root, hook_event_name: 'SessionStart', source: 'startup', session_id: parentSession,
    });
    assert.match(start.json?.hookSpecificOutput?.additionalContext || '', /anchor verified/i);

    const dispatch = hook(root, manifest, {
      cwd: root,
      hook_event_name: 'PreToolUse',
      session_id: parentSession,
      tool_use_id: 'toolu-xwt',
      tool_name: 'Agent',
      tool_input: {
        description: 'independent grader',
        prompt: 'Attack the candidate.',
        subagent_type: 'accuracy-validator',
        model: 'opus',
        isolation: 'worktree',
      },
    });
    assert.equal(decision(dispatch), 'allow');
    const token = dispatch.json?.hookSpecificOutput?.updatedInput?.prompt?.match(/TF_ISOLATED_GRADER_ACTIVATE:([a-f0-9]{64})/i)?.[1];
    assert.ok(token);

    intended = addWorktree(root, 'worktree-agent-intended-same', head);
    hook(intended, manifest, { cwd: intended, hook_event_name: 'SessionStart', source: 'startup', session_id: childSession });
    const activation = hook(intended, manifest, {
      cwd: intended,
      hook_event_name: 'PreToolUse',
      session_id: childSession,
      tool_name: 'Bash',
      tool_input: { command: `echo TF_ISOLATED_GRADER_ACTIVATE:${token}` },
    });
    assert.equal(decision(activation), 'allow', reason(activation));

    attacker = addWorktree(root, 'worktree-agent-attacker-same', head);
    const intendedGit = git(intended, 'rev-parse', '--absolute-git-dir');
    const attackerGit = git(attacker, 'rev-parse', '--absolute-git-dir');
    const name = `tf-isolated-grader-session-${childSession}.json`;
    fs.copyFileSync(path.join(intendedGit, name), path.join(attackerGit, name));

    // SAME session id. Session binding is deliberately held constant so only place/branch
    // binding can catch the copied witness.
    const borrowed = hook(attacker, manifest, {
      cwd: attacker,
      hook_event_name: 'PreToolUse',
      session_id: childSession,
      tool_name: 'Bash',
      tool_input: { command: 'git rev-parse HEAD' },
    });
    assert.equal(decision(borrowed), 'deny');
    assert.match(reason(borrowed), /worktree|git_dir|branch changed since activation/i,
      `refusal did not discriminate on child-place binding: ${reason(borrowed)}`);
  } finally {
    if (attacker) removeWorktree(root, attacker);
    if (intended) removeWorktree(root, intended);
  }
});
