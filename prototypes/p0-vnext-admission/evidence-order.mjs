/**
 * 4d-ii INSTRUMENT — "terminal acceptance failure exits non-zero AFTER EVIDENCE COLLECTION"
 *
 * ⚠️ THIS FIXTURE DELIBERATELY DOES NOT RULE. R-596 §3 leaves the reading of
 * "after evidence collection" OPEN and PROVISIONAL, and `AN INSTRUMENT THAT PICKS AN
 * INTERPRETATION RULES ON IT` (R-596 §8). So this scores TWO INDEPENDENT COLUMNS and
 * selects neither:
 *
 *   (i)  OWN_FINDING — the terminating run printed ITS OWN finding before exiting.
 *                      This is reading (B)'s verdict column.
 *   (ii) FULL_BODY   — the terminating run printed the FULL evidence body before exiting.
 *                      This is reading (A)'s verdict column.
 *
 * The desk reads its answer off whichever column its later ruling selects. Because both
 * columns are emitted for every knob, that ruling is auditable against data that
 * PREDATES it.
 *
 * EXIT SEMANTICS — and this is the load-bearing design decision:
 *   exit 0 = the MEASUREMENT succeeded (every knob scored on both columns, no UNKNOWN
 *            cell, the RED witness scored 0/0, and the POPULATION was fully accounted for).
 *   exit 1 = the INSTRUMENT could not measure.
 * It is NOT non-zero because column (ii) has reds. Exiting on a red column would enact
 * reading (A) in code, which is the precise thing this fixture exists to avoid.
 *
 * ── F-4, FIXED HERE (R-600 §5, §9.1) ────────────────────────────────────────────────────
 * The first version of this file derived its population from ONE syntactic form,
 * `INJECT === '<name>'`, and reported 25 knobs. run.mjs declares knobs in TWO forms: that
 * one, and `case '<name>':` labels inside `switch (INJECT)` blocks. The true population is
 * 37. Every figure this instrument emitted was divided by a wrong denominator, and NOTHING
 * WENT RED — the parser silently returned a subset.
 *
 * ★ THE FIX IS NOT "ADD THE SECOND REGEX". A second hand-written pattern has the identical
 * failure mode the moment run.mjs grows a third form. Instead this parser ACCOUNTS FOR
 * EVERY `INJECT` OCCURRENCE in the file: each one must match a RECOGNIZED form, and any
 * occurrence that matches none is a FAULT that reddens the instrument before a single
 * measurement is taken. `LIVE-PARSED IS NOT COMPLETE` — provenance (where the list came
 * from) and coverage (whether it is all of them) are different properties, and the old
 * header argued only the first.
 *
 * ★ FAIL-CLOSED, DELIBERATELY: an occurrence this parser cannot classify produces a RED,
 * never a smaller population. A false RED costs one human read; a false GREEN silently
 * re-scopes every number downstream. That asymmetry is the whole design.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');

// ============================================================================================
// THE POPULATION PARSER — exhaustive accounting over `INJECT` occurrences
// ============================================================================================

const KNOB_NAME = "[a-z_][a-z0-9_]*";

/**
 * Mask comments (and optionally string CONTENTS) with spaces, preserving every byte offset
 * and every newline so line numbers and indices stay true to the original source.
 *
 * Template literals are handled with a frame stack: `${ ... }` re-enters CODE, and the
 * matching `}` returns to the template. A flat "a template is one string" scanner loses the
 * `${INJECT || …}` echo sites — i.e. it would DROP occurrences, which is the exact class of
 * silent under-counting this whole file exists to stop.
 */
function mask(src, { strings = false } = {}) {
  const out = new Array(src.length);
  const frames = [{ kind: 'code', depth: 0 }];
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');
  let i = 0;
  while (i < src.length) {
    const top = frames[frames.length - 1];
    const c = src[i];
    const d = src[i + 1];

    if (top.kind === 'code') {
      if (c === '/' && d === '/') {
        while (i < src.length && src[i] !== '\n') out[i] = blank(src[i]), i++;
        continue;
      }
      if (c === '/' && d === '*') {
        out[i] = ' '; out[i + 1] = ' '; i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) out[i] = blank(src[i]), i++;
        if (i < src.length) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        frames.push({ kind: c === '`' ? 'tpl' : 'str', quote: c });
        out[i] = c; i++;
        continue;
      }
      if (c === '{') { top.depth++; out[i] = c; i++; continue; }
      if (c === '}') {
        if (top.depth === 0 && frames.length > 1) { frames.pop(); out[i] = c; i++; continue; }
        top.depth--; out[i] = c; i++; continue;
      }
      out[i] = c; i++;
      continue;
    }

    // inside a string or template
    if (c === '\\') {
      out[i] = strings ? ' ' : c;
      if (i + 1 < src.length) out[i + 1] = strings ? blank(src[i + 1]) : src[i + 1];
      i += 2;
      continue;
    }
    if (top.kind === 'str' && c === top.quote) { frames.pop(); out[i] = c; i++; continue; }
    if (top.kind === 'tpl') {
      if (c === '`') { frames.pop(); out[i] = c; i++; continue; }
      if (c === '$' && d === '{') {
        frames.push({ kind: 'code', depth: 0 });
        out[i] = '$'; out[i + 1] = '{'; i += 2;
        continue;
      }
    }
    out[i] = strings ? blank(c) : c;
    i++;
  }
  return out.join('');
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
const lineTextAt = (src, idx) => (src.split('\n')[lineOf(src, idx) - 1] ?? '').trim();

/**
 * Every recognized way run.mjs may mention INJECT. `declares` forms contribute knob names;
 * the others contribute none but ARE accounted for. Anything unmatched is a fault.
 */
function classifyOccurrence(code, idx) {
  const before = code.slice(Math.max(0, idx - 40), idx);
  const after = code.slice(idx);

  if (/\bconst\s+$/.test(before)) return { form: 'declaration' };
  if (/\(\s*$/.test(before) && /^switch\s*\(\s*$/.test(before.slice(before.lastIndexOf('switch')))) {
    return { form: 'switch' };
  }
  const eq = after.match(new RegExp(`^INJECT\\s*===\\s*'(${KNOB_NAME})'`));
  if (eq) return { form: 'strict_equality', name: eq[1] };
  if (/^INJECT\s*\|\|/.test(after)) return { form: 'echo' };
  if (/^INJECT\s*\?/.test(after)) return { form: 'echo' };
  return { form: null };
}

/** Collect `case '<name>':` labels from the block a `switch (INJECT)` opens, by BRACE MATCHING. */
function switchCaseNames(code, noStrings, switchIdx) {
  const open = noStrings.indexOf('{', switchIdx);
  if (open === -1) return { names: [], faults: ['switch (INJECT) has no opening brace'] };
  let depth = 0;
  let end = -1;
  for (let i = open; i < noStrings.length; i++) {
    if (noStrings[i] === '{') depth++;
    else if (noStrings[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return { names: [], faults: ['switch (INJECT) block is unterminated'] };

  const body = code.slice(open, end);
  const bodyNoStrings = noStrings.slice(open, end);
  const names = [];
  const faults = [];
  // Every `case` label in the block must be a plain string literal. `case FOO:` is a knob this
  // parser cannot name, and naming nothing while counting nothing is how F-4 happened.
  for (const m of bodyNoStrings.matchAll(/\bcase\b/g)) {
    const lit = body.slice(m.index).match(new RegExp(`^case\\s+'(${KNOB_NAME})'\\s*:`));
    if (lit) { names.push(lit[1]); continue; }
    faults.push(`unrecognized case label inside switch (INJECT): ${body.slice(m.index, m.index + 60).split('\n')[0].trim()}`);
  }
  return { names, faults, end };
}

/**
 * PURE over source TEXT — that is what makes the red-proof possible without writing a byte
 * to run.mjs. R-600 §6 measured a mutate-and-revert cycle on this very directory corrupting
 * a concurrent grader's control run while `git status` was CLEAN AT BOTH ENDS.
 */
export function parseInjectionKnobs(src, label = 'run.mjs') {
  const code = mask(src);                      // comments gone, string CONTENTS kept (names live there)
  const noStrings = mask(src, { strings: true }); // + string contents gone (safe brace matching)
  const names = new Set();
  const faults = [];
  const byForm = Object.create(null);
  let occurrences = 0;

  for (const m of code.matchAll(/\bINJECT\b/g)) {
    occurrences++;
    const c = classifyOccurrence(code, m.index);
    if (!c.form) {
      faults.push(`unrecognized INJECT form at ${label}:${lineOf(src, m.index)} — ${lineTextAt(src, m.index)}`);
      continue;
    }
    byForm[c.form] = (byForm[c.form] ?? 0) + 1;
    if (c.name) names.add(c.name);
    if (c.form === 'switch') {
      const sw = switchCaseNames(code, noStrings, m.index);
      for (const n of sw.names) names.add(n);
      for (const f of sw.faults) faults.push(`${label}:${lineOf(src, m.index)} — ${f}`);
    }
  }

  return { names: [...names].sort(), faults, occurrences, byForm };
}

// ============================================================================================
// THE PINNED KNOB SET (R-601 §2) — MEMBERSHIP, NEVER CARDINALITY
// ============================================================================================
/**
 * A corrected parser is not enough. The population can shrink for reasons that have nothing
 * to do with an unrecognized form — a truncated read, a renamed identifier, a refactor, a
 * glob that stops matching — and R-601 §3 measured the old instrument reporting a population
 * of ONE as `MEASUREMENT COMPLETE`, exit 0.
 *
 * ★ THE ASSERTION IS `pinned ⊆ discovered`, AND IT IS NOT A COUNT.
 *   - `=== 37` breaks on every legitimate addition and trains the next seat to bump a number.
 *   - `>= 37` passes while 12 knobs are swapped for 12 others.
 *   - Either one embalms a snapshot as a requirement.
 *   A knob that stops being discovered goes RED AND NAMES ITSELF, whatever the cause.
 *   Knobs discovered BEYOND the pin are reported and are NOT a failure — the population may
 *   grow; a deliberate pin-bump admits them.
 *
 * PROVENANCE: generated from `parseInjectionKnobs(run.mjs)` at commit 19a46ac0 — NOT typed
 * from a ruling or from memory. Cross-checked against two independent counts of the same
 * file: 25 `INJECT === '…'` + 12 distinct `case '…':` labels = 37, which is also the figure
 * R-600 §5 corroborated on three non-overlapping paths.
 * ⚠️ A transcription error here cannot pass silently: a mistyped or invented name is a name
 * that will never be discovered, and the subset check reddens on it by name.
 */
export const PINNED_KNOBS = Object.freeze([
  'emitted_module', 'fixture_invalid', 'getter', 'green_add', 'green_delete', 'green_duplicate',
  'green_rejected', 'green_to_red', 'ledger_read', 'membership_add', 'membership_delete',
  'membership_delete_guard', 'membership_duplicate', 'membership_rename', 'module_collection_add',
  'module_collection_delete', 'neg_control', 'new_unpinned_collection', 'own_extra_code',
  'own_extra_inside_anchor', 'own_unrelated_attributed', 'own_unrelated_nonowned', 'ownership',
  'parse', 'partition_overlap', 'position_unclassified', 'prereg_delete', 'substituted_diagnostic',
  'surface_health', 'surface_invalid_rows', 'tuple_disagreement', 'twin', 'twin_pairs_delete',
  'type_invalid_unclassified', 'uncaught_stale', 'uncaught_undeclared', 'wrong_catcher',
]);

export function checkPinnedMembership(discovered) {
  const found = new Set(discovered);
  return {
    missing: PINNED_KNOBS.filter((n) => !found.has(n)),
    beyond: discovered.filter((n) => !PINNED_KNOBS.includes(n)),
  };
}

/**
 * THE F-4 WITNESS, KEPT ON PURPOSE. This is the ORIGINAL one-form parser, retained so the
 * red-proof harness can demonstrate the defect on the unmodified file rather than assert it.
 * It is never used to measure anything.
 */
export function legacyOneFormKnobs(src) {
  const names = new Set();
  for (const m of src.matchAll(/INJECT === '([a-z_]+)'/g)) names.add(m[1]);
  return [...names].sort();
}

// ---- THE TWO COLUMNS, AS PREDICATES OVER STDOUT ------------------------------------------
// Both are STRUCTURAL (named sections the body emits), never a line count. A line-count
// threshold would be a proxy, and a proxy silently re-scopes the moment the body changes
// length for an unrelated reason.
const BODY_MARKERS = ['PINNED SURFACE:', 'SEPARABILITY:', 'NEGATIVE CONTROL:'];
const FINDING_RE = /^\s*\*\*\* /m;

export const scoreOwnFinding = (out) => FINDING_RE.test(out);
export const scoreFullBody = (out) => BODY_MARKERS.every((m) => out.includes(m));

function runInjection(inj) {
  const r = spawnSync(process.execPath, [RUN], {
    cwd: HERE,
    env: { ...process.env, PROTO_INJECT: inj },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { failed: String(r.error.message) };
  return {
    exit: r.status,
    out: r.stdout ?? '',
    errBytes: Buffer.byteLength(r.stderr ?? ''),
    lines: (r.stdout ?? '').split('\n').length - 1,
  };
}

// ---- THE RED WITNESS -----------------------------------------------------------------------
// R-596 §4 requires the RED path DEMONSTRATED, not asserted. The INSTRUMENT FAULT throw class
// is the witness: it terminates non-zero emitting ZERO stdout, so it scores 0 on BOTH columns.
// Raised by calling the real assertion with disagreeing arguments — no file is edited and no
// pin is moved, so this witness costs the object nothing.
// ⚠️ R-600 §2: this witness sits OUTSIDE 4d's ruled population, so it demonstrates that the
// COLUMNS can go red — it does NOT falsify a claim quantified over the acceptance population.
function redWitness() {
  const src = "import('./module-collections.mjs').then(m=>{"
    + "m.assertParserAgreesWithRuntime('export const FOO = [1];', ['BAR']);"
    + "process.exit(0);}).catch(e=>{console.error(e.message);process.exit(1);});";
  const r = spawnSync(process.execPath, ['-e', src], { cwd: HERE, encoding: 'utf8' });
  const out = r.stdout ?? '';
  return {
    exit: r.status,
    out,
    threw: /INSTRUMENT FAULT/.test(r.stderr ?? ''),
    ownFinding: scoreOwnFinding(out),
    fullBody: scoreFullBody(out),
    lines: out.split('\n').length - 1,
  };
}

// ============================================================================================
// MODES
// ============================================================================================

/**
 * `--check-population <file>` — parse-only. Exists so the red-proof harness can prove the
 * PROCESS exit code, not merely the parser's return value. It spawns nothing and measures
 * nothing, and it is an explicit argv mode rather than a hidden env switch so it can never
 * silently redirect a real measurement.
 */
function checkPopulationMode(file) {
  const parsed = parseInjectionKnobs(fs.readFileSync(file, 'utf8'), file);
  console.log(`POPULATION CHECK: ${file}`);
  console.log(`INJECT occurrences accounted: ${parsed.occurrences} ${JSON.stringify(parsed.byForm)}`);
  console.log(`knobs: ${parsed.names.length}`);
  const faults = populationFaults(parsed);
  if (faults.length) {
    for (const f of faults) console.log(`*** STOP CONDITION (population): ${f}`);
    return 1;
  }
  console.log('POPULATION ACCOUNTED: every INJECT occurrence matched a recognized form, '
    + 'and every pinned knob was discovered.');
  return 0;
}

/**
 * The two population obligations in one place, so both modes cannot drift apart:
 *   1. every INJECT occurrence matched a recognized form  (R-600 §9.1)
 *   2. every PINNED knob was discovered                   (R-601 §2)
 * Knobs discovered beyond the pin are NOT faults.
 */
function populationFaults(parsed) {
  const faults = [...parsed.faults];
  const { missing } = checkPinnedMembership(parsed.names);
  for (const n of missing) {
    faults.push(`PINNED KNOB NOT DISCOVERED: '${n}' — the population shrank; this instrument's `
      + 'denominator is not trustworthy and nothing may be measured against it');
  }
  return faults;
}

function main() {
  const parsed = parseInjectionKnobs(fs.readFileSync(RUN, 'utf8'));
  const knobs = parsed.names;

  console.log('='.repeat(112));
  console.log('4d-ii EVIDENCE-ORDER INSTRUMENT — TWO COLUMNS, READING-NEUTRAL (R-596 §4)');
  console.log(`INJECT occurrences in run.mjs, ALL accounted for: ${parsed.occurrences} ${JSON.stringify(parsed.byForm)}`);
  console.log(`declared injection knobs parsed from run.mjs: ${knobs.length}`);
  console.log('='.repeat(112));

  // 🛑 A population this parser could not fully account for is not a smaller population — it is
  // an unusable one. Nothing is measured until this is clean.
  const { missing, beyond } = checkPinnedMembership(knobs);
  console.log(`pinned knobs: ${PINNED_KNOBS.length} | missing from discovery: ${missing.length} `
    + `| discovered beyond the pin: ${beyond.length}${beyond.length ? ` (${beyond.join(', ')})` : ''}`);
  const popFaults = populationFaults(parsed);
  if (popFaults.length) {
    for (const f of popFaults) console.log(`*** STOP CONDITION (population): ${f}`);
    console.log('*** REFUSING TO MEASURE: the knob population is not fully accounted for.');
    process.exitCode = 1;
    return;
  }

  const control = runInjection('');
  console.log(`CONTROL (no injection): exit=${control.exit} lines=${control.lines} stderr_bytes=${control.errBytes}`);
  if (control.exit !== 0) {
    console.log('*** INSTRUMENT FAULT: the clean control did not exit 0 — nothing measured here means anything');
    process.exitCode = 1;
    return;
  }
  console.log('');
  console.log('knob                          exit  lines   (i) OWN_FINDING   (ii) FULL_BODY');
  console.log('-'.repeat(112));

  const rows = [];
  for (const knob of knobs) {
    const r = runInjection(knob);
    if (r.failed) {
      console.log(`${knob.padEnd(28)}  SPAWN FAILED: ${r.failed}`);
      rows.push({ knob, unknown: true });
      continue;
    }
    const row = {
      knob,
      exit: r.exit,
      lines: r.lines,
      ownFinding: scoreOwnFinding(r.out),
      fullBody: scoreFullBody(r.out),
      errBytes: r.errBytes,
    };
    rows.push(row);
    console.log(
      `${knob.padEnd(28)}  ${String(row.exit).padEnd(4)} ${String(row.lines).padStart(5)}   `
      + `${(row.ownFinding ? 'YES' : 'NO').padEnd(15)}   ${row.fullBody ? 'YES' : 'NO'}`,
    );
  }

  // ---- THE RED WITNESS, RUN AND SHOWN ------------------------------------------------------
  const red = redWitness();
  console.log('-'.repeat(112));
  console.log(
    `${'<INSTRUMENT FAULT throw>'.padEnd(28)}  ${String(red.exit).padEnd(4)} ${String(red.lines).padStart(5)}   `
    + `${(red.ownFinding ? 'YES' : 'NO').padEnd(15)}   ${red.fullBody ? 'YES' : 'NO'}   <- RED WITNESS (outside 4d's population, R-600 §2)`,
  );

  // ---- SUMMARY, BOTH COLUMNS, NEITHER SELECTED ---------------------------------------------
  const scored = rows.filter((r) => !r.unknown);
  const unknown = rows.filter((r) => r.unknown);
  const colI = scored.filter((r) => r.ownFinding).length;
  const colII = scored.filter((r) => r.fullBody).length;
  const nonZero = scored.filter((r) => r.exit !== 0).length;

  console.log('');
  // ⚠️ POPULATION CAPTION (R-596 §2): these are INJECTION KNOBS, not declared FAILURE_CLASSES.
  // The join is NOT 1:1 — `green_to_red` is ONE knob appearing as a case label in BOTH switch
  // blocks, and `module_collection_add`/`_delete` fire the single class `module_collections`.
  // Counting knobs and calling them classes is the join error R-596 §2 and R-600 §3.2 corrected.
  console.log(`POPULATION: ${scored.length} injection KNOBS (not classes; the knob->class join is not 1:1)`);
  console.log(`4d-i   terminal failure exits non-zero      : ${nonZero}/${scored.length}`);
  console.log(`4d-ii  COLUMN (i)  own finding printed      : ${colI}/${scored.length}   <- reading (B)'s verdict`);
  console.log(`4d-ii  COLUMN (ii) full evidence body       : ${colII}/${scored.length}   <- reading (A)'s verdict`);
  console.log(`       cells UNKNOWN                        : ${unknown.length}`);
  console.log('');
  console.log('DIVERGENT ROWS (the two columns disagree — these ARE the reading question):');
  const divergent = scored.filter((r) => r.ownFinding !== r.fullBody);
  if (divergent.length === 0) console.log('  <none>');
  for (const r of divergent) {
    console.log(`  ${r.knob}: own_finding=${r.ownFinding} full_body=${r.fullBody} lines=${r.lines} exit=${r.exit}`);
  }
  console.log('');
  console.log('*** THIS FIXTURE RULES ON NEITHER READING. R-596 §3 holds the choice open. ***');

  // ---- THE INSTRUMENT'S OWN SELF-CHECK -----------------------------------------------------
  // Fails ONLY on a measurement defect — never on which column is red.
  const faults = [];
  if (unknown.length) faults.push(`${unknown.length} knob(s) could not be scored`);
  if (!red.threw) faults.push('the RED witness did not raise an INSTRUMENT FAULT — the red path is asserted, not demonstrated');
  if (red.ownFinding || red.fullBody) faults.push('the RED witness scored non-zero on a column — it cannot serve as the 0/0 witness');
  if (scored.length === 0) faults.push('no knobs were scored at all');

  if (faults.length) {
    console.log('');
    for (const f of faults) console.log(`*** STOP CONDITION (4d-ii instrument): ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`MEASUREMENT COMPLETE: ${scored.length} knobs scored on both columns; `
      + `RED witness demonstrated at 0/0 (exit=${red.exit}, stdout lines=${red.lines}).`);
    process.exitCode = 0;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const i = process.argv.indexOf('--check-population');
  if (i !== -1) process.exitCode = checkPopulationMode(process.argv[i + 1]);
  else main();
}
