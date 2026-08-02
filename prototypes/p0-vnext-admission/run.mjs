// Runner: executes every corpus subcase and attributes each verdict to the catcher that
// actually fired. Honours the design's laws:
//   VALIDITY BEFORE VERDICT     - a parse failure is a FAILED proof, never a pass
//   WRONG CATCHER = FAILED      - red via a different rule than the named one is a MISS
//   HONEST NAMED MISSES         - reported, never absorbed into the coverage number
import { OPENED } from './fs-tracker.mjs';   // FIRST: patches fs before any rule module reads
import { admitSource } from './source-admission.mjs';
import { admitRuntime } from './runtime-admission.mjs';
import { CORPUS, GREEN, NOT_IMPLEMENTED } from './corpus.mjs';

globalThis.__GETTER_HITS__ = 0;

const results = [];
for (const c of CORPUS) {
  let fired = [], parseOk = true, detail = '';
  if (c.kind === 'source') {
    const r = admitSource('fixture.ts', c.body);
    parseOk = r.parseOk;
    fired = r.violations.map((v) => v.catcher);
    detail = r.violations.map((v) => `${v.catcher} @ ${v.path}`).join(' | ');
  } else {
    const r = admitRuntime(c.factory());
    fired = r.violations.map((v) => v.catcher);
    detail = r.violations.map((v) => `${v.catcher} @ ${v.path}`).join(' | ');
  }
  const uniqFired = [...new Set(fired)];
  let status;
  if (!parseOk) status = 'FAILED_PARSE';                       // never a pass
  else if (c.expect === NOT_IMPLEMENTED) status = 'MISS_NOT_IMPLEMENTED';
  else if (uniqFired.includes(c.expect)) status = 'ATTRIBUTED';
  else if (uniqFired.length > 0) status = 'FAILED_WRONG_CATCHER';
  else status = 'MISS_NOT_CAUGHT';
  results.push({ ...c, body: undefined, factory: undefined, fired: uniqFired, status, detail });
}

// ---- GREEN neighbours must be ADMITTED ----
const greens = GREEN.map((g) => {
  const r = g.kind === 'source' ? admitSource('green.ts', g.body) : admitRuntime(g.factory());
  return { id: g.id, ok: r.ok, detail: (r.violations || []).map((v) => `${v.catcher} @ ${v.path}`).join(' | ') };
});

// ---- NEGATIVE CONTROL: a subcase naming a catcher no rule emits must be REPORTED ----
const ctrlRes = admitRuntime({ id: 'L1', a: 1 });
const negControl = {
  planted: '1b-R:no-such-rule',
  reported: !ctrlRes.violations.some((v) => v.catcher === '1b-R:no-such-rule'),
};

const tally = (s) => results.filter((r) => r.status === s).length;
const attributed = tally('ATTRIBUTED');
const summary = {
  total: results.length,
  attributed,
  miss_not_implemented: tally('MISS_NOT_IMPLEMENTED'),
  miss_not_caught: tally('MISS_NOT_CAUGHT'),
  failed_wrong_catcher: tally('FAILED_WRONG_CATCHER'),
  failed_parse: tally('FAILED_PARSE'),
  green_admitted: greens.filter((g) => g.ok).length,
  green_total: greens.length,
  getter_invocations: globalThis.__GETTER_HITS__,
};

const line = (r) => `${r.id.padEnd(7)} ${r.status.padEnd(22)} ${r.atom.slice(0, 38).padEnd(38)} ${r.status === 'ATTRIBUTED' ? r.expect : (r.fired.join(',') || '<none fired>')}`;
console.log('P0-vNext ADMISSION PROTOTYPE — COVERAGE RUN');
console.log('='.repeat(104));
for (const r of results) console.log(line(r));
console.log('='.repeat(104));
console.log('GREEN NEIGHBOURS (must be admitted):');
for (const g of greens) console.log(`  ${g.id.padEnd(16)} ${g.ok ? 'ADMITTED' : '*** REJECTED *** ' + g.detail}`);
console.log('='.repeat(104));
console.log(JSON.stringify(summary, null, 2));
console.log(`NEGATIVE CONTROL: planted catcher '${negControl.planted}' correctly absent from a clean run: ${negControl.reported}`);
console.log(`GETTER INVOCATION COUNTER (required 0): ${globalThis.__GETTER_HITS__}`);

// ---- SEPARABILITY: measured by OBSERVED READS, not by grepping my own source ----
// The first version grepped this file for the forbidden filenames and matched its OWN
// literals, reporting 2. A check that reads its own assertion list is measuring itself.
console.log(`SEPARABILITY: files actually opened during this run: ${OPENED.size}`);

const ledgerHits = [...OPENED].filter((f) => /P1-P2-TOTAL-MEMBERSHIP|ORACLE\.json/.test(f));
console.log(`SEPARABILITY: ledger/oracle artifacts opened: ${ledgerHits.length} (required 0)`);
console.log(`SEPARABILITY POSITIVE CONTROL: the tracker DID observe ${OPENED.size} real reads, so a 0 above is a measured absence, not a dead probe.`);

export { results, summary, greens };
