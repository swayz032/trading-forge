import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBudgets, summarizeJobs } from './actions-speed-observer.mjs';

const payload = {
  jobs: [
    {
      id: 1,
      name: 'Fast Lane',
      conclusion: 'success',
      started_at: '2026-08-15T00:00:00Z',
      completed_at: '2026-08-15T00:07:00Z',
      steps: [
        {
          name: 'Vitest',
          conclusion: 'success',
          started_at: '2026-08-15T00:01:00Z',
          completed_at: '2026-08-15T00:05:20Z',
        },
      ],
    },
  ],
};

test('summarizes exact job and step durations', () => {
  const out = summarizeJobs(payload);
  assert.equal(out.length, 1);
  assert.equal(out[0].seconds, 420);
  assert.equal(out[0].steps[0].seconds, 260);
});

test('reports job and step budget regressions without changing evidence', () => {
  const summary = summarizeJobs(payload);
  const warnings = compareBudgets(summary, {
    jobs: { 'Fast Lane': 415 },
    steps: { 'Fast Lane::Vitest': 251 },
  });
  assert.deepEqual(warnings, [
    { type: 'job', name: 'Fast Lane', actual_seconds: 420, budget_seconds: 415 },
    { type: 'step', name: 'Fast Lane::Vitest', actual_seconds: 260, budget_seconds: 251 },
  ]);
});

test('invalid or missing timings fail closed', () => {
  assert.throws(
    () => summarizeJobs({ jobs: [{ name: 'bad', started_at: 'nope', completed_at: null, steps: [] }] }),
    /invalid timing/,
  );
});

test('negative durations fail closed', () => {
  assert.throws(
    () => summarizeJobs({ jobs: [{ name: 'bad', started_at: '2026-08-15T00:01:00Z', completed_at: '2026-08-15T00:00:00Z', steps: [] }] }),
    /invalid timing/,
  );
});

test('no configured budget means no invented regression', () => {
  const summary = summarizeJobs(payload);
  assert.deepEqual(compareBudgets(summary, { jobs: {}, steps: {} }), []);
});
