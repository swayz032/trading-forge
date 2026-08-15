import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectWorker } from './worker-bootstrap.mjs';

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding:'utf8' }).trim(); }
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'bootstrap-'));
  git(root,'init'); git(root,'config','user.email','test@example.com'); git(root,'config','user.name','test');
  fs.writeFileSync(path.join(root,'x.txt'),'x\n'); git(root,'add','x.txt'); git(root,'commit','-m','init'); git(root,'branch','-M','worker-one');
  return root;
}

test('clean exact branch passes', () => {
  const root=makeRepo(); const r=inspectWorker({cwd:root,worker:'worker-1',expectedBranch:'worker-one',order:'AR-1138'});
  assert.equal(r.ok,true); assert.equal(r.clean,true); assert.match(r.head,/^[0-9a-f]{40}$/);
});

test('dirty tree fails closed', () => {
  const root=makeRepo(); fs.appendFileSync(path.join(root,'x.txt'),'dirty\n');
  const r=inspectWorker({cwd:root,worker:'worker-1',expectedBranch:'worker-one',order:'AR-1138'});
  assert.equal(r.ok,false); assert(r.errors.includes('worktree is dirty'));
});

test('wrong branch fails closed', () => {
  const root=makeRepo(); const r=inspectWorker({cwd:root,worker:'worker-2',expectedBranch:'worker-two',order:'AR-1178'});
  assert.equal(r.ok,false); assert.match(r.errors[0],/branch mismatch/);
});
