import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateScope } from './edit-scope-guard.mjs';

test('exact authorized files pass', () => {
  const r = evaluateScope({
    changedPaths: ['src/a.ts', 'test/a.test.ts'],
    allowedExact: ['src/a.ts', 'test/a.test.ts'],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.out_of_scope, []);
});

test('authorized prefix passes descendants only', () => {
  const r = evaluateScope({
    changedPaths: ['fixtures/case-a/input.json', 'fixtures/case-a/output.json'],
    allowedPrefixes: ['fixtures/case-a/'],
  });
  assert.equal(r.ok, true);
});

test('extra changed file fails closed', () => {
  const r = evaluateScope({
    changedPaths: ['src/a.ts', 'src/opportunistic-refactor.ts'],
    allowedExact: ['src/a.ts'],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.out_of_scope, ['src/opportunistic-refactor.ts']);
});

test('empty authorization is rejected instead of allowing everything', () => {
  assert.throws(() => evaluateScope({ changedPaths: ['src/a.ts'] }), /explicit scope rule/);
});

test('unsafe traversal syntax is rejected', () => {
  assert.throws(() => evaluateScope({
    changedPaths: ['src/a.ts'],
    allowedExact: ['../src/a.ts'],
  }), /unsafe path syntax/);
});

test('prefix must be explicit directory prefix', () => {
  assert.throws(() => evaluateScope({
    changedPaths: ['src/a.ts'],
    allowedPrefixes: ['src'],
  }), /must end with/);
});
