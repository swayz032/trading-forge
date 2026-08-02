// 🛑★★★★★ R-568 item (5) / AR-607 — THE SET OF SETS, EXTENDED BEYOND `corpus.mjs`.
//
// THE DEFECT THIS CLOSES, MEASURED BY EXECUTION BEFORE A LINE OF THIS FILE WAS WRITTEN:
//
//   red-proof.mjs   delete ONE `EXPECT` row  ->  "38 / 38" becomes "37 / 37",
//                   "VERDICT: the runner is an ENFORCING GATE", EXIT 0.
//                   The retired class leaves NO trace: grep of the output returns 0 hits.
//   run.mjs         delete the `collection_shape` entry from `FAILURE_CLASSES` (5 lines) ->
//                   the SAME `new_unpinned_collection` injection that reddens the shipped
//                   gate (EXIT 1) now reports "GATE: PASS", EXIT 0.
//
// Both are the SAME defect R-561 named for the GREEN population:
//   BOTH OPERANDS COMPUTED FROM THE SAME MUTABLE ARRAY.
//     red-proof.mjs:178  `${rows.filter((r) => r.ok).length} / ${rows.length}`
//     run.mjs:606        `FAILURE_CLASSES.filter(([, hit]) => hit)`
// A count of surviving members cannot speak about members that were removed.
//
// ⚠️★★★★★ AND THEY COMPOSE. Deleting the `collection_shape` FAILURE_CLASS retires the
// set-of-sets check; deleting red-proof's `new_unpinned_collection` row retires the PROOF
// that it worked. TWO EDITS, both silent, and the R-562 class fix is gone with both gates
// green. That is verbatim the COORDINATED DELETION shape R-558 closed for corpus rows —
// closed there, and left open on the files that do the enforcing.
//
// THE MECHANISM IS THE ONE ITEM 15 / R-558 ALREADY PROVED, APPLIED TO A NEW SURFACE:
// the expected membership is read from a PINNED PRIOR ARTIFACT via `git show`, never from
// the delivery under test. A later commit cannot edit a frozen one, so legitimate growth
// must BUMP THE PIN — a deliberate, reviewable act in git history rather than an array edit
// that reviews itself.
//
// ⚠️ WHY THIS PARSES INSTEAD OF EXECUTING, AND THE LIMIT THAT CREATES.
// `membership.mjs` reads the pinned corpus by IMPORTING it, which is strictly better — a
// grep over source "returns what you remembered to look for". That is NOT available here:
//   - `red-proof.mjs` exports NOTHING; `EXPECT`/`CLASSES`/`SHARED`/`FREEZE_EXPECT` are
//     module-local `const`s, invisible to `Object.keys(namespace)`. This is precisely why
//     the existing `collectionNamesOf` cannot reach them.
//   - importing `run.mjs` or `red-proof.mjs` EXECUTES a full gate run (top-level side
//     effects, `process.exitCode`, and in red-proof's case ~38 subprocess invocations).
// So the pinned text is parsed with the TypeScript parser this prototype already depends on
// — a real AST, not a regex. ⚠️ THE HONEST LIMIT: this reads DECLARATIONS, so a table built
// at runtime (`push`, spread, computed keys) is outside what it can see. It is checked
// against the runtime path on the one module where BOTH work — see `assertParserAgreesWithRuntime`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = 'prototypes/p0-vnext-admission';

// 🛑 PIN THE PIN (R-564 item 1). `EXPANDED_PIN_COMMIT` was once a bare string with nothing
// asserting its value, and a one-line bump silently shrank the expected corpus 64 -> 59.
// The blob of every pinned file is asserted below, so moving this constant cannot be quiet.
// PIN BUMP 2026-08-02 (R-578 batch, commit 2 of 2): cac39d45 -> 1a1abb46.
// Required because red-proof.mjs gained a module-level `DECLARED_ROW_KEYS` (the F-1b identity
// denominator), which the set-of-sets guard correctly reported as NEW UNPINNED. It CANNOT be
// added to PINNED_MODULE_COLLECTIONS: `[MEASURED]` extractModuleCollections returns keys: null
// for it, and a pin on a table the reader cannot see THROWS INSTRUMENT FAULT (AR-613's trap).
// So the guard's OTHER sanctioned remedy — bump the pin — is the one taken.
//
// ⚠️ DECLARED, NOT SLIPPED IN: this bump also moves the pinned text of `membership.mjs`, which
// this batch did NOT edit — its blob changed in commits between cac39d45 and here. `[MEASURED]`
// its CHECKED surface is unchanged across the bump: HISTORICAL_RENAMES keys ["54"] -> ["54"] and
// the module-level collection set {HISTORICAL_RENAMES, BASELINE_META, EXPANDED_META} identical.
// So no enforcement table is silently re-baselined by this bump. Verified before bumping, not after.
export const MODULE_PIN_COMMIT = '3978c1c5';

/**
 * THE ENFORCEMENT TABLES. Each of these is a module-level collection whose SHRINKAGE
 * silently retires a check — which is the measured defect, not a hypothetical one.
 * The `blob` is asserted so the pin cannot be moved without editing a value in plain sight.
 */
export const PINNED_MODULE_COLLECTIONS = Object.freeze({
  // 🛑★★★★★ R-572 §4 — THE THREE COLLECTIONS `AR-609 §4` CORRECTLY REFUSED TO PIN ALONE.
  // It declined because `R-570 §5` STOPS on touching attribution logic and these three sit inside
  // it. The desk ruled: `A PIN IS NOT AN ALTERATION — IT ASSERTS THAT IT DID NOT CHANGE`, and the
  // STOP protecting `44/52` is an argument FOR pinning the collections `44/52` rests on.
  //   SIX                    the six-population partition itself. Deleting a key does not make a
  //                          population disappear — it makes it UNCOUNTED, and `partitionSum` and
  //                          `unpartitioned` are both computed from `Object.values(SIX)`, so the
  //                          check and its witness would shrink together.
  //   SURFACE_CODES          removing a code silently promotes an UNCONFIGURED-instrument row into
  //                          a real verdict — the failure direction `run.mjs:84` exists to prevent.
  //   FIXTURE_INVALID_CODES  removing a code silently promotes an AUTHORING DEFECT into a verdict.
  'run.mjs': Object.freeze({ tables: Object.freeze(['FAILURE_CLASSES', 'SIX', 'SURFACE_CODES', 'FIXTURE_INVALID_CODES', 'KNOWN_UNCAUGHT']) }),
  //   PINNED_EFFECT_DIGESTS  the effect-addressed identity expectation (R-585 §6.2 / R-587 §3).
  //                          Dropping an entry would retire the ONLY check that can see two
  //                          declared red paths collapse onto one mutation, so it is pinned here
  //                          AND carries its own declared cardinality at its definition site.
  'red-proof.mjs': Object.freeze({ tables: Object.freeze(['CLASSES', 'SHARED', 'EXPECT', 'FREEZE_EXPECT', 'PINNED_EFFECT_DIGESTS']) }),
  // 🛑★★★★★ ADDED BY THE R-570 §6.3 ENUMERATION, WHICH FOUND **INSTANCE EIGHT** BY MEASUREMENT.
  // `type-value-proof.mjs` reports `${pass} / ${CASES.length}` at :126 and gates on
  // `pass === CASES.length` at :125 — BOTH OPERANDS FROM THE SAME MUTABLE ARRAY, the third file
  // with this exact shape. `[MEASURED HERE, AST-spliced, restored hash-identical]` removing the
  // `T3` coverage case ("type ARGUMENT") gave `14 / 14 cases pass | property HOLDS`, EXIT 0:
  // a coverage case vanished and the gate still CERTIFIED THE PROPERTY.
  // ⚠️ `D`/`E` are individually named by `propertyHolds`, so they are protected; the other 13 are
  // not. A partial protection is why this needed executing rather than reading — my first attempt
  // deleted `D`, went red for the WRONG reason, and would have "confirmed" the defect falsely.
  'type-value-proof.mjs': Object.freeze({ tables: Object.freeze(['CASES']) }),
  // ★★★★★ AND THESE TWO ARE THE RULE SETS THEMSELVES — the catchers every verdict in this
  // prototype is produced by. Nothing pinned them. Deleting a catcher removes a DETECTION RULE,
  // and every population that rule feeds simply gets smaller.
  // ✅ GRADE F-5 / R-575 §6.4: `SCRIPT_KIND_BY_EXT` is the THIRD rule set and it was unpinned.
  // It decides, per container extension, WHICH SCRIPT KIND a fixture is compiled as — and
  // `admitSource` returns `PARSE_ERROR` for an extension absent from it. Dropping an entry would
  // not loosen a verdict; it would make a whole container silently UNJUDGEABLE, and a corpus row
  // that cannot yield a verdict is a row that certifies nothing.
  'source-admission.mjs': Object.freeze({ tables: Object.freeze(['CATCHERS', 'SCRIPT_KIND_BY_EXT']) }),
  'runtime-admission.mjs': Object.freeze({ tables: Object.freeze(['CATCHERS']) }),
  // ✅ R-570 §4: with `EXEMPT_EXPORTS` deleted as a decoration, `HISTORICAL_RENAMES` is
  // `membership.mjs`'s one remaining module-level table AND IT IS CONSUMED — it maps the pinned
  // baseline's ids at `:95`, `:98` and `:101`. Dropping its single entry would silently un-map
  // AR-589's row `54` -> `54(c)` and the expected-membership set would quietly change shape.
  // ★★★ The worker was right that pinning a DORMANT table is pinning a decoration; this one is live.
  'membership.mjs': Object.freeze({ tables: Object.freeze(['HISTORICAL_RENAMES']) }),
});

/** Asserted blobs for the pinned revision of each covered file (pin-the-pin). */
export const PINNED_BLOBS = Object.freeze({
  'run.mjs': 'af540a0259c8c5d6c7d989fe6c160819f170fa6b',
  'red-proof.mjs': '6410d61938a9648641f02c545c7a27760a1d4716',
  'type-value-proof.mjs': '468ac763164e152a476ec88139cc76c76286ce99',
  'source-admission.mjs': 'a36d2c500deaf0ddcf3b699f56301c6f8fd65ccf',
  'runtime-admission.mjs': '6e7a3f5148181a8e02efaf28e3fa5797ab79dc53',
  'membership.mjs': '10ccce6e5b6efd8f78a798c21699bcf805d82ba6',
});

// ⚠️★★★★★ THE RESIDUAL, NAMED RATHER THAN PAPERED OVER — THIS FILE CANNOT PIN ITSELF.
// `PINNED_MODULE_COLLECTIONS` and `PINNED_BLOBS` are themselves self-certifying collections:
// deleting an entry removes coverage of that file, and this check would not notice. Adding
// this module to its OWN pinned set does not close it — the pin values live in the file being
// pinned, so every legitimate bump would break its own pin. THE REGRESS IS STRUCTURAL, not an
// oversight, and it is the same one `membership.mjs` reaches: at some point a constant must be
// editable or nothing can ever legitimately change.
// WHAT IS DONE INSTEAD IS WHAT R-564 ACCEPTED FOR THE CORPUS PIN — make a silent shrink require
// editing a value that STATES ITS OWN MAGNITUDE IN PLAIN SIGHT, so the edit is loud in review:
// 🛑★★★★★ INSTANCE TEN (SECOND INDEPENDENT GRADE, 2026-08-02) — AND IT WAS IN THIS FILE, WHICH
// WAS SHIPPED LAST BATCH (F-4) TO MAKE THIS EXACT CLASS VISIBLE.
//   THE FILE SHIPPED TO CLOSE A CLASS IS THE FIRST PLACE TO LOOK FOR THE NEXT INSTANCE OF IT.
//
// THE DEFECT: `COVERED_FILES` was a declared array — so FILES stated their own magnitude and a
// deleted file was loud. TABLES did not: the guard below rejected only `tables.length === 0`, and
// the printed `tableCount` was a `reduce` OVER THE CONSUMPTION. So dropping THREE of run.mjs's
// FOUR tables left `1 !== 0`, passed every check, and printed a smaller number under
// `0 findings | PASS | EXIT 0`.  THE PIN FREEZES THE DECLARATION; THE COUNT READS THE CONSUMPTION.
//
// ✅ THE FIX IS THE ONE THE SIBLING ALREADY MODELS: each file DECLARES how many enforcement
// tables it covers, in plain sight, so a silent shrink must edit a number that states its own
// magnitude. R-578 §5 forbids the near-miss of pinning the reduce's OUTPUT — that value is BUILT.
const COVERED_FILES = Object.freeze({
  'run.mjs': 5,
  'red-proof.mjs': 5,
  'type-value-proof.mjs': 1,
  'source-admission.mjs': 2,
  'runtime-admission.mjs': 1,
  'membership.mjs': 1,
});
// The TOTAL is declared as a literal too, and cross-checked against the sum of the per-file
// literals. Two independent derivations of one magnitude: a shrinker must edit BOTH, and if they
// ever disagree the instrument says so instead of choosing one.
const DECLARED_TABLE_TOTAL = 15;
const summedFromFiles = Object.values(COVERED_FILES).reduce((a, n) => a + n, 0);
if (summedFromFiles !== DECLARED_TABLE_TOTAL) {
  throw new Error(`INSTRUMENT FAULT: declared table magnitudes disagree — per-file literals sum to ${summedFromFiles}, DECLARED_TABLE_TOTAL says ${DECLARED_TABLE_TOTAL}`);
}
for (const [f, expectedTables] of Object.entries(COVERED_FILES)) {
  if (!PINNED_MODULE_COLLECTIONS[f]) {
    throw new Error(`INSTRUMENT FAULT: coverage for ${f} was removed from PINNED_MODULE_COLLECTIONS — the set-of-sets no longer covers a file it is declared to cover`);
  }
  // MEMBERSHIP, NOT A FLOOR: the old `=== 0` test admitted every partial deletion above zero.
  const actual = PINNED_MODULE_COLLECTIONS[f].tables.length;
  if (actual !== expectedTables) {
    throw new Error(`INSTRUMENT FAULT: ${f} is declared to cover ${expectedTables} enforcement table(s) but PINNED_MODULE_COLLECTIONS lists ${actual} (${PINNED_MODULE_COLLECTIONS[f].tables.join(', ') || 'none'}) — a table was added or silently dropped`);
  }
  if (!PINNED_BLOBS[f]) {
    throw new Error(`INSTRUMENT FAULT: no pinned blob declared for ${f} — the pin cannot be verified and any verdict from it is uninterpretable`);
  }
}
// The reverse direction — a pinned file nobody declared coverage for would otherwise be invisible
// to every magnitude above. Same both-directions membership lesson as F-1b.
for (const f of Object.keys(PINNED_MODULE_COLLECTIONS)) {
  if (!(f in COVERED_FILES)) {
    throw new Error(`INSTRUMENT FAULT: ${f} is pinned in PINNED_MODULE_COLLECTIONS but declares no coverage magnitude in COVERED_FILES — its tables are counted by nothing`);
  }
}

export function loadPinnedText(commit, file) {
  const raw = execFileSync('git', ['show', `${commit}:${REPO_DIR}/${file}`], { cwd: HERE, encoding: 'utf8' });
  const blob = execFileSync('git', ['rev-parse', `${commit}:${REPO_DIR}/${file}`], { cwd: HERE, encoding: 'utf8' }).trim();
  return { raw, blob };
}

/**
 * Enumerate MODULE-LEVEL collection declarations from source text, by AST.
 * A "collection" here is an array-literal initializer, optionally wrapped in `Object.freeze`.
 * For each, the element KEYS are the leading string literal of every tuple element — the
 * stable identity of a row, exactly as a corpus row's `id` is.
 * @returns {Map<string, {exported: boolean, keys: string[]|null, length: number}>}
 */
export function extractModuleCollections(text, fileName = 'x.mjs') {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out = new Map();
  const unwrap = (n) => (ts.isCallExpression(n)
    && ts.isPropertyAccessExpression(n.expression)
    && n.expression.name.text === 'freeze'
    && n.arguments.length === 1)
    ? n.arguments[0] : n;
  // Only MODULE-LEVEL statements: a table declared inside a function is not a self-certifying
  // population a gate consumes across runs, and widening to every nested array would produce
  // noise that trains its reader to ignore the check.
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const exported = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    for (const d of stmt.declarationList.declarations) {
      if (!d.initializer || !ts.isIdentifier(d.name)) continue;
      const init = unwrap(d.initializer);
      // ⚠️ OBJECT LITERALS ARE COLLECTIONS TOO, AND LEAVING THEM OUT WAS A REAL BLIND SPOT.
      // The first draft of this function accepted only array literals. The two-path check
      // below caught it immediately: the runtime reader saw `PREREGISTERED_EMIT_CHANGES`
      // (a plain object, which `isCollection` admits) and this parser did not. That is the
      // cross-check earning its place — a parser-only verdict would have shipped blind to
      // every keyed table in the delivery.
      if (ts.isArrayLiteralExpression(init)) {
        const keys = init.elements.map((el) => {
          const e = unwrap(el);
          // Tuple rows: the leading string literal is the row's identity (FAILURE_CLASSES, EXPECT…).
          if (ts.isArrayLiteralExpression(e) && e.elements.length > 0) {
            const first = e.elements[0];
            return ts.isStringLiteral(first) ? first.text : null;
          }
          // ⚠️ OBJECT ROWS KEYED BY `id` — added after the R-570 §6.3 enumeration MEASURED that the
          // tuple-only reader returned `keys: null` for `type-value-proof.mjs::CASES` and both
          // `CATCHERS` sets, i.e. the three tables it most needed to certify. A reader that cannot
          // see a population cannot certify it, and returning `null` would have looked like coverage.
          if (ts.isObjectLiteralExpression(e)) {
            const idProp = e.properties.find((p) => p.name
              && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
              && p.name.text === 'id');
            return idProp && idProp.initializer && ts.isStringLiteral(idProp.initializer)
              ? idProp.initializer.text : null;
          }
          // ⚠️★★★★★ BARE STRING ELEMENTS — ADDED FOR R-572 §4, AND THE ORDER OF DISCOVERY MATTERS.
          // R-572 §4 ordered `SURFACE_CODES` and `FIXTURE_INVALID_CODES` PINNED. `[MEASURED FIRST,
          // BEFORE THE PIN]` both came back `keys: null`, because a plain `['TS7006', …]` array has
          // no tuple and no `id` property, so every element mapped to `null`. Pinning them in that
          // state would NOT have protected them — `checkPinnedCollections` THROWS `INSTRUMENT FAULT`
          // on a pinned table with no extractable keys, so the order would have taken the gate down.
          //   A PIN ON A TABLE THE READER CANNOT SEE IS NOT WEAK PROTECTION — IT IS AN OUTAGE.
          // A bare string element IS its own identity, exactly as a tuple's leading string is.
          // ✅ VERDICT-NEUTRAL FOR EVERY ALREADY-PINNED TABLE, AND PROVEN BY BYTE-COMPARISON RATHER
          // THAN BY THE ARGUMENT: a table that HAS keys today contains no `StringLiteral` element
          // (one would have forced the whole table to `null`), so this branch cannot fire on it.
          if (ts.isStringLiteral(e)) return e.text;
          return null;
        });
        out.set(d.name.text, {
          exported,
          keys: keys.every((k) => k !== null) && keys.length > 0 ? keys : null,
          length: init.elements.length,
        });
      } else if (ts.isObjectLiteralExpression(init)) {
        const keys = init.properties.map((p) => {
          if (!p.name) return null;
          if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)) return p.name.text;
          return null; // computed key — outside what a declaration reader can certify
        });
        out.set(d.name.text, {
          exported,
          keys: keys.every((k) => k !== null) && keys.length > 0 ? keys : null,
          length: init.properties.length,
        });
      }
    }
  }
  return out;
}

// ---- THE PARSER IS CHECKED AGAINST THE RUNTIME PATH, NOT TRUSTED ------------------------
// ⚠️ A static reader and a runtime reader can disagree, and a disagreement nobody looks for
// is exactly how a "verified" instrument ships blind. `corpus.mjs` is the ONE module where
// both paths work — it is importable AND parseable — so the parser's EXPORTED-collection
// verdict is compared against `membership.mjs`'s executed `collectionNamesOf` there.
// A mismatch is an INSTRUMENT FAULT and nothing computed from this file means anything.
export function assertParserAgreesWithRuntime(pinnedCorpusText, runtimeCollectionNames) {
  const parsed = extractModuleCollections(pinnedCorpusText, 'corpus.mjs');
  const staticNames = [...parsed.entries()].filter(([, v]) => v.exported).map(([k]) => k).sort();
  const runtimeNames = [...runtimeCollectionNames].sort();
  const missing = runtimeNames.filter((n) => !staticNames.includes(n));
  const extra = staticNames.filter((n) => !runtimeNames.includes(n));
  if (missing.length || extra.length) {
    throw new Error(
      'INSTRUMENT FAULT: the static collection parser disagrees with the executed runtime reader '
      + `on corpus.mjs — runtime-only: [${missing.join(', ')}], parser-only: [${extra.join(', ')}]. `
      + 'Two paths must agree before either is used as evidence.',
    );
  }
  return { staticNames, runtimeNames };
}

/**
 * Compare the LIVE files against the pinned revision: the set of enforcement tables
 * (THE SET OF SETS) and the membership of each (both directions + uniqueness).
 *
 * ⚠️ DECLARED SUBSTITUTION (review-time data paths are instrument surfaces): the `simulate*`
 * options exist ONLY so red-proof.mjs can drive this check without editing a shipped file.
 * They perturb the LIVE-side reading in memory, exactly as run.mjs's existing injections do
 * for `TWIN_PAIRS` and `collectionNames`. They are inert unless a caller passes them.
 */
export function checkPinnedCollections({ simulateDelete = null, simulateAdd = null } = {}) {
  const findings = [];
  for (const [file, spec] of Object.entries(PINNED_MODULE_COLLECTIONS)) {
    const { raw: pinnedText, blob } = loadPinnedText(MODULE_PIN_COMMIT, file);
    if (PINNED_BLOBS[file] && !PINNED_BLOBS[file].startsWith('PLACEHOLDER') && blob !== PINNED_BLOBS[file]) {
      throw new Error(
        `INSTRUMENT FAULT: pinned ${file} at ${MODULE_PIN_COMMIT} resolves to blob ${blob}, `
        + `expected ${PINNED_BLOBS[file]} — the pin moved`,
      );
    }
    const liveText = fs.readFileSync(path.join(HERE, file), 'utf8');
    const pinned = extractModuleCollections(pinnedText, file);
    const live = extractModuleCollections(liveText, file);

    // THE SET OF SETS: a table that VANISHED, and a NEW module-level collection nobody pinned.
    for (const t of spec.tables) {
      if (!live.has(t)) findings.push(`${file}: enforcement table ${t} REMOVED (expected by ${MODULE_PIN_COMMIT})`);
    }
    const pinnedNames = [...pinned.keys()];
    for (const name of live.keys()) {
      if (!pinnedNames.includes(name)) {
        findings.push(`${file}: NEW UNPINNED module-level collection '${name}' — pin it or bump ${MODULE_PIN_COMMIT} (R-568 item 5)`);
      }
    }
    if (simulateAdd?.file === file) {
      findings.push(`${file}: NEW UNPINNED module-level collection '${simulateAdd.collection}' — pin it or bump ${MODULE_PIN_COMMIT} (R-568 item 5)`);
    }

    // MEMBERSHIP of each enforcement table: both directions plus uniqueness, against the pin.
    for (const t of spec.tables) {
      const p = pinned.get(t);
      const l = live.get(t);
      if (!p) throw new Error(`INSTRUMENT FAULT: pinned ${file}@${MODULE_PIN_COMMIT} has no table ${t} — the pin does not describe this delivery`);
      if (!p.keys) throw new Error(`INSTRUMENT FAULT: pinned ${file}@${MODULE_PIN_COMMIT} table ${t} has no extractable row keys — the parser cannot certify it`);
      if (!l) continue; // already reported as REMOVED above
      if (!l.keys) { findings.push(`${file}: table ${t} rows are no longer key-extractable — the check cannot see its members`); continue; }
      let liveKeys = l.keys;
      if (simulateDelete?.file === file && simulateDelete.collection === t) {
        liveKeys = liveKeys.filter((k) => k !== simulateDelete.key);
      }
      const missing = p.keys.filter((k) => !liveKeys.includes(k));
      const undeclared = liveKeys.filter((k) => !p.keys.includes(k));
      const dupes = [...new Set(liveKeys.filter((k, i) => liveKeys.indexOf(k) !== i))];
      if (missing.length) findings.push(`${file}: ${t} MISSING row(s) (expected by ${MODULE_PIN_COMMIT}): ${missing.join(', ')}`);
      if (undeclared.length) findings.push(`${file}: ${t} UNDECLARED row(s) — legitimate growth must bump the pin: ${undeclared.join(', ')}`);
      if (dupes.length) findings.push(`${file}: ${t} DUPLICATE row(s): ${dupes.join(', ')}`);
    }
  }
  return findings;
}

// 🛑★★★★★ GRADE F-4 / R-575 §1 + §6.4 — A REAL MAIN ENTRY, BECAUSE THE CAPTION WAS FALSE.
// `node module-collections.mjs` printed ZERO BYTES and exited `0`. It was a LIBRARY, and the
// desk counted that costless exit code as a SIXTH PASSING GATE in `R-574 §1` — and I published
// the same six-row table in `AR-613 §1`. The COVERAGE was always real (`run.mjs:51` calls
// `checkPinnedCollections` and gates on it); what was false was the CAPTION.
//   A GREEN THAT COSTS NOTHING TO PRODUCE IS THE ONE TO CHECK FIRST.
// ⚠️ R-575 §6.4 allowed EITHER deleting the claim OR making it true. Making it true is strictly
// better: deleting the word leaves the file exactly as unable to fail as it was, and the next
// reader has no way to tell a library from a gate except by remembering this ruling.
// The direct-run guard is required because `run.mjs` and `red-proof.mjs` IMPORT this module —
// a bare top-level check would fire inside every gate run and change their exit codes.
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const findings = checkPinnedCollections();
  for (const f of findings) console.log(`*** module_collections: ${f}`);
  // ⚠️ THE PRINTED MAGNITUDE IS THE DECLARED ONE, NEVER A `reduce` OVER THE CONSUMPTION — that
  // reduce is what let three dropped tables print a smaller number under PASS. The consumption is
  // already asserted EQUAL to the declaration at module load, so if these could disagree the
  // process would have thrown before reaching this line.
  console.log(`MODULE COLLECTIONS — pin ${MODULE_PIN_COMMIT} | ${Object.keys(COVERED_FILES).length} files | ${DECLARED_TABLE_TOTAL} pinned tables (DECLARED) | ${findings.length} finding(s)`);
  console.log(findings.length
    ? 'VERDICT: FAIL — a pinned enforcement table disagrees with the pinned artifact.'
    : 'VERDICT: PASS — every pinned enforcement table matches the pinned artifact.');
  process.exitCode = findings.length ? 1 : 0;
}
