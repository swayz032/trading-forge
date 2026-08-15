import test from 'node:test';
import assert from 'node:assert/strict';
import { triageJobs } from './ci-failure-triage.mjs';

test('all successful jobs produce GREEN', () => {
  const r = triageJobs({ jobs: [
    { name: 'lint', status: 'completed', conclusion: 'success', steps: [] },
    { name: 'tests', status: 'completed', conclusion: 'success', steps: [] },
  ] });
  assert.equal(r.state, 'GREEN');
  assert.equal(r.ok, true);
});

test('failed job extracts only failing step', () => {
  const r = triageJobs({ jobs: [{
    name: 'node-tests',
    status: 'completed',
    conclusion: 'failure',
    steps: [
      { number: 1, name: 'checkout', conclusion: 'success' },
      { number: 2, name: 'vitest', conclusion: 'failure' },
      { number: 3, name: 'cleanup', conclusion: 'skipped' },
    ],
  }] });
  assert.equal(r.state, 'FAILED');
  assert.equal(r.failures.length, 1);
  assert.deepEqual(r.failures[0].failed_steps, [
    { name: 'vitest', conclusion: 'failure', number: 2 },
  ]);
});

test('cancelled job is never reported green', () => {
  const r = triageJobs({ jobs: [{ name: 'build', status: 'completed', conclusion: 'cancelled', steps: [] }] });
  assert.equal(r.state, 'FAILED');
  assert.equal(r.failures[0].no_failed_step_exposed, true);
});

test('in-progress job fails closed as INCOMPLETE', () => {
  const r = triageJobs({ jobs: [{ name: 'tests', status: 'in_progress', conclusion: null, steps: [] }] });
  assert.equal(r.state, 'INCOMPLETE');
  assert.equal(r.ok, false);
  assert.equal(r.incomplete.length, 1);
});

test('malformed payload is rejected', () => {
  assert.throws(() => triageJobs({ nope: [] }), /jobs array/);
});
