import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyResumeAnchor } from './resume-anchor-guard.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-anchor-'));
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(root, 'x.txt'), 'one\n');
  git(root, 'add', 'x.txt');
  git(root, 'commit', '-m', 'one');
  git(root, 'branch', '-M', 'worker-one');
  return root;
}

test('exact clean resume anchor passes', () => {
  const root = makeRepo();
  const head = git(root, 'rev-parse', 'HEAD');
  const r = verifyResumeAnchor({ cwd: root, expectedBranch: 'worker-one', expectedHead: head });
  assert.equal(r.ok, true);
  assert.equal(r.head, head);
  assert.equal(r.clean, true);
});

test('moved branch fails closed', () => {
  const root = makeRepo();
  const oldHead = git(root, 'rev-parse', 'HEAD');
  fs.appendFileSync(path.join(root, 'x.txt'), 'two\n');
  git(root, 'add', 'x.txt');
  git(root, 'commit', '-m', 'two');
  const r = verifyResumeAnchor({ cwd: root, expectedBranch: 'worker-one', expectedHead: oldHead });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /resume anchor moved/);
});

test('dirty tree fails closed by default', () => {
  const root = makeRepo();
  const head = git(root, 'rev-parse', 'HEAD');
  fs.appendFileSync(path.join(root, 'x.txt'), 'dirty\n');
  const r = verifyResumeAnchor({ cwd: root, expectedBranch: 'worker-one', expectedHead: head });
  assert.equal(r.ok, false);
  assert(r.errors.includes('worktree is dirty'));
});

test('wrong branch fails closed', () => {
  const root = makeRepo();
  const head = git(root, 'rev-parse', 'HEAD');
  const r = verifyResumeAnchor({ cwd: root, expectedBranch: 'worker-two', expectedHead: head });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /branch mismatch/);
});
