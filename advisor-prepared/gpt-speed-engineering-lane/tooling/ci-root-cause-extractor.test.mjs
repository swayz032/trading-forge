import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCiRootCause } from './ci-root-cause-extractor.mjs';

test('extracts first useful failing context and removes duplicate blocks', () => {
  const log = ['setup ok','suite start','AssertionError: expected 2 got 3','at spec:42','cleanup','AssertionError: expected 2 got 3','at spec:42'].join('\n');
  const r = extractCiRootCause(log, { context: 1, maxBlocks: 5 });
  assert.equal(r.status, 'SIGNALS_FOUND');
  assert(r.blocks.length >= 1);
  assert.match(r.blocks[0].excerpt, /AssertionError/);
});

test('no signal never becomes success', () => {
  const r = extractCiRootCause('setup ok\nall output omitted');
  assert.equal(r.status, 'NO_ROOT_CAUSE_SIGNAL_FOUND');
  assert.equal(r.blocks.length, 0);
});

test('redacts common secret forms in excerpts', () => {
  const r = extractCiRootCause('token=supersecret\nFATAL connection error', { context: 1 });
  assert.doesNotMatch(r.blocks[0].excerpt, /supersecret/);
  assert.match(r.blocks[0].excerpt, /REDACTED/);
});

test('invalid bounds reject', () => {
  assert.throws(() => extractCiRootCause('error', { context: 99 }), /context/);
});
