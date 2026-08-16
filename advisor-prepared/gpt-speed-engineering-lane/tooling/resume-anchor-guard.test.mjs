import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyResumeAnchor, dirtyDiffSha256 } from './resume-anchor-guard.mjs';

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
  // TIGHTENED for AR-1265 §4: the refusal must still fire AND name the offending path, so a
  // future exception cannot make this pass by silently governing something else.
  assert.match(r.errors.join('\n'), /dirty at an ungoverned path: x\.txt/);
});

// ---------------------------------------------------------------------------------------
// AR-1265 §4 — the hash-pinned allowed_dirty exception.
//
// The whole point is that the exception governs a CHANGE, not a NAME. Every control below
// keeps one dirty file present and varies only what the exception claims about it.
// ---------------------------------------------------------------------------------------

/** Dirty the repo at `x.txt` and return {root, head, sha} where sha is the COMPUTED pin. */
function dirtyRepoWithPin() {
  const root = makeRepo();
  const head = git(root, 'rev-parse', 'HEAD');
  fs.appendFileSync(path.join(root, 'x.txt'), 'dirty\n');
  const sha = dirtyDiffSha256(root, 'x.txt');
  return { root, head, sha };
}

const anchor = (root, head, allowedDirty) =>
  verifyResumeAnchor({ cwd: root, expectedBranch: 'worker-one', expectedHead: head, allowedDirty });

test('POSITIVE: dirty path whose diff matches its pinned hash is allowed', () => {
  const { root, head, sha } = dirtyRepoWithPin();
  const r = anchor(root, head, [{ path: 'x.txt', diff_sha256: sha, authority: 'AR-1265' }]);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.clean, false, 'positive witness: the tree really is dirty, the exception is what passed it');
  assert.deepEqual(r.accepted_dirty.map((e) => e.path), ['x.txt']);
});

test('MUTATION: one byte changed in the excepted file MUST fail', () => {
  const { root, head, sha } = dirtyRepoWithPin();
  // Prove the pin passes first, so the failure below is attributable to the byte, not the setup.
  assert.equal(anchor(root, head, [{ path: 'x.txt', diff_sha256: sha, authority: 'AR-1265' }]).ok, true);

  fs.appendFileSync(path.join(root, 'x.txt'), 'X');
  const r = anchor(root, head, [{ path: 'x.txt', diff_sha256: sha, authority: 'AR-1265' }]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /no longer matches its pinned diff/);
});

test('NEGATIVE: a second dirty path outside the exception blocks', () => {
  const { root, head, sha } = dirtyRepoWithPin();
  fs.writeFileSync(path.join(root, 'y.txt'), 'y\n');
  git(root, 'add', 'y.txt');
  const r = anchor(root, head, [{ path: 'x.txt', diff_sha256: sha, authority: 'AR-1265' }]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /ungoverned path: y\.txt/);
});

test('NEGATIVE: untracked files stay blocking even alongside a valid exception', () => {
  const { root, head, sha } = dirtyRepoWithPin();
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'u\n');
  const r = anchor(root, head, [{ path: 'x.txt', diff_sha256: sha, authority: 'AR-1265' }]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /untracked path is not governed.*untracked\.txt/s);
});

test('NEGATIVE: an untracked file cannot be laundered by listing it in allowed_dirty', () => {
  const root = makeRepo();
  const head = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'u.txt'), 'u\n');
  // `git diff HEAD` cannot see untracked content, so its hash is the hash of an EMPTY diff —
  // a path-listed untracked file must not be able to ride in on that.
  const emptyDiff = dirtyDiffSha256(root, 'u.txt');
  const r = anchor(root, head, [{ path: 'u.txt', diff_sha256: emptyDiff, authority: 'AR-1265' }]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /untracked path is not governed/);
});

test('a listed path that is absent is not an error — the tree is simply cleaner', () => {
  const root = makeRepo();
  const head = git(root, 'rev-parse', 'HEAD');
  const r = anchor(root, head, [{ path: 'x.txt', diff_sha256: 'a'.repeat(64), authority: 'AR-1265' }]);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.clean, true);
  assert.deepEqual(r.accepted_dirty, []);
});

test('BLANKET REFUSED: a path-only exception with no diff hash is rejected', () => {
  const { root, head } = dirtyRepoWithPin();
  assert.throws(
    () => anchor(root, head, [{ path: 'x.txt', authority: 'AR-1265' }]),
    /diff_sha256 must be a 64-character/,
  );
});

test('BLANKET REFUSED: globs, directories and missing authority are rejected', () => {
  const { root, head, sha } = dirtyRepoWithPin();
  assert.throws(() => anchor(root, head, [{ path: '*.txt', diff_sha256: sha, authority: 'AR-1265' }]), /not a pattern or directory/);
  assert.throws(() => anchor(root, head, [{ path: 'docs/', diff_sha256: sha, authority: 'AR-1265' }]), /not a pattern or directory/);
  assert.throws(() => anchor(root, head, [{ path: 'x.txt', diff_sha256: sha }]), /authority is required/);
});

test('BLANKET REFUSED: allowed_dirty combined with require_clean:false throws', () => {
  const { root, head, sha } = dirtyRepoWithPin();
  assert.throws(
    () => verifyResumeAnchor({
      cwd: root,
      expectedBranch: 'worker-one',
      expectedHead: head,
      requireClean: false,
      allowedDirty: [{ path: 'x.txt', diff_sha256: sha, authority: 'AR-1265' }],
    }),
    /blanket allow-dirty is not an exception/,
  );
});

test('the exception does not rescue a moved anchor or a wrong branch', () => {
  const { root, head, sha } = dirtyRepoWithPin();
  const exception = [{ path: 'x.txt', diff_sha256: sha, authority: 'AR-1265' }];
  assert.equal(anchor(root, head, exception).ok, true, 'positive witness: this exception does pass on its own');
  const r = verifyResumeAnchor({ cwd: root, expectedBranch: 'worker-two', expectedHead: head, allowedDirty: exception });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /branch mismatch/);
});

test('wrong branch fails closed', () => {
  const root = makeRepo();
  const head = git(root, 'rev-parse', 'HEAD');
  const r = verifyResumeAnchor({ cwd: root, expectedBranch: 'worker-two', expectedHead: head });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /branch mismatch/);
});
