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

function run(cwd, manifest, payload) {
  const r = spawnSync(process.execPath, [RUNNER, '--manifest', manifest], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env },
  });
  if (r.error) throw r.error;
  const out = (r.stdout || '').trim();
  return { status: r.status, json: out ? JSON.parse(out) : null, stdout: out, stderr: (r.stderr || '').trim() };
}

function decision(r) {
  return r.json?.hookSpecificOutput?.permissionDecision ?? null;
}

function makeRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-grader-dirty-')));
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(root, 'generated.json'), '{"before":true}\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  git(root, 'branch', '-M', 'claude/worker1-test');
  return { root, head: git(root, 'rev-parse', 'HEAD') };
}

function manifestFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-grader-dirty-manifest-'));
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
    edit_scope: { allowed_exact: [], allowed_prefixes: [] },
    finish: { enabled: false },
  }, null, 2));
  return file;
}

test('tracked artifact regeneration after activation does not brick the next grader command', () => {
  const { root, head } = makeRepo();
  const manifest = manifestFile();
  const parentSession = 'parent-dirty';
  const childSession = 'child-dirty';
  let child = null;

  try {
    const start = run(root, manifest, { cwd: root, hook_event_name: 'SessionStart', source: 'startup', session_id: parentSession });
    assert.match(start.json?.hookSpecificOutput?.additionalContext || '', /anchor verified/i);

    const dispatch = run(root, manifest, {
      cwd: root,
      hook_event_name: 'PreToolUse',
      session_id: parentSession,
      tool_use_id: 'toolu-dirty',
      tool_name: 'Agent',
      tool_input: {
        description: 'grade a proof that regenerates an artifact',
        prompt: 'Run the proof and then inspect the result.',
        subagent_type: 'accuracy-validator',
        model: 'opus',
        isolation: 'worktree',
      },
    });
    assert.equal(decision(dispatch), 'allow');
    const token = dispatch.json?.hookSpecificOutput?.updatedInput?.prompt?.match(/TF_ISOLATED_GRADER_ACTIVATE:([a-f0-9]{64})/i)?.[1];
    assert.ok(token);

    child = path.join(os.tmpdir(), `worktree-agent-dirty-${Date.now()}`);
    git(root, 'worktree', 'add', '-b', 'worktree-agent-dirty-test', child, head);
    child = fs.realpathSync(child);

    const childStart = run(child, manifest, { cwd: child, hook_event_name: 'SessionStart', source: 'startup', session_id: childSession });
    assert.match(childStart.json?.hookSpecificOutput?.additionalContext || '', /NOT armed yet|not armed yet/i);

    const activate = run(child, manifest, {
      cwd: child,
      hook_event_name: 'PreToolUse',
      session_id: childSession,
      tool_name: 'Bash',
      tool_input: { command: `echo TF_ISOLATED_GRADER_ACTIVATE:${token}` },
    });
    assert.equal(decision(activate), 'allow');

    // Simulate a legitimate proof script regenerating a tracked artifact. This bypasses the hook
    // only because the test itself is modeling what a child process spawned by an allowed test
    // command can do inside the disposable worktree.
    fs.writeFileSync(path.join(child, 'generated.json'), '{"after":true}\n');
    assert.notEqual(git(child, 'status', '--porcelain=v1', '--untracked-files=no'), '');

    // Cleanliness was proven at activation. A dirty disposable worktree must not invalidate the
    // next read/test command; HEAD and every authorization binding are still re-verified.
    const next = run(child, manifest, {
      cwd: child,
      hook_event_name: 'PreToolUse',
      session_id: childSession,
      tool_name: 'Bash',
      tool_input: { command: 'git diff -- generated.json' },
    });
    assert.equal(decision(next), null, next.json?.hookSpecificOutput?.permissionDecisionReason || next.stderr);
  } finally {
    if (child) {
      try { git(root, 'worktree', 'remove', '--force', child); } catch { /* cleanup only */ }
    }
  }
});
