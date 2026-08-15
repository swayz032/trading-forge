import test from 'node:test';
import assert from 'node:assert/strict';
import { profileTestHotspots } from './test-hotspot-profiler.mjs';

test('sorts slowest tests and computes shares', () => {
  const r = profileTestHotspots([
    { name: 'fast', duration_ms: 10 },
    { name: 'slow', duration_ms: 70 },
    { name: 'mid', duration_ms: 20 },
  ], { top: 2 });
  assert.equal(r.total_duration_ms, 100);
  assert.equal(r.hotspots[0].name, 'slow');
  assert.equal(r.hotspots[0].share_pct, 70);
  assert.equal(r.hotspots[1].cumulative_pct, 90);
});

test('zero-duration census stays bounded', () => {
  const r = profileTestHotspots([{ name: 'a', duration_ms: 0 }]);
  assert.equal(r.hotspots[0].share_pct, 0);
});

test('invalid timing rejects', () => {
  assert.throws(() => profileTestHotspots([{ name: 'x', duration_ms: -1 }]), /duration_ms/);
});

test('empty input rejects', () => {
  assert.throws(() => profileTestHotspots([]), /non-empty array/);
});
