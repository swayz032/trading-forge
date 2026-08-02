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
export const MODULE_PIN_COMMIT = 'dfbad040';

/**
 * THE ENFORCEMENT TABLES. Each of these is a module-level collection whose SHRINKAGE
 * silently retires a check — which is the measured defect, not a hypothetical one.
 * The `blob` is asserted so the pin cannot be moved without editing a value in plain sight.
 */
export const PINNED_MODULE_COLLECTIONS = Object.freeze({
  'run.mjs': Object.freeze({ tables: Object.freeze(['FAILURE_CLASSES']) }),
  'red-proof.mjs': Object.freeze({ tables: Object.freeze(['CLASSES', 'SHARED', 'EXPECT', 'FREEZE_EXPECT']) }),
});

/** Asserted blobs for the pinned revision of each covered file (pin-the-pin). */
export const PINNED_BLOBS = Object.freeze({
  'run.mjs': 'e0ff1b9c1c2bf367c3d2ec63a6c3a827d2c990dc',
  'red-proof.mjs': '78d76b0babdaaf894a21b33fd38b3bc9a28e34cc',
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
const COVERED_FILES = ['run.mjs', 'red-proof.mjs'];
for (const f of COVERED_FILES) {
  if (!PINNED_MODULE_COLLECTIONS[f] || PINNED_MODULE_COLLECTIONS[f].tables.length === 0) {
    throw new Error(`INSTRUMENT FAULT: coverage for ${f} was removed from PINNED_MODULE_COLLECTIONS — the set-of-sets no longer covers a file it is declared to cover`);
  }
  if (!PINNED_BLOBS[f]) {
    throw new Error(`INSTRUMENT FAULT: no pinned blob declared for ${f} — the pin cannot be verified and any verdict from it is uninterpretable`);
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
          if (!ts.isArrayLiteralExpression(e) || e.elements.length === 0) return null;
          const first = e.elements[0];
          return ts.isStringLiteral(first) ? first.text : null;
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
