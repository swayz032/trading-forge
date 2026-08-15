import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyChangedFiles } from './changed-test-selector.mjs';

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selector-'));
  fs.mkdirSync(path.join(root, 'src/server/services/__tests__'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/server/services/__tests__/alpha.test.ts'), '');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:full-fleet': 'vitest run', 'test:scripts': 'node --test' } }));
  return root;
}

test('docs-only changes require no production tests', () => {
  const r = classifyChangedFiles(['docs/x.md']);
  assert.equal(r.mode, 'docs-only');
  assert.deepEqual(r.commands, []);
});

test('service change finds direct test and typecheck', () => {
  const root = repo();
  const r = classifyChangedFiles(['src/server/services/alpha.ts'], { repoRoot: root });
  assert.equal(r.mode, 'focused-safe');
  assert(r.commands.includes('npx tsc --noEmit'));
  assert(r.commands.some(c => c.includes('alpha.test.ts')));
  assert(!r.commands.includes('npm run test:full-fleet'));
});

test('unknown TS source fails conservative to full-fleet', () => {
  const root = repo();
  const r = classifyChangedFiles(['src/server/services/no-match.ts'], { repoRoot: root });
  assert(r.commands.includes('npm run test:full-fleet'));
});

test('CI change requires full gate', () => {
  const root = repo();
  const r = classifyChangedFiles(['.github/workflows/fast.yml'], { repoRoot: root });
  assert.equal(r.requires_full_ci, true);
  assert(r.commands.includes('npm run test:full-fleet'));
});

test('unsafe traversal is rejected', () => {
  assert.throws(() => classifyChangedFiles(['../secret']), /unsafe path/);
});
