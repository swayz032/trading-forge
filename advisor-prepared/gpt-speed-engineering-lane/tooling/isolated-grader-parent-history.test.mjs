import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const RUNNER = path.join(import.meta.dirname, 'claude-hook-runner.mjs');

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function hook(cwd, manifest, payload) {
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
    stdout,
    stderr: (r.stderr || '').trim(),
    json: stdout ? JSON.parse(stdout) : null,
  };
}

function decision(r) {
  return r.json?.hookSpecificOutput?.permissionDecision ?? null;
}
function reason(r) {
  return r.json?.hookSpecificOutput?.permissionDecisionReason ?? '';
}

function makeRepo(slug) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `grader-parent-history-${slug}-`)));
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'target.txt'), 'H1\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'H1');
  git(root, 'branch', '-M', 'claude/worker1-test');
  return { root, h1: git(root, 'rev-parse', 'HEAD') };
}

function manifestFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-parent-history-manifest-'));
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
    edit_scope: { allowed_exact: [], allowed_prefixes: ['src/'] },
    finish: { enabled: false },
  }, null, 2));
  return file;
}

function start(root, manifest, sessionId) {
  return hook(root, manifest, {
    cwd: root,
    hook_event_name: 'SessionStart',
    source: 'startup',
    session_id: sessionId,
  });
}

function dispatch(root, manifest, sessionId, id = 'toolu-parent-history') {
  return hook(root, manifest, {
    cwd: root,
    hook_event_name: 'PreToolUse',
    session_id: sessionId,
    tool_use_id: id,
    tool_name: 'Agent',
    tool_input: {
      description: 'independent accuracy grade',
      prompt: 'Disprove the candidate with real execution.',
      subagent_type: 'accuracy-validator',
      model: 'opus',
      isolation: 'worktree',
    },
  });
}

function tokenFrom(dispatchResult) {
  return dispatchResult.json?.hookSpecificOutput?.updatedInput?.prompt
    ?.match(/TF_ISOLATED_GRADER_ACTIVATE:([a-f0-9]{64})/i)?.[1] ?? null;
}

function advance(root) {
  fs.appendFileSync(path.join(root, 'src', 'target.txt'), 'H2\n');
  git(root, 'add', 'src/target.txt');
  git(root, 'commit', '-m', 'H2');
  return git(root, 'rev-parse', 'HEAD');
}

function addChild(root, head, slug) {
  const child = path.join(os.tmpdir(), `worktree-agent-${slug}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  git(root, 'worktree', 'add', '-b', `worktree-agent-${slug}`, child, head);
  return fs.realpathSync(child);
}

function removeChild(root, child) {
  try { git(root, 'worktree', 'remove', '--force', child); } catch { /* cleanup */ }
}

test('AR-1358 A2: advance then rewind cannot mint a fresh isolated-grader permit', () => {
  const { root, h1 } = makeRepo('a2');
  const manifest = manifestFile();
  const session = 'parent-a2';

  const s = start(root, manifest, session);
  assert.match(s.json?.hookSpecificOutput?.additionalContext || '', /anchor verified/i);

  const h2 = advance(root);
  assert.notEqual(h2, h1);
  git(root, 'reset', '--hard', h1);
  assert.equal(git(root, 'rev-parse', 'HEAD'), h1);

  const attacked = dispatch(root, manifest, session, 'toolu-a2');
  assert.equal(decision(attacked), 'deny', attacked.stdout || attacked.stderr);
  assert.match(reason(attacked), /history was rewritten|does not descend/i,
    `rewind refusal did not discriminate on history continuity: ${reason(attacked)}`);
  assert.equal(tokenFrom(attacked), null, 'a rewound parent must not receive a fresh activation token');
});

test('normal fast-forward parent progress still permits an isolated grader', () => {
  const { root } = makeRepo('ff');
  const manifest = manifestFile();
  const session = 'parent-ff';

  assert.match(start(root, manifest, session).json?.hookSpecificOutput?.additionalContext || '', /anchor verified/i);
  advance(root);

  const allowed = dispatch(root, manifest, session, 'toolu-ff');
  assert.equal(decision(allowed), 'allow', reason(allowed));
  assert.ok(tokenFrom(allowed), 'fast-forward progress must still be able to mint a grader token');
});

test('a token minted before a later parent rewind is refused at child activation', () => {
  const { root, h1 } = makeRepo('pre-activation-rewind');
  const manifest = manifestFile();
  const parentSession = 'parent-pre-activation';
  const childSession = 'child-pre-activation';
  let child = null;

  try {
    assert.match(start(root, manifest, parentSession).json?.hookSpecificOutput?.additionalContext || '', /anchor verified/i);
    const issued = dispatch(root, manifest, parentSession, 'toolu-pre-activation');
    assert.equal(decision(issued), 'allow', reason(issued));
    const token = tokenFrom(issued);
    assert.ok(token);

    child = addChild(root, h1, 'pre-activation');
    const childStart = start(child, manifest, childSession);
    assert.match(childStart.json?.hookSpecificOutput?.additionalContext || '', /not armed yet/i);

    advance(root);
    git(root, 'reset', '--hard', h1);

    const activate = hook(child, manifest, {
      cwd: child,
      hook_event_name: 'PreToolUse',
      session_id: childSession,
      tool_name: 'Bash',
      tool_input: { command: `echo TF_ISOLATED_GRADER_ACTIVATE:${token}` },
    });
    assert.equal(decision(activate), 'deny');
    assert.match(reason(activate), /parent branch history was rewritten|does not descend/i);
  } finally {
    if (child) removeChild(root, child);
  }
});

test('an already-active isolated grader loses execution after the parent rewinds', () => {
  const { root, h1 } = makeRepo('active-rewind');
  const manifest = manifestFile();
  const parentSession = 'parent-active-rewind';
  const childSession = 'child-active-rewind';
  let child = null;

  try {
    assert.match(start(root, manifest, parentSession).json?.hookSpecificOutput?.additionalContext || '', /anchor verified/i);
    const issued = dispatch(root, manifest, parentSession, 'toolu-active-rewind');
    const token = tokenFrom(issued);
    assert.equal(decision(issued), 'allow', reason(issued));
    assert.ok(token);

    child = addChild(root, h1, 'active-rewind');
    start(child, manifest, childSession);
    const activation = hook(child, manifest, {
      cwd: child,
      hook_event_name: 'PreToolUse',
      session_id: childSession,
      tool_name: 'Bash',
      tool_input: { command: `echo TF_ISOLATED_GRADER_ACTIVATE:${token}` },
    });
    assert.equal(decision(activation), 'allow', reason(activation));

    advance(root);
    git(root, 'reset', '--hard', h1);

    const after = hook(child, manifest, {
      cwd: child,
      hook_event_name: 'PreToolUse',
      session_id: childSession,
      tool_name: 'Bash',
      tool_input: { command: 'git rev-parse HEAD' },
    });
    assert.equal(decision(after), 'deny');
    assert.match(reason(after), /parent authority invalidated.*history was rewritten|history was rewritten/i);
  } finally {
    if (child) removeChild(root, child);
  }
});
