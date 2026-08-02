// ITEM 11 (R-546 §5.11) — FIXTURE EDITS ARE FROZEN BY EMITTED BEHAVIOUR, NOT BY BYTE COUNT.
//
// A type-only annotation may change TS bytes ONLY IF THE EMITTED JS IS UNCHANGED. That is the
// discriminator between "made the fixture type-valid" and "changed the planted mutation", and
// it is what lets AR-589 §2.1's byte-identical claim be superseded honestly rather than
// quietly.
//
// THE BASELINE IS READ FROM GIT, NEVER HAND-COPIED. `git show 8297ebbe:...corpus.mjs` is the
// AR-589 corpus as committed. A hand-transcribed "expected" value is a fabricated safety
// claim: it proves the transcription, not the artifact.
//
// ⚠️ DECLARED SUBSTITUTION (a proxy-for-production must declare its substitution): the
// baseline module's two RELATIVE import specifiers are rewritten to absolute file URLs so it
// can be imported from a temp directory. The rewrite is exactly those two lines; the printed
// diff count below is the witness. No fixture byte is touched.
import ts from 'typescript';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { CORPUS, GREEN, ORIGINAL_52_IDS, PREREGISTERED_EMIT_CHANGES } from './corpus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_COMMIT = '8297ebbe';
const REPO_PATH = 'prototypes/p0-vnext-admission/corpus.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// Emit with type-checking OFF: we are comparing the JAVASCRIPT, and the baseline bodies do
// not type-check under the pinned surface (that is the whole reason they were edited).
function emitJs(body) {
  const out = ts.transpileModule(body, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return out.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '').join('\n');
}

export function loadBaselineCorpus() {
  const raw = execFileSync('git', ['show', `${BASELINE_COMMIT}:${REPO_PATH}`], { cwd: HERE, encoding: 'utf8' });
  const abs = (n) => JSON.stringify(pathToFileURL(path.join(HERE, n)).href);
  let subs = 0;
  const patched = raw.replace(/from '\.\/(source-admission|runtime-admission)\.mjs'/g, (_m, n) => { subs += 1; return `from ${abs(`${n}.mjs`)}`; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0vnext-baseline-'));
  const f = path.join(dir, 'baseline-corpus.mjs');
  fs.writeFileSync(f, patched);
  return { file: f, substitutions: subs, rawBytes: raw.length };
}

const { file, substitutions, rawBytes } = loadBaselineCorpus();
const base = await import(pathToFileURL(file).href);
const baseById = new Map([...base.CORPUS, ...base.GREEN].map((c) => [c.id, c]));
const nowById = new Map([...CORPUS, ...GREEN].map((c) => [c.id, c]));

console.log('EMITTED-BEHAVIOUR FREEZE (item 11)');
console.log(`BASELINE: ${BASELINE_COMMIT}:${REPO_PATH} (${rawBytes}B, read via git show — NOT hand-copied)`);
console.log(`DECLARED SUBSTITUTION: ${substitutions} import specifier(s) rewritten to absolute URLs; no fixture byte touched.`);
console.log('='.repeat(126));
console.log(`${'id'.padEnd(9)} ${'src(was)'.padEnd(17)} ${'src(now)'.padEnd(17)} ${'emit(was)'.padEnd(17)} ${'emit(now)'.padEnd(17)} verdict`);
console.log('-'.repeat(126));

// 🛑 FOUND BY THE accuracy-validator: this comparator is VACUOUS on rows whose planted mutation
// lives in a construct the emitter ELIDES. An UNUSED import vanishes from the emitted JS, so
// DELETING the planted import outright still read "EMIT-IDENTICAL" — the check could not see
// the very mutation it was certifying, and "31/38" over-counted.
//   A COMPARATOR THAT CANNOT OBSERVE THE MUTATION IS NOT CERTIFYING THE MUTATION.
// Rows in that condition are now reported NOT-COVERED-BY-EMIT and scored by a SECOND,
// non-overlapping signal — the module-edge set read from the SOURCE AST — rather than being
// counted as if the emit comparison had said something.
function moduleEdges(body) {
  const sf = ts.createSourceFile('x.ts', body, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out = [];
  const walk = (n) => {
    if (ts.isImportDeclaration(n)) out.push(`import ${n.moduleSpecifier.getText(sf)}`);
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier) out.push(`re-export ${n.moduleSpecifier.getText(sf)}`);
    else if (ts.isImportEqualsDeclaration(n)) out.push(`import= ${n.moduleReference.getText(sf)}`);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out.sort().join(' | ');
}

const rows = [];
for (const id of ORIGINAL_52_IDS) {
  const b = baseById.get(id), n = nowById.get(id);
  if (!b || !n || b.kind !== 'source') continue;       // runtime rows have no source text
  const eWas = emitJs(b.body), eNow = emitJs(n.body);
  const emitSame = eWas === eNow;
  const edgesWas = moduleEdges(b.body), edgesNow = moduleEdges(n.body);
  // Blind iff the source declares an edge the emitted JS does not mention: the emitter elided
  // it, so emit-equality carries no information about that construct.
  const elided = !!edgesWas && !edgesWas.split(' | ').every((e) => eWas.includes(e.replace(/^\S+ /, '')));
  const preReg = PREREGISTERED_EMIT_CHANGES[id];
  let verdict, ok;
  if (elided) {
    ok = edgesWas === edgesNow || !!preReg;
    verdict = `NOT-COVERED-BY-EMIT — 2nd path: module edges ${edgesWas === edgesNow ? 'UNCHANGED' : (preReg ? 'CHANGED — PRE-REGISTERED' : '*** CHANGED — UNDECLARED ***')}`;
  } else {
    ok = emitSame || !!preReg;
    verdict = emitSame ? 'EMIT-IDENTICAL' : (preReg ? 'CHANGED — PRE-REGISTERED' : '*** CHANGED — UNDECLARED ***');
  }
  rows.push({ id, emitSame, elided, preReg, ok, eWas, eNow, edgesWas, edgesNow });
  console.log(`${id.padEnd(9)} ${sha(b.body).padEnd(17)} ${sha(n.body).padEnd(17)} ${sha(eWas).padEnd(17)} ${sha(eNow).padEnd(17)} ${verdict}`);
}

const covered = rows.filter((r) => !r.elided);
const blind = rows.filter((r) => r.elided);
const changed = covered.filter((r) => !r.emitSame);
const undeclared = rows.filter((r) => !r.ok);
console.log('='.repeat(126));
console.log(`rows compared: ${rows.length} | COVERED by emit: ${covered.length} (EMIT-IDENTICAL ${covered.length - changed.length}, CHANGED ${changed.length}) | NOT-COVERED-BY-EMIT: ${blind.length} [${blind.map((r) => r.id).join(', ')}] | UNDECLARED: ${undeclared.length}`);
console.log(`  ^ the NOT-COVERED rows are scored on the module-edge set instead. Reported as a`);
console.log(`    coverage GAP rather than folded into the EMIT-IDENTICAL count.`);

// The blindness must be DEMONSTRATED, not asserted: delete a planted import and show the emit
// comparator says IDENTICAL while the second path convicts.
const blindWitness = (() => {
  const withImport = `import { read } from './ledger.js';\nexport const project = (lane: Lane) => ({ v: lane.v });\n`;
  const mutationDeleted = `export const project = (lane: Lane) => ({ v: lane.v });\n`;
  return { emitSaysIdentical: emitJs(withImport) === emitJs(mutationDeleted), edgesDiffer: moduleEdges(withImport) !== moduleEdges(mutationDeleted) };
})();
console.log(`BLINDNESS WITNESS — delete the planted import outright: emit comparator says IDENTICAL=${blindWitness.emitSaysIdentical}, module-edge path convicts=${blindWitness.edgesDiffer}`);
console.log(`  ^ both true is the proof the gap is real and that the second path closes it.`);

if (changed.length) {
  console.log('\nEVERY EMIT CHANGE, WITH ITS PRE-REGISTERED REASON AND ITS ACTUAL DIFF:');
  for (const r of changed) {
    console.log(`\n--- ${r.id} --- ${r.preReg ? `PRE-REGISTERED: ${r.preReg}` : '*** NO PRE-REGISTRATION — THIS IS A STOP CONDITION ***'}`);
    console.log(`    was: ${r.eWas.replace(/\n/g, '  //  ')}`);
    console.log(`    now: ${r.eNow.replace(/\n/g, '  //  ')}`);
  }
}
if (undeclared.length) {
  console.log(`\n*** STOP CONDITION (R-546 §7): fixture edits changed emitted JS without a pre-registered mutation: ${undeclared.map((r) => r.id).join(', ')}`);
}

// CONTROL: the comparator must be able to say BOTH things, or "EMIT-IDENTICAL" is unfalsifiable.
const ctlSame = emitJs('export const project = (lane) => ({ v: lane.v });\n') === emitJs('export const project = (lane: Lane) => ({ v: lane.v });\n');
const ctlDiff = emitJs('export const project = (lane) => ({ v: lane.v });\n') !== emitJs('export const project = (lane) => ({ v: lane.w });\n');
console.log(`\nCOMPARATOR CONTROLS — annotation-only edit reads IDENTICAL: ${ctlSame} | behaviour edit reads DIFFERENT: ${ctlDiff}`);
console.log('  ^ both must be true, or this comparator cannot discriminate and every verdict above is void.');

process.exitCode = (undeclared.length === 0 && ctlSame && ctlDiff && blindWitness.emitSaysIdentical && blindWitness.edgesDiffer) ? 0 : 1;
