import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const RUNNER = path.join(import.meta.dirname, 'claude-hook-runner.mjs');
const PIN = 'test-toolbox-pin';
const BUNDLE = 'test-toolbox-bundle';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepo(slug) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `isolated-grader-${slug}-`)));
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'target.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  git(root, 'branch', '-M', 'claude/worker1-test');
  return { root, head: git(root, 'rev-parse', 'HEAD') };
}

function writeManifest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-grader-manifest-'));
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify({
    schema: 'gpt-claude-hook-guard-v1',
    worker: 'worker-1',
    _toolbox_pin: PIN,
    _toolbox_bundle_sha256: BUNDLE,
    session_anchor: {
      expected_branch: 'claude/worker1-test',
      expected_head: 'claude/worker1-test',
      require_clean: true,
    },
    edit_scope: { allowed_exact: [], allowed_prefixes: ['src/'] },
    finish: { enabled: false },
  }, null, 2));
  return file;
}

function runHook(cwd, manifest, payload) {
  const r = spawnSync(process.execPath, [RUNNER, '--manifest', manifest], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env },
  });
  if (r.error) throw r.error;
  const stdout = (r.stdout || '').trim();
  return {
    status: r.status,
    stderr: (r.stderr || '').trim(),
    stdout,
    json: stdout ? JSON.parse(stdout) : null,
  };
}

function decision(r) {
  return r.json?.hookSpecificOutput?.permissionDecision ?? null;
}

function reason(r) {
  return r.json?.hookSpecificOutput?.permissionDecisionReason ?? '';
}

function sessionStart(cwd, manifest, sessionId) {
  return runHook(cwd, manifest, {
    cwd,
    hook_event_name: 'SessionStart',
    source: 'startup',
    session_id: sessionId,
  });
}

function pre(cwd, manifest, sessionId, tool_name, tool_input, tool_use_id = undefined) {
  return runHook(cwd, manifest, {
    cwd,
    hook_event_name: 'PreToolUse',
    session_id: sessionId,
    tool_name,
    tool_input,
    tool_use_id,
  });
}

function addAgentWorktree(parentRoot, branch, head) {
  const child = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${branch}-`)));
  // mkdtemp creates the directory; git worktree add requires a non-existing target.
  fs.rmSync(child, { recursive: true, force: true });
  git(parentRoot, 'worktree', 'add', '-b', branch, child, head);
  return fs.realpathSync(child);
}

function removeWorktree(parentRoot, child) {
  try { git(parentRoot, 'worktree', 'remove', '--force', child); } catch { /* test cleanup */ }
}

test('isolated accuracy-validator permit activates exactly one grader worktree and keeps it grader-only', () => {
  const { root, head } = makeRepo('positive');
  const manifest = writeManifest();
  const parentSession = 'parent-session';
  const childSession = 'child-session';
  let child = null;
  let other = null;

  try {
    const start = sessionStart(root, manifest, parentSession);
    assert.match(start.json?.hookSpecificOutput?.additionalContext || '', /anchor verified/i, start.stderr);

    const dispatch = pre(root, manifest, parentSession, 'Agent', {
      description: 'independently grade exact GPT target',
      prompt: 'Disprove the target. Run real commands and report evidence.',
      subagent_type: 'accuracy-validator',
      model: 'opus',
      isolation: 'worktree',
    }, 'toolu-grade-1');
    assert.equal(decision(dispatch), 'allow', dispatch.stderr || reason(dispatch));
    const rewritten = dispatch.json?.hookSpecificOutput?.updatedInput;
    assert.equal(rewritten?.subagent_type, 'accuracy-validator');
    assert.equal(rewritten?.isolation, 'worktree');
    const tokenMatch = rewritten?.prompt?.match(/echo TF_ISOLATED_GRADER_ACTIVATE:([a-f0-9]{64})/i);
    assert.ok(tokenMatch, 'parent guard must inject a one-use activation token into only this grader prompt');
    const token = tokenMatch[1];

    child = addAgentWorktree(root, 'worktree-agent-intended', head);
    const childStart = sessionStart(child, manifest, childSession);
    assert.match(childStart.json?.hookSpecificOutput?.additionalContext || '', /NOT armed yet|not armed yet/i);

    // Wrong token has no authority even on a correctly-shaped synthetic branch.
    const wrong = pre(child, manifest, childSession, 'Bash', {
      command: `echo TF_ISOLATED_GRADER_ACTIVATE:${'0'.repeat(64)}`,
    });
    assert.equal(decision(wrong), 'deny');
    assert.match(reason(wrong), /no unconsumed isolated-grader permit/i);

    const activate = pre(child, manifest, childSession, 'Bash', {
      command: `echo TF_ISOLATED_GRADER_ACTIVATE:${token}`,
    });
    assert.equal(decision(activate), 'allow', reason(activate));

    // Real read/test-style execution is now permitted.
    const readExec = pre(child, manifest, childSession, 'Bash', { command: 'git rev-parse HEAD' });
    assert.equal(decision(readExec), null, reason(readExec));
    assert.equal(readExec.stdout, '');

    // Grader identity does not become a worker identity.
    const edit = pre(child, manifest, childSession, 'Write', {
      file_path: path.join(child, 'src', 'target.txt'),
      content: 'changed\n',
    });
    assert.equal(decision(edit), 'deny');
    assert.match(reason(edit), /grader-only/i);

    const nested = pre(child, manifest, childSession, 'Agent', {
      description: 'nested', prompt: 'do work', subagent_type: 'general-purpose', isolation: 'worktree',
    });
    assert.equal(decision(nested), 'deny');
    assert.match(reason(nested), /cannot dispatch nested/i);

    // Negative control required by AR-1354A: another synthetic worktree cannot borrow the
    // intended grader's authorization by copying its session marker. The marker is bound to
    // session + worktree + git dir + branch + HEAD, so the copied witness must still deny.
    other = addAgentWorktree(root, 'worktree-agent-unrelated', head);
    const childGitDir = git(child, 'rev-parse', '--absolute-git-dir');
    const otherGitDir = git(other, 'rev-parse', '--absolute-git-dir');
    const marker = path.join(childGitDir, `tf-isolated-grader-session-${childSession}.json`);
    const forged = path.join(otherGitDir, 'tf-isolated-grader-session-other-session.json');
    fs.copyFileSync(marker, forged);

    const borrowed = pre(other, manifest, 'other-session', 'Bash', { command: 'git rev-parse HEAD' });
    assert.equal(decision(borrowed), 'deny');
    assert.match(reason(borrowed), /marker belongs to a different session|worktree|git_dir|changed since activation/i);

    // The original secret permit was consumed atomically, so even a caller that somehow learned
    // the token later cannot activate a second child.
    const replay = pre(other, manifest, 'other-session', 'Bash', {
      command: `echo TF_ISOLATED_GRADER_ACTIVATE:${token}`,
    });
    assert.equal(decision(replay), 'deny');
    assert.match(reason(replay), /no unconsumed isolated-grader permit/i);
  } finally {
    if (other) removeWorktree(root, other);
    if (child) removeWorktree(root, child);
  }
});

test('ordinary worktree-agent branch with no parent-issued permit remains fail-closed', () => {
  const { root, head } = makeRepo('no-permit');
  const manifest = writeManifest();
  const parentSession = 'parent-no-permit';
  let child = null;
  try {
    assert.match(sessionStart(root, manifest, parentSession).json?.hookSpecificOutput?.additionalContext || '', /anchor verified/i);
    child = addAgentWorktree(root, 'worktree-agent-no-permit', head);
    const start = sessionStart(child, manifest, 'child-no-permit');
    assert.match(start.json?.hookSpecificOutput?.additionalContext || '', /NOT armed yet|not armed yet/i);
    const cmd = pre(child, manifest, 'child-no-permit', 'Bash', { command: 'git rev-parse HEAD' });
    assert.equal(decision(cmd), 'deny');
    assert.match(reason(cmd), /not activated/i);
  } finally {
    if (child) removeWorktree(root, child);
  }
});

test('only accuracy-validator + isolation worktree receives a permit rewrite', () => {
  const { root } = makeRepo('scope');
  const manifest = writeManifest();
  const session = 'parent-scope';
  assert.match(sessionStart(root, manifest, session).json?.hookSpecificOutput?.additionalContext || '', /anchor verified/i);

  for (const tool_input of [
    { description: 'wrong type', prompt: 'x', subagent_type: 'general-purpose', model: 'opus', isolation: 'worktree' },
    { description: 'wrong isolation', prompt: 'x', subagent_type: 'accuracy-validator', model: 'opus' },
  ]) {
    const r = pre(root, manifest, session, 'Agent', tool_input, 'toolu-scope');
    assert.equal(decision(r), null);
    assert.equal(r.stdout, '', 'ordinary Agent call must not be rewritten by isolated grader machinery');
  }
});
