import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditBranchCollision } from './branch-collision-audit.mjs';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function setupRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-branch-collision-'));
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'gpt-test@example.invalid']);
  git(repo, ['config', 'user.name', 'GPT Tooling Test']);
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'base\n');
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  return { repo, base };
}

function commitFile(repo, branch, file, content) {
  git(repo, ['checkout', branch]);
  fs.writeFileSync(path.join(repo, file), content);
  git(repo, ['add', file]);
  git(repo, ['commit', '-m', `${branch} change`]);
}

test('reports no exact collision when branches touch different paths', () => {
  const { repo, base } = setupRepo();
  git(repo, ['checkout', '-b', 'worker-1', base]);
  commitFile(repo, 'worker-1', 'w1.txt', 'w1\n');
  git(repo, ['checkout', '-b', 'worker-2', base]);
  commitFile(repo, 'worker-2', 'w2.txt', 'w2\n');
  const result = auditBranchCollision(repo, 'worker-1', 'worker-2');
  assert.equal(result.safe_from_exact_path_collision, true);
  assert.deepEqual(result.exact_path_overlaps, []);
});

test('fails closed on an exact changed-path collision', () => {
  const { repo, base } = setupRepo();
  git(repo, ['checkout', '-b', 'worker-1', base]);
  commitFile(repo, 'worker-1', 'shared.txt', 'worker 1\n');
  git(repo, ['checkout', '-b', 'worker-2', base]);
  commitFile(repo, 'worker-2', 'shared.txt', 'worker 2\n');
  const result = auditBranchCollision(repo, 'worker-1', 'worker-2');
  assert.equal(result.safe_from_exact_path_collision, false);
  assert.deepEqual(result.exact_path_overlaps, ['shared.txt']);
});

test('accepts an explicit frozen base', () => {
  const { repo, base } = setupRepo();
  git(repo, ['checkout', '-b', 'worker-1', base]);
  commitFile(repo, 'worker-1', 'w1.txt', 'w1\n');
  git(repo, ['checkout', '-b', 'worker-2', base]);
  commitFile(repo, 'worker-2', 'w2.txt', 'w2\n');
  const result = auditBranchCollision(repo, 'worker-1', 'worker-2', base);
  assert.equal(result.base, base);
  assert.equal(result.safe_from_exact_path_collision, true);
});
