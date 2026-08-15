import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTestText } from './test-theater-detector.mjs';

test('clean production-referencing test has no static signals', () => {
  const r = auditTestText({ text: "import { lower } from '../compiler/lower';\ntest('x',()=>lower());", requiredImportTokens: ['../compiler/lower'], requireMutationEvidence: true, mutationEvidence: true });
  assert.equal(r.verdict, 'NO_STATIC_RISK_SIGNALS');
  assert.equal(r.ok, true);
});

test('critical skipped test blocks', () => {
  const r = auditTestText({ text: "test.skip('critical',()=>{});" });
  assert.equal(r.verdict, 'BLOCK');
  assert.equal(r.ok, false);
});

test('configured production dependency mocking blocks', () => {
  const call = ['vi', 'mock'].join('.') + "('../compiler/lower',()=>({}));";
  const r = auditTestText({ text: call, forbiddenMockTokens: ['../compiler/lower'] });
  assert.equal(r.verdict, 'BLOCK');
  assert.equal(r.ok, false);
});

test('missing production import or mutation proof requires review, not false pass', () => {
  const r = auditTestText({ text: "test('x',()=>{});", requiredImportTokens: ['../compiler/lower'], requireMutationEvidence: true, mutationEvidence: false });
  assert.equal(r.verdict, 'REVIEW_REQUIRED');
  assert.equal(r.ok, false);
  assert.equal(r.review_signals.length, 2);
});

test('malformed import configuration rejects', () => {
  assert.throws(() => auditTestText({ text: 'x', requiredImportTokens: [42] }), /non-empty strings/);
});
