import assert from 'node:assert/strict';
import test from 'node:test';
import { auditPaths, classifyPath } from './lane-boundary-guard.mjs';

test('Worker 1 compiler path is allowed', () => {
  const result = classifyPath('worker-1', 'src/server/compiler/lower.ts');
  assert.equal(result.verdict, 'ALLOW_LANE_MATCH');
});

test('Worker 2 runtime path is blocked for Worker 1', () => {
  const result = classifyPath('worker-1', 'src/server/services/fill-reconciliation-service.ts');
  assert.equal(result.verdict, 'BLOCK');
});

test('Worker 1 compiler path is blocked for Worker 2', () => {
  const result = classifyPath('worker-2', 'src/server/compiler/lower.ts');
  assert.equal(result.verdict, 'BLOCK');
});

test('coordination path requires handoff for either worker', () => {
  assert.equal(classifyPath('worker-1', '.github/workflows/ci.yml').verdict, 'HANDOFF_REQUIRED');
  assert.equal(classifyPath('worker-2', 'src/server/db/migrations/0001.sql').verdict, 'HANDOFF_REQUIRED');
});

test('unknown path does not receive a false allow', () => {
  const result = classifyPath('worker-1', 'src/server/lib/mystery-shared-helper.ts');
  assert.equal(result.verdict, 'REVIEW_REQUIRED');
});

test('related focused tests inherit obvious lane ownership', () => {
  assert.equal(classifyPath('worker-1', 'tests/compiler-decision-atom.spec.ts').verdict, 'ALLOW_LANE_MATCH');
  assert.equal(classifyPath('worker-2', 'tests/fill-reconciliation-service.test.ts').verdict, 'ALLOW_LANE_MATCH');
});

test('mixed audit fails closed when any path needs coordination or review', () => {
  const audit = auditPaths('worker-1', [
    'src/server/compiler/lower.ts',
    'package.json',
  ]);
  assert.equal(audit.safe_to_edit_without_handoff, false);
  assert.deepEqual(audit.summary, { allow: 1, block: 0, handoff_required: 1, review_required: 0 });
});

test('unsafe repository paths are rejected', () => {
  assert.throws(() => classifyPath('worker-1', '../outside.ts'), /unsafe repository path/);
  assert.throws(() => classifyPath('worker-2', '/tmp/file.ts'), /unsafe repository path/);
});
