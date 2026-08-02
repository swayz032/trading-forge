# External advisor ruling — AR-590 / P0 correction start

**RULING ID / TASK ID:** external AR-590 review / campaign AR-590

**Objects reviewed:** AR-590 at campaign commit `0df28dfd2973dba93da094b4790f9b098a02dbab`; prototype source at `8297ebbe062f97f07d9000a2aa22712420a70c42`; design blob `a5ca03237eb5f9fd5977315c9ed3617e08ab021c`; main-advisor rulings R-543 (`11c6ddfc`), R-544 (`eaca5324`), and R-545 (`24fb2d64`).

**DECISION:** **APPROVE the nine-item correction batch, with two mandatory amendments before its first coverage result is admissible.** AR-590 is right to split unresolved row `34(d)`, right that the strict surface currently collapses the source corpus, right not to edit a known-wrong design caption without authority, and right to keep this one-seat batch serial. But its proposed `(lane: Lane)` repair would itself create a competing `FREE_REF` on every fixture unless the admission rule first separates TypeScript type-space from runtime value-space. The main advisor should also authorize the narrow row-54 design correction now; knowingly retaining a false twin caption is not conservative.

**GRAPH OBJECT:** **NOT ADOPTED.** The external V4 graph remains a candidate under R-545. AR-590 correctly schedules nothing from it.

**GRAPH NODE TRANSITION:** none.

**GRAPH FAN-IN / READY SET:** not authoritative until the R-545 adoption audit closes. This report concerns the already-authorized `P0PC` work only.

## Claims verified

- `[MEASURED HERE, campaign tree @ 0df28dfd]` AR-590 is a genuine cold-start receipt. The prototype directory is byte-identical to AR-589's delivery, and the receipt precedes any correction code.
- `[MEASURED HERE, TypeScript 5.9.3, 39 source rows]` Under the committed prototype's proposed strict surface (`strict: true`, `types: []`, ES2022 lib), **all `39 / 39` source fixtures have semantic diagnostics and all `39 / 39` carry `TS7006`** from the untyped `lane` parameter. Several also carry independent diagnostics (`TS2304`, `TS2307`, `TS2540`, `TS1117`, and others). AR-590's warning is therefore measured fact, not a hypothetical.
- `[MEASURED HERE]` An unresolved value reference has `TS2304`; an ambient-declared value reference type-checks. The worker's split is sound: the unresolved specimen can remain only as `miss_type_invalid`, while the ambient-declared value-position specimen can exercise `FREE_REF` as a type-valid mutation.
- `[MEASURED HERE, source-admission.mjs executable path]` The proposed named type introduces a new false catcher. Current `admitSource()` visits every `Identifier` without excluding type positions. `project = (lane: Lane) => ...` returns `1b-S:free-captured-reference` for `Lane`. With a virtual committed declaration, the compiler reports zero semantic diagnostics, but `Lane` resolves to `surface.d.ts`, so the current rule still classifies it as external to the source module.
- `[MEASURED HERE]` An inline structural parameter type is admitted by the current walker. That is a narrow emergency scaffold, not the architectural fix: an admission rule about runtime capture must ignore every erased type-space identifier by construction, not allowlist the spelling `Lane`.
- `[MEASURED HERE, real TypeScript emit plus Node loaders]` A genuine row-54 twin is constructible from one TS source. The same source was emitted once as CommonJS and once as ESNext. Before injection the CJS `project()` returned `LANE`; after setting the wrapper export's injected reader it returned `INJECTED`. The ESM artifact returned `LANE` because top-level `this` was unavailable. Both emitted programs retained the same source-level `this` expression. This proves the design can use a same-source differential without deleting the channel or making the ESM arm crash.

## Independent evidence

### 1. The strict compiler surface is correct; the fixture scaffolding is incomplete

The result was:

```text
source rows       39
semantic-valid     0
semantic-invalid  39
rows with TS7006  39
```

Do not weaken `strict` or set `noImplicitAny: false` to preserve the old number. Supply type-erased fixture scaffolding and then re-run. For every mechanical type-only edit, compare the emitted JavaScript before and after; it must be byte-identical after normalising only the expected module wrapper. That is the discriminator between “made the fixture type-valid” and “changed the planted behaviour.” Any row with a remaining semantic diagnostic is owned by the validity gate and is not coverage for its named admission catcher.

### 2. AR-590's proposed `Lane` spelling crosses a boundary its plan did not name

The current walker reaches this identifier sequence in a type-valid fixture:

```text
project       declaration in fixture.ts
lane          declaration in fixture.ts
Lane          TypeReference; declaration in surface.d.ts
injectedReader CallExpression; declaration in surface.d.ts
lane          value reference; declaration in fixture.ts
```

The intended `FREE_REF` witness is `injectedReader` in **value position**. `Lane` is erased type-space and must be invisible to the runtime-reference policy. If both are classified alike, every typed fixture acquires the same competing catcher and exclusive ownership becomes impossible.

This must be fixed as a property:

1. the same external identifier used only in type-space is silent;
2. the identifier used in value-space is caught;
3. a clean typed fixture is admitted;
4. an unresolved value identifier is `miss_type_invalid`, not coverage;
5. no spelling-specific `Lane` allowlist is accepted.

### 3. Row 54 needs a safe same-source differential, not the current direct assignment

The design's present example is `this.inject = ...`. In ESM, executing that exact statement throws because top-level `this` is `undefined`; calling that arm GREEN would be false. The correct source shape reads the wrapper conditionally and never dereferences it when absent, for example:

```ts
type Wrapper = { injected?: (lane: Lane) => string };
const wrapper = this as Wrapper | undefined;
export const project = (lane: Lane) => ({
  v: wrapper?.injected ? wrapper.injected(lane) : lane.v,
});
```

Compile this **same source text** under the pinned CommonJS and ESNext tuples. The CJS loader exposes the wrapper object and permits the planted injection; the ESM loader sees `undefined` and follows the lane-owned path. The module-system catcher owns the CJS rejection; token/ambient/free-reference catchers remain silent on the module distinction. The emitted artifacts and loader commands are part of the receipt.

AR-590 is correct that its existing scope does not authorize correcting the design table. The remedy is not to retain a known false caption: the main advisor should authorize the one row-54 caption/example correction in the same ruling that consumes this review, with the prior text preserved in a dated correction note.

## Tests rerun

1. Recomputed semantic diagnostics for all 39 current source fixtures with `strict: true`, `types: []`, ES2022 lib: `0` valid, `39` invalid, `39` with `TS7006`.
2. Type-valid split probe: unresolved value reference emitted `TS2304`; ambient-declared value reference emitted no semantic diagnostics.
3. Direct `admitSource()` probes: named ambient type produced a `FREE_REF`; inline structural type stayed clean.
4. AST/symbol probe against `fixture.ts + surface.d.ts`: `Lane` and `injectedReader` both resolve outside the source file, proving the current value-reference rule cannot distinguish them.
5. Same-source TypeScript emit to CommonJS and ESNext, executed through their actual Node semantics: CJS `LANE → INJECTED`; ESM remained `LANE`.

## Required corrections

1. **Add type-space/value-space separation before adding the named `Lane` scaffold.** Type-only nodes, type arguments, type aliases/interfaces, `as`/`satisfies` type operands, and type-only imports/exports are erased and cannot be runtime capture evidence. Red-proof with the same spelling in type and value positions.
2. **Keep the row-34(d) split, but label the populations separately.** The unresolved original is a historical rule-bug witness and `miss_type_invalid`; it is not in attributed coverage. The ambient-declared value reference is the type-valid `FREE_REF` coverage row. Never combine them into one numerator.
3. **Freeze fixture edits by emitted behavior.** Mechanical annotations/declarations may change TS bytes only when the emitted runtime JS remains equivalent. Publish source hashes, emitted hashes, and every row that remains invalid after the scaffold.
4. **Authorize and correct the design's row-54 twin.** Use the safe conditional-wrapper same-source differential above or an equivalent execution-proven form. Do not leave the known-false `this.inject = ...` ESM-green caption as normative design text.
5. Continue R-543/R-544 items 2–9 unchanged, including exclusive diagnostic ownership, required callable `project`, actual extension/module inputs, complete collection before terminal non-zero, and per-invariant red paths.

## Acceptance commands

- Assert semantic diagnostics over every source row, reporting exact diagnostic codes and populations before any catcher credit.
- Plant one external symbol in type-only and value-only positions; require silence then exclusive `FREE_REF`, respectively.
- Assert the typed clean control remains admitted and the unresolved value specimen becomes `miss_type_invalid`.
- Compare emitted JS for every type-scaffolding edit; any unintended runtime delta stops the run.
- Compile one source to CommonJS and ESNext, run both with their real loaders, and prove `LANE → INJECTED` only in CJS while the ESM arm executes cleanly.
- Re-run the full nine-item battery, publish the corrected denominator classes, and exercise each terminal runner failure with non-zero plus a zero clean control.

## Stop condition

Stop if `Lane` or any erased type identifier is reported as a runtime free reference; if strictness is weakened to rescue coverage; if a type-invalid row is credited to an admission catcher; if fixture scaffolding changes emitted behavior without a separately pre-registered mutation; if the ESM twin throws and is still called GREEN; or if the design retains a known-false normative row after the desk has authority to correct it.

## Authorized next action

The worker may continue the nine-item batch immediately with the two amendments above. The main advisor should authorize the narrow design-row correction and preserve the independent grade trigger against the corrected result. No gate, claims, registry, runtime, DB, extraction, backtest, Gate B, merge, deploy, or capital action is authorized.

## Lesson to persist

**A TypeScript identifier has two worlds. A runtime-capture rule that scans type-space manufactures dependencies that are erased before execution. Pin the compiler surface, preserve emitted behavior, and test module identity on the same source through the real emit-and-loader pair.**

**Newest AR checked before write:** AR-590 at `0df28dfd` is the newest report on disk and directly bears on this ruling.
