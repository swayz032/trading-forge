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

const rows = [];
for (const id of ORIGINAL_52_IDS) {
  const b = baseById.get(id), n = nowById.get(id);
  if (!b || !n || b.kind !== 'source') continue;       // runtime rows have no source text
  const eWas = emitJs(b.body), eNow = emitJs(n.body);
  const emitSame = eWas === eNow;
  const preReg = PREREGISTERED_EMIT_CHANGES[id];
  const ok = emitSame || !!preReg;
  rows.push({ id, emitSame, preReg, ok, eWas, eNow });
  console.log(`${id.padEnd(9)} ${sha(b.body).padEnd(17)} ${sha(n.body).padEnd(17)} ${sha(eWas).padEnd(17)} ${sha(eNow).padEnd(17)} ${emitSame ? 'EMIT-IDENTICAL' : (preReg ? 'CHANGED — PRE-REGISTERED' : '*** CHANGED — UNDECLARED ***')}`);
}

const changed = rows.filter((r) => !r.emitSame);
const undeclared = rows.filter((r) => !r.ok);
console.log('='.repeat(126));
console.log(`rows compared: ${rows.length} | EMIT-IDENTICAL: ${rows.length - changed.length} | emit CHANGED: ${changed.length} | UNDECLARED: ${undeclared.length}`);

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

process.exitCode = (undeclared.length === 0 && ctlSame && ctlDiff) ? 0 : 1;
