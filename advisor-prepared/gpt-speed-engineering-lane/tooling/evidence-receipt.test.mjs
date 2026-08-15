import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReceipt } from './evidence-receipt.mjs';

const good = { job:'AR-X', worker:'worker-1', branch:'b', commit:'abc', files_changed:['x.ts'], red:{command:'test red',result:'1 failed'}, green:{command:'test green',result:'1 passed'}, control:'mutation bit', pushed:true, stopped_for_gpt:true };

test('renders deterministic short receipt', () => {
  const a = renderReceipt(good); const b = renderReceipt(structuredClone(good));
  assert.equal(a, b); assert.match(a, /AR-X/); assert.match(a, /Stopped for GPT: YES/);
});

test('fails closed when proof fields are missing', () => {
  const bad = structuredClone(good); delete bad.control;
  assert.throws(() => renderReceipt(bad), /missing required field: control/);
});

test('refuses unpublished local-only receipt', () => {
  assert.throws(() => renderReceipt({ ...good, pushed:false }), /pushed must be true/);
});

test('redacts common secret forms', () => {
  const out = renderReceipt({ ...good, control:'Bearer abc.DEF_123 API_KEY=hunter2' });
  assert(!out.includes('abc.DEF_123')); assert(!out.includes('hunter2')); assert.match(out, /REDACTED/);
});
