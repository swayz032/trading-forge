import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runClaudeFinishCheck } from './claude-finish-check.mjs';

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-finish-'));
  git(root, 'init'); git(root, 'config', 'user.email', 'test@example.com'); git(root, 'config', 'user.name', 'test');
  fs.mkdirSync(path.join(root, 'src/server/compiler'), { recursive: true }); fs.writeFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'a\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'base'); git(root, 'branch', '-M', 'worker-one');
  const base = git(root, 'rev-parse', 'HEAD');
  fs.appendFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'b\n'); git(root, 'add', '.'); git(root, 'commit', '-m', 'work');
  const head = git(root, 'rev-parse', 'HEAD');
  return { root, base, head };
}
function receipt(head, files = ['src/server/compiler/lower.ts']) { return { commit: head, branch: 'worker-one', files_changed: files, pushed: true, stopped_for_gpt: true }; }

test('clean owned scoped packet passes to GPT review', () => {
  const { root, base, head } = makeRepo();
  const r = runClaudeFinishCheck({ cwd: root, worker: 'worker-1', base, scope: { allowed_exact: ['src/server/compiler/lower.ts'] }, receipt: receipt(head) });
  assert.equal(r.ok, true); assert.equal(r.verdict, 'PASS_FOR_GPT_REVIEW');
});

test('scope escape stops', () => {
  const { root, base, head } = makeRepo();
  const r = runClaudeFinishCheck({ cwd: root, worker: 'worker-1', base, scope: { allowed_exact: ['src/server/compiler/other.ts'] }, receipt: receipt(head) });
  assert.equal(r.ok, false); assert(r.failures.includes('actual diff escaped authorized edit scope'));
});

test('false receipt files stop', () => {
  const { root, base, head } = makeRepo();
  const r = runClaudeFinishCheck({ cwd: root, worker: 'worker-1', base, scope: { allowed_exact: ['src/server/compiler/lower.ts'] }, receipt: receipt(head, ['src/server/compiler/fake.ts']) });
  assert.equal(r.ok, false); assert.equal(r.evidence.ok, false);
});

test('exact path collision with other worker stops', () => {
  const { root, base, head } = makeRepo();
  git(root, 'checkout', '-b', 'worker-two', base);
  fs.appendFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'c\n'); git(root, 'add', '.'); git(root, 'commit', '-m', 'other');
  git(root, 'checkout', 'worker-one');
  const r = runClaudeFinishCheck({ cwd: root, worker: 'worker-1', base, scope: { allowed_exact: ['src/server/compiler/lower.ts'] }, receipt: receipt(head), otherWorkerRef: 'worker-two', collisionBase: base });
  assert.equal(r.ok, false); assert(r.failures.includes('other worker branch has exact changed-path collision'));
});
