import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyReceipt } from './commit-evidence-verifier.mjs';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-evidence-verifier-'));
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'gpt-test@example.invalid']);
  git(repo, ['config', 'user.name', 'GPT Tooling Test']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', 'base.txt']);
  git(repo, ['commit', '-m', 'base']);
  git(repo, ['checkout', '-b', 'worker-1/test']);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'change.ts'), 'export const value = 1;\n');
  git(repo, ['add', 'src/change.ts']);
  git(repo, ['commit', '-m', 'worker change']);
  return { repo, commit: git(repo, ['rev-parse', 'HEAD']) };
}

function goodReceipt(commit) {
  return {
    job: 'AR-TEST',
    worker: 'worker-1',
    branch: 'worker-1/test',
    commit,
    files_changed: ['src/change.ts'],
    red: 'focused test failed before repair',
    green: 'focused test passed after repair',
    control: 'mutation control failed as expected',
    pushed: true,
    stopped_for_gpt: true,
  };
}

test('accepts a receipt whose commit, branch, and changed files match Git', () => {
  const { repo, commit } = makeRepo();
  const result = verifyReceipt(goodReceipt(commit), repo);
  assert.equal(result.ok, true);
  assert.equal(result.branch_contains_commit, true);
  assert.deepEqual(result.actual_files, ['src/change.ts']);
});

test('rejects a false changed-file claim', () => {
  const { repo, commit } = makeRepo();
  const receipt = goodReceipt(commit);
  receipt.files_changed = ['src/not-real.ts'];
  const result = verifyReceipt(receipt, repo);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /does not exactly match commit diff/);
});

test('rejects an unavailable commit', () => {
  const { repo } = makeRepo();
  const result = verifyReceipt(goodReceipt('0123456789012345678901234567890123456789'), repo);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /commit is not available/);
});

test('rejects a branch that does not contain the reported commit', () => {
  const { repo, commit } = makeRepo();
  git(repo, ['checkout', 'main']);
  git(repo, ['checkout', '-b', 'other-worker']);
  const receipt = goodReceipt(commit);
  receipt.branch = 'other-worker';
  const result = verifyReceipt(receipt, repo);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /does not contain reported commit/);
});

test('rejects paperwork that is not pushed/stopped for GPT', () => {
  const { repo, commit } = makeRepo();
  const receipt = goodReceipt(commit);
  receipt.pushed = false;
  receipt.stopped_for_gpt = false;
  const result = verifyReceipt(receipt, repo);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /pushed=true/);
  assert.match(result.failures.join('\n'), /stopped_for_gpt=true/);
});
