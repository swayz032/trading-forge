import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runClaudePreflight } from './claude-preflight.mjs';

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-preflight-'));
  git(root, 'init'); git(root, 'config', 'user.email', 'test@example.com'); git(root, 'config', 'user.name', 'test');
  fs.mkdirSync(path.join(root, 'src/server/compiler'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'x\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'init'); git(root, 'branch', '-M', 'worker-one');
  return root;
}

test('exact paused state and owned path passes', () => {
  const root = makeRepo(); const head = git(root, 'rev-parse', 'HEAD');
  const r = runClaudePreflight({ cwd: root, worker: 'worker-1', expectedBranch: 'worker-one', expectedHead: head, intendedPaths: ['src/server/compiler/lower.ts'] });
  assert.equal(r.ok, true); assert.equal(r.verdict, 'PASS');
});

test('other-worker path stops', () => {
  const root = makeRepo(); const head = git(root, 'rev-parse', 'HEAD');
  const r = runClaudePreflight({ cwd: root, worker: 'worker-1', expectedBranch: 'worker-one', expectedHead: head, intendedPaths: ['src/server/services/fill-reconciliation-service.ts'] });
  assert.equal(r.ok, false); assert.equal(r.verdict, 'STOP');
});

test('moved resume anchor stops', () => {
  const root = makeRepo(); const paused = git(root, 'rev-parse', 'HEAD');
  fs.appendFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'y\n'); git(root, 'add', '.'); git(root, 'commit', '-m', 'move');
  const r = runClaudePreflight({ cwd: root, worker: 'worker-1', expectedBranch: 'worker-one', expectedHead: paused, intendedPaths: ['src/server/compiler/lower.ts'] });
  assert.equal(r.ok, false); assert.match(r.anchor.errors.join(' '), /resume anchor moved/);
});
