/**
 * RED-PROOF for the knob-population guard in evidence-order.mjs.
 *
 * TWO OBLIGATIONS ARE PROVEN HERE, AND THEY FAIL FOR DIFFERENT REASONS:
 *   R-600 §9.1 — an UNRECOGNIZED declaration form must go RED, never silently shrink.
 *   R-601 §2   — a PINNED knob that stops being discovered must go RED AND NAME ITSELF,
 *                whatever the cause (truncated read, renamed identifier, refactor, bad glob).
 *
 * ★ WHY NOTHING HERE WRITES TO run.mjs, THOUGH R-600 §9.1 PERMITS IT:
 *   The parser is PURE over source TEXT, so every mutation below is a string in memory.
 *   R-600 §6 measured a mutate-and-revert cycle on this exact directory corrupting a
 *   CONCURRENT grader's control run — `git status` was CLEAN AT BOTH ENDS and the corruption
 *   was invisible to it. An in-memory red-proof cannot do that to anyone, and it is
 *   deterministic. The two process-level cases (C10) write to the OS temp dir, never here.
 *
 * ★ EVERY CASE CARRIES ITS OWN POSITIVE CONTROL: C1 proves the guard CAN pass on the real
 *   file, so the reds below are discrimination, not a guard that is simply always red.
 *   `A CONTROL MUST DISCRIMINATE.`
 *
 * EXIT: 0 = every expectation held. 1 = the guard did not behave as specified.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PINNED_KNOBS,
  checkPinnedMembership,
  legacyOneFormKnobs,
  parseInjectionKnobs,
} from './evidence-order.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const SRC = fs.readFileSync(RUN, 'utf8');

let failures = 0;
const line = '-'.repeat(104);

function expect(caseId, what, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${caseId.padEnd(26)} ${what}`);
  if (detail) console.log(`        ${detail}`);
}

/** Run the full population verdict over an arbitrary source string, exactly as the fixture does. */
function verdict(src) {
  const parsed = parseInjectionKnobs(src);
  const { missing, beyond } = checkPinnedMembership(parsed.names);
  return {
    parsed,
    missing,
    beyond,
    red: parsed.faults.length > 0 || missing.length > 0,
    faultText: [...parsed.faults, ...missing.map((n) => `PINNED KNOB NOT DISCOVERED: '${n}'`)].join('\n'),
  };
}

console.log('='.repeat(104));
console.log('KNOB-POPULATION GUARD — RED-PROOF (R-600 §9.1 unrecognized-form · R-601 §2 shrink)');
console.log('='.repeat(104));

// ── C1 · POSITIVE CONTROL — the guard passes on the unmodified file ────────────────────────
const c1 = verdict(SRC);
expect('C1 control', 'GREEN on the real run.mjs', !c1.red, c1.faultText);
expect('C1 control', `discovers 37 knobs (got ${c1.parsed.names.length})`, c1.parsed.names.length === 37);
expect('C1 control', `every INJECT occurrence accounted (${c1.parsed.occurrences}: ${JSON.stringify(c1.parsed.byForm)})`,
  c1.parsed.faults.length === 0);
expect('C1 control', `pinned set fully discovered (${PINNED_KNOBS.length} pinned, 0 missing)`, c1.missing.length === 0);

console.log(line);

// ── C2 · THE F-4 WITNESS — the guard CONVICTS the defect it was built to catch ─────────────
// This is the actual historical bug, not a synthetic one: the one-form parser's output run
// through the new membership check. It must go RED and name the 12 knobs it dropped.
const legacy = legacyOneFormKnobs(SRC);
const legacyMembership = checkPinnedMembership(legacy);
expect('C2 F-4 witness', `the old one-form parser returns 25 (got ${legacy.length})`, legacy.length === 25);
expect('C2 F-4 witness', `the guard REDDENS on that output — ${legacyMembership.missing.length} pinned knobs missing`,
  legacyMembership.missing.length === 12, `named: ${legacyMembership.missing.join(', ')}`);
expect('C2 F-4 witness', 'the new parser is a strict SUPERSET of the old (no knob was lost by the fix)',
  legacy.every((n) => c1.parsed.names.includes(n)));

console.log(line);

// ── C3 · UNRECOGNIZED FORM → RED, then remove it → GREEN (R-600 §9.1) ─────────────────────
// Loose equality is a form this parser does not handle. The point is NOT that `==` is wrong —
// it is that an UNHANDLED form must never silently shrink the population.
const looseSrc = SRC.replace(
  "const INJECT = process.env.PROTO_INJECT || '';",
  "const INJECT = process.env.PROTO_INJECT || '';\nif (INJECT == 'red_proof_loose') { /* planted */ }",
);
const c3 = verdict(looseSrc);
expect('C3 unrecognized', 'plant differs from the original source', looseSrc !== SRC);
expect('C3 unrecognized', 'RED on an unhandled declaration form', c3.red);
expect('C3 unrecognized', 'the fault NAMES the offending line', /unrecognized INJECT form at run\.mjs:\d+/.test(c3.faultText),
  c3.parsed.faults[0]);
expect('C3 unrecognized', 'GREEN again once the unhandled form is removed', !verdict(SRC).red);

console.log(line);

// ── C4 · A RECOGNIZED NEW KNOB → GREEN, and the population GROWS (R-601 §2) ────────────────
// Growth is legitimate and must NOT be a failure. This is the half a `=== 37` count would break.
const grownSrc = SRC.replace(
  "const INJECT = process.env.PROTO_INJECT || '';",
  "const INJECT = process.env.PROTO_INJECT || '';\nif (INJECT === 'red_proof_strict') { /* planted */ }",
);
const c4 = verdict(grownSrc);
expect('C4 growth', `discovers 38 (got ${c4.parsed.names.length})`, c4.parsed.names.length === 38);
expect('C4 growth', 'GREEN — a knob beyond the pin is reported, not failed', !c4.red);
expect('C4 growth', `the new knob is named as beyond-pin (${c4.beyond.join(', ') || 'none'})`,
  c4.beyond.length === 1 && c4.beyond[0] === 'red_proof_strict');

console.log(line);

// ── C5 · A NEW `case` LABEL — the form the old parser was blind to ─────────────────────────
const caseSrc = SRC.replace(
  "    case 'partition_overlap':",
  "    case 'red_proof_case': return CORPUS;\n    case 'partition_overlap':",
);
const c5 = verdict(caseSrc);
expect('C5 case form', 'plant differs from the original source', caseSrc !== SRC);
expect('C5 case form', `the fixed parser SEES it (${c5.parsed.names.length} knobs)`,
  c5.parsed.names.includes('red_proof_case'));
expect('C5 case form', 'the OLD parser was blind to it — this is F-4 in one line',
  !legacyOneFormKnobs(caseSrc).includes('red_proof_case'));
expect('C5 case form', 'GREEN — recognized growth', !c5.red);

console.log(line);

// ── C6 · A `case` label that is not a string literal → RED, not silently skipped ───────────
const nonLiteralSrc = SRC.replace(
  "    case 'partition_overlap':",
  '    case SOME_CONSTANT: return CORPUS;\n    case \'partition_overlap\':',
);
const c6 = verdict(nonLiteralSrc);
expect('C6 non-literal case', 'RED on a case label this parser cannot name', c6.red);
expect('C6 non-literal case', 'the fault says so explicitly',
  /unrecognized case label inside switch \(INJECT\)/.test(c6.faultText), c6.parsed.faults[0]);

console.log(line);

// ── C7 · TRUNCATED READ → RED, naming the knobs that vanished (R-601 §2's "whatever the cause") ──
const c7 = verdict(SRC.slice(0, Math.floor(SRC.length / 3)));
expect('C7 truncated read', 'RED on a partial file', c7.red);
expect('C7 truncated read', `names the missing pinned knobs (${c7.missing.length} of ${PINNED_KNOBS.length})`,
  c7.missing.length > 0 && /PINNED KNOB NOT DISCOVERED: '[a-z_]+'/.test(c7.faultText),
  `first three: ${c7.missing.slice(0, 3).join(', ')}`);

console.log(line);

// ── C8 · POPULATION OF ONE → RED (R-601 §3, the exact state that printed MEASUREMENT COMPLETE) ──
const oneKnobSrc = "const INJECT = process.env.PROTO_INJECT || '';\nif (INJECT === 'parse') { }\n";
const c8 = verdict(oneKnobSrc);
expect('C8 population of 1', `discovers exactly 1 (got ${c8.parsed.names.length})`, c8.parsed.names.length === 1);
expect('C8 population of 1', 'RED — this is the state the old instrument called MEASUREMENT COMPLETE', c8.red);
expect('C8 population of 1', `all 36 other pinned knobs are named as missing (${c8.missing.length})`,
  c8.missing.length === 36 && c8.faultText.includes("PINNED KNOB NOT DISCOVERED: 'twin'"));

console.log(line);

// ── C9 · THE IDENTIFIER ITSELF RENAMED → RED (a cause no form-regex could ever catch) ──────
const c9 = verdict(SRC.replaceAll('INJECT', 'INJEKT'));
expect('C9 identifier renamed', `discovers 0 (got ${c9.parsed.names.length})`, c9.parsed.names.length === 0);
expect('C9 identifier renamed', `RED, naming all ${PINNED_KNOBS.length} pinned knobs`,
  c9.red && c9.missing.length === PINNED_KNOBS.length);

console.log(line);

// ── C10 · PROCESS-LEVEL — the guard changes the fixture's EXIT CODE, not just a return value ──
// `AN ASSERT THAT CANNOT FAIL THE COMMAND IS A PRINTOUT.` Temp dir only; the campaign tree is
// never written.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'knob-redproof-'));
try {
  const good = path.join(tmp, 'run-real.mjs');
  const bad = path.join(tmp, 'run-shrunk.mjs');
  fs.writeFileSync(good, SRC);
  fs.writeFileSync(bad, oneKnobSrc);

  const spawn = (file) => {
    try {
      const out = execFileSync(process.execPath, ['evidence-order.mjs', '--check-population', file],
        { cwd: HERE, encoding: 'utf8' });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };

  const okRun = spawn(good);
  expect('C10 process exit', `exit 0 on the real population (got ${okRun.code})`, okRun.code === 0);
  expect('C10 process exit', 'and says every pinned knob was discovered',
    /every pinned knob was discovered/.test(okRun.out));

  const badRun = spawn(bad);
  expect('C10 process exit', `exit 1 on a shrunk population (got ${badRun.code})`, badRun.code === 1);
  expect('C10 process exit', 'and NAMES a missing knob in its output',
    /PINNED KNOB NOT DISCOVERED: '[a-z_]+'/.test(badRun.out),
    (badRun.out.split('\n').find((l) => l.includes('NOT DISCOVERED')) ?? '').trim());
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── C11 · FAIL-CLOSED ON ANY UNCLASSIFIABLE REFERENCE ─────────────────────────────────────
// The header claims this parser fails CLOSED. That is a mechanism claim, so it gets its own
// test rather than a sentence. Each of these mentions INJECT in a way the classifier cannot
// name; every one must RED. The last two are the negative controls — a comment and a real
// switch — without which "everything reds" would be indistinguishable from a working guard.
const closedCases = [
  ['bare call', "const INJECT='';\nfoo(INJECT);", true],
  ['switch-lookalike identifier', "const INJECT='';\nswitchMode(INJECT);", true],
  ['aliased to another variable', "const INJECT='';\nconst x = INJECT;", true],
  ['bare token inside a string', "const INJECT='';\nconst s = 'INJECT';", true],
  ['inside a comment (negative control)', "const INJECT='';\n// INJECT === 'ghost'", false],
  ['a real switch (negative control)', "const INJECT='';\nswitch (INJECT) { case 'a': break; }", false],
];
for (const [what, src, shouldRed] of closedCases) {
  const p = parseInjectionKnobs(src, 'probe.mjs');
  expect('C11 fail-closed', `${shouldRed ? 'RED' : 'green'}: ${what}`, (p.faults.length > 0) === shouldRed,
    p.faults[0]);
}
expect('C11 fail-closed', 'the fault names the file it was actually given, not a hardcoded one',
  /probe\.mjs:2/.test(parseInjectionKnobs("const INJECT='';\nfoo(INJECT);", 'probe.mjs').faults[0] ?? ''));

console.log('='.repeat(104));
if (failures) {
  console.log(`*** RED-PROOF FAILED: ${failures} expectation(s) did not hold.`);
  process.exitCode = 1;
} else {
  console.log('RED-PROOF COMPLETE: the guard passes on the real file (C1) and goes RED on an');
  console.log('unrecognized form (C3, C6) and on a shrunk population from four independent causes');
  console.log('(C2 parser regression, C7 truncation, C8 population-of-one, C9 rename) — naming the');
  console.log('lost knobs in every case, and changing the fixture\'s process exit code (C10).');
  process.exitCode = 0;
}
