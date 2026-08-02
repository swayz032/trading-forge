// THE EFFECTIVE-MODULE TUPLE, PUBLISHED, HASHED, AND EXECUTED (R-543 s4 item 5 + R-544 s3 item 7).
//
// R-543 s4 item 5 corrected the desk's own earlier wording: pinning ESM in prose "closes the
// channel BY CONSTRUCTION" was PREMATURE -- it is a design edit plus a catcher until the
// EMITTED ARTIFACT and the LOADER decision are enforced. `"type": "module"` is a Node LOADER
// input; emit is decided by `compilerOptions.module`. They are different knobs and a design
// that names only one has not pinned the module system.
//
// So this module does the thing prose cannot: it EMITS the artifact and RUNS it.
//
//   ESM arm  -- emitted .mjs, executed by node -> top-level `this` must be UNAVAILABLE.
//   CJS arm  -- emitted .cjs, executed by node -> top-level `this` must BE the wrapper object.
//
// The CJS arm is the POSITIVE CONTROL and it is not optional: "top-level `this` is absent
// under ESM" is an ABSENCE CLAIM, and an absence claim measured without a witness that the
// probe can ever observe presence is indistinguishable from a dead probe.
import ts from 'typescript';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SURFACE_DIR, PINNED_OPTIONS, effectiveModuleTuple } from './source-admission.mjs';

// ONE probe source text, emitted into BOTH containers. It reports its own top-level `this`
// from INSIDE the emitted artifact -- the only place the question can actually be answered.
export const THIS_PROBE_SRC =
  `const TOP_LEVEL_THIS = typeof this;\n` +
  `export const project = (lane: Lane) => ({ v: lane.v });\n` +
  `console.log(JSON.stringify({ topLevelThis: TOP_LEVEL_THIS }));\n`;

export function pinnedSurfaceHash() {
  const files = fs.readdirSync(SURFACE_DIR).filter((f) => !f.startsWith('.')).sort();
  const per = {};
  const combined = crypto.createHash('sha256');
  for (const f of files) {
    const buf = fs.readFileSync(path.join(SURFACE_DIR, f));
    const h = crypto.createHash('sha256').update(buf).digest('hex');
    per[f] = `${h.slice(0, 16)} (${buf.length}B)`;
    combined.update(f).update(buf);
  }
  return { files: per, combined: combined.digest('hex') };
}

// `injectWrongContainer` is the red-proof mutation for this class (R-544 s3 item 9): it
// emits the ESM arm from a `.cts` source, so the ARTIFACT really is CommonJS and its
// top-level `this` really is the wrapper object. The detector must notice. This mutates the
// artifact under test, not the assertion about it -- a mutation that only edits the
// expectation proves nothing.
export function emitAndExecuteTuple({ injectWrongContainer = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0vnext-emit-'));
  // The emitted artifact's own package.json: this is the LOADER input, distinct from
  // compilerOptions.module which is the EMIT input. Both are published in the tuple.
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'emit-probe', type: 'module' }, null, 2));
  fs.copyFileSync(path.join(SURFACE_DIR, 'ambient.d.ts'), path.join(dir, 'ambient.d.ts'));
  // `console` is declared HERE, in the emit probe's own scratch surface -- deliberately NOT
  // in the pinned surface/ambient.d.ts. A fixture must not gain a host global just because
  // this probe needed one to report its result.
  fs.writeFileSync(path.join(dir, 'probe-ambient.d.ts'), 'declare const console: { log(s: string): void };\n');

  const arms = [
    { arm: 'ESM', srcExt: injectWrongContainer ? '.cts' : '.mts', outExt: injectWrongContainer ? '.cjs' : '.mjs', expectThis: 'undefined' },
    { arm: 'CJS', srcExt: '.cts', outExt: '.cjs', expectThis: 'object' },
  ];
  const out = [];
  for (const a of arms) {
    const srcFile = path.join(dir, `probe${a.srcExt}`);
    fs.writeFileSync(srcFile, THIS_PROBE_SRC);
    const options = { ...PINNED_OPTIONS, noEmit: false, outDir: undefined, configFilePath: undefined };
    const program = ts.createProgram([srcFile, path.join(dir, 'ambient.d.ts'), path.join(dir, 'probe-ambient.d.ts')], options);
    const emitResult = program.emit();
    const diags = [...ts.getPreEmitDiagnostics(program), ...emitResult.diagnostics]
      .filter((d) => d.file && d.file.fileName.endsWith(`probe${a.srcExt}`))
      .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    const emitted = path.join(dir, `probe${a.outExt}`);
    const emittedExists = fs.existsSync(emitted);
    let observedThis = null, stdout = '', execError = null;
    if (emittedExists) {
      try {
        stdout = execFileSync(process.execPath, [emitted], { encoding: 'utf8', timeout: 20000 });
        observedThis = JSON.parse(stdout.trim().split('\n').pop()).topLevelThis;
      } catch (e) { execError = String(e.message).slice(0, 200); }
    }
    out.push({
      ...a,
      tuple: effectiveModuleTuple(srcFile),
      emittedFile: `probe${a.outExt}`,
      emittedExists,
      emittedBytes: emittedExists ? fs.readFileSync(emitted, 'utf8') : null,
      diagnostics: diags,
      observedTopLevelThis: observedThis,
      execError,
      // The probe source must itself be type-clean, or the artifact it emitted is not the
      // artifact the pinned surface would admit.
      ok: emittedExists && !execError && diags.length === 0 && observedThis === a.expectThis,
    });
  }

  const esm = out.find((o) => o.arm === 'ESM');
  const cjs = out.find((o) => o.arm === 'CJS');
  const verdict = {
    arms: out,
    // THE CLAIM, and it is two-sided on purpose.
    esm_this_unavailable: esm.observedTopLevelThis === 'undefined',
    cjs_positive_control_this_present: cjs.observedTopLevelThis === 'object',
    ok: esm.ok && cjs.ok,
    note: cjs.observedTopLevelThis === 'object'
      ? 'The CJS arm OBSERVED the wrapper `this`, so the ESM arm\'s "undefined" is a measured absence.'
      : '*** POSITIVE CONTROL DEAD: the CJS arm did not observe the wrapper `this`, so the ESM result proves nothing. ***',
    surfaceHash: pinnedSurfaceHash(),
    emitDir: dir,
  };
  return verdict;
}

// Executable directly, for a standalone reproduction.
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const v = emitAndExecuteTuple();
  for (const a of v.arms) {
    console.log(`--- ${a.arm} arm (${a.tuple.extension} -> ${a.emittedFile}) ---`);
    console.log(`  effective format      : ${a.tuple.format}  (decided by ${a.tuple.decidedBy})`);
    console.log(`  ts module / resolution: ${a.tuple.module} / ${a.tuple.moduleResolution}   TS ${a.tuple.tsVersion}`);
    console.log(`  diagnostics           : ${a.diagnostics.length ? a.diagnostics.join(' | ') : 'none'}`);
    console.log(`  EMITTED ARTIFACT      :\n${a.emittedBytes.split('\n').map((l) => `      | ${l}`).join('\n')}`);
    console.log(`  executed -> typeof this at top level = ${JSON.stringify(a.observedTopLevelThis)} (expected ${a.expectThis})  ${a.ok ? 'PASS' : '*** FAIL ***'}`);
  }
  console.log(`\nESM top-level \`this\` UNAVAILABLE          : ${v.esm_this_unavailable}`);
  console.log(`CJS POSITIVE CONTROL (\`this\` IS present) : ${v.cjs_positive_control_this_present}`);
  console.log(v.note);
  console.log(`PINNED SURFACE HASH: ${v.surfaceHash.combined}`);
  console.log(JSON.stringify(v.surfaceHash.files, null, 2));
  process.exitCode = v.ok ? 0 : 1;
}
