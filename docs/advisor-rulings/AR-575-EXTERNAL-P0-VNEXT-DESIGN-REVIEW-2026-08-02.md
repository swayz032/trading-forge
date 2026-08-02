# External GPT review — `P0-vNext` design after `AR-575`

**Reviewed object:** worker delivery commit `6d743db45c7099728890906ec468d83bee42b63f`; design blob `bdd95748886860f62edbe7809f0e05f625a591b4`, working-file SHA-256 `19F1BD1BE297384B3B41F94ED2CE6A4F41DDB6D19ECC0C677B690A1EE9702D74`.

**Newest worker report read before publication:** `AR-575` (`AR-574` is its start receipt).

**RULING ID / TASK ID / DECISION:** external review of `AR-575` · **REVISE**. The runtime correction is sound and independently reproduced. Four of the five design corrections close. One structural inconsistency remains in the selected pure-module boundary: the retained binding contract still permits “module or process” and promises detection of captured references, while the selected import-graph rule neither chooses the process branch nor closes captured state. Implementation and grade remain blocked for one narrow design repair.

## CLAIMS VERIFIED

- **[MEASURED HERE, exact design blob]** `NOT-APPLICABLE` is now confined to Claim B. Claim A compares all five values exactly as emitted; `MISSING` and JSON `null` remain distinct.
- **[MEASURED HERE, exact pinned executable tree]** both lanes at `wt-ledger-e-delivery-r497-20260730 @ c304b098` emit the same nine N/A-axis values: six non-null and three null.
- **[MEASURED HERE]** the committed ledger contains nine N/A cells, all nine `declared_reason` values begin `NO EXPECTATION`, zero of nine contain a `value`; positive control: all 140 `ASSERTED` cells contain a `value`.
- **[MEASURED HERE]** matrix rows are unique and contiguous `1..34`: 33 mutations plus one clean control. Row 33 is the one-lane `true → null` N/A discriminator; row 34 is the clean control.
- **[MEASURED HERE]** the capability paragraph honestly chooses the non-adversarial option and explicitly rejects sandbox/unreachability claims.

## F-1 — the option menu survives in a binding requirement

The selected section says **one option is chosen and the menu is deleted**. Ten lines earlier, binding requirement 1 still says:

> `project()` lives in a dependency-isolated module **or a separate process**.

That is not historical prose or a struck alternative; it is one of five present-tense mandatory requirements. An implementer can cite it to choose the process branch that the selected section explicitly declined because no enforceable sandbox was specified.

This is the campaign's carrier problem in exact form: withdrawing a rule in one paragraph does not withdraw it from another operative paragraph. Replace the disjunction with the selected pure-module contract. The process alternative may remain only as historical explanation, never as an allowed implementation form.

## F-2 — a closed import graph does not close the captured-reference path the design promises to reject

Three statements currently disagree:

1. binding requirement 4 promises the boundary check will reject any forbidden **captured reference** reaching `project()`;
2. matrix row 26 requires RED for an import **or captured reference** reaching a ledger/oracle reader;
3. the chosen enforcement and its red-proofs cover imports, transitive imports, filesystem/network modules, and dynamic `import()`—but no captured or injected module state.

A concrete counterexample satisfies the selected import rule while violating the promised boundary:

```ts
let lookup: ((id: string) => unknown) | undefined;
export function configureProjection(fn: (id: string) => unknown) { lookup = fn; }
export function project(lane: Lane) {
  return lookup ? projectWithExpectedValue(lane, lookup) : projectNormally(lane);
}
```

The module can have zero imports, no filesystem/network module, no dynamic import, and an empty frozen transitive dependency graph. A caller can still inject a ledger reader through the exported setter. This is not a hostile `globalThis` attack; it is ordinary accidental same-process wiring—the exact threat model the chosen contract claims to cover.

The simplest sound repair is to make the projection kernel a **zero-import leaf** and statically close its state/API surface:

- export only `project` plus immutable plain-data schema constants;
- forbid mutable module-scope state, setter/configuration exports, function-valued inputs, callbacks, and free/captured references outside an explicit immutable allowlist;
- retain the sealed-before-ledger-parse sequence and digest mutation as independent behavioral controls;
- add a red-proof that injects an expectation reader through a module-local setter/callback while imports remain clean, and require the build rule to name that path;
- keep an immutable-constant clean neighbour green so the rule is not “reject every module-scope reference.”

Alternatively, narrow requirement 4 and row 26 by deleting the captured-reference claim. I do **not** recommend that: it would leave the most ordinary accidental injection route open while calling the module pure. A zero-import leaf with a closed export/state surface is smaller and easier to verify than a general transitive dependency policy.

## EVIDENCE INDEPENDENTLY CHECKED

- Verified worker commit, parent, changed paths, exact design blob, and SHA-256. The delivery changes only the design plus the worker report.
- Executed TypeScript `compileBindingPlan()` from `src/server/lib/spec-family-bindings.ts` at `c304b098` on `40-overrefusal-boundary.spec.json`, passing `doc.spec`; three of three target IDs matched.
- Executed Python `compile_binding_plan()` in the same pinned tree on the same artifact body and join key `(fixture, condition_id)`.
- Compared `filter_lunch`, `bias_overnight`, and `retest_midday` on `approximation`, `primitive`, and `session_zone`: `9/9` equal; six non-null, three null.
- Parsed the exact ledger by classification and property presence: N/A `9`, asserted `140`, N/A values present `0`, asserted values present `140`.
- Parsed the proof matrix independently: 34 unique contiguous numbered rows, no gaps or duplicates.
- Read the operative capability requirements and selected mechanism together; the retained `or a separate process` carrier and uncovered captured-reference promise are both present in the same committed design.

## TESTS RERUN

- TypeScript pinned execution: **exit 0**, exact three-row output reproduced.
- Python pinned execution: **exit 0**, exact three-row output reproduced.
- Ledger classification/property census: `9/9 NO EXPECTATION`, `0/9 value`; control `140/140 ASSERTED value`.
- Matrix parser: rows `1..34`, count `34`, unique `34`, missing `[]`, duplicates `[]`.

## ARCHITECTURE INVARIANTS TOUCHED

- Authority silence never rewrites observation-layer values.
- Claim A remains ledger-independent; Claim B alone consumes expectations.
- `MISSING`, JSON `null`, and a value remain three distinct states.
- A pure-module claim requires a closed state/API surface, not merely a clean import graph.
- A withdrawn implementation option must be removed from every operative carrier.

## FAILED OR UNPROVEN CONDITIONS

- The selected mechanism does not yet fulfill its own captured-reference requirement or row-26 red-proof.
- The five-requirement boundary still authorizes the declined process alternative.
- No P0-vNext implementation, runtime mutation suite, CI execution, current Surface-B population, or authority-semantic verification exists. The `35/35` result is a design/receipt result, not implementation evidence.

## REQUIRED CORRECTIONS

1. Replace the operative “dependency-isolated module **or separate process**” requirement with the single selected pure-module form.
2. Specify the pure module's closed export and state surface. Prefer a zero-import leaf; forbid mutable module state, setters/configuration injection, callbacks/function-valued inputs, and unallowlisted free/captured references.
3. Add the clean-import captured-reader mutation described above and an immutable-constant green neighbour. Preserve row 26 as a real promise rather than narrowing it away.
4. Recompute the matrix caption only if a new numbered row is added; extending row 26 with the missing discriminator need not inflate the attack count.

## FILES / SCOPE ALLOWED

Design-only: `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` plus the normal worker report. Do not edit implementation, pinned lanes, ledger/oracle/census, blueprint, engine/runtime/extraction/DB, Gate B, grade receipts, merge, or deployment surfaces.

## ACCEPTANCE COMMANDS / OBSERVABLES

1. Search the operative design requirements: no live `module OR process` choice remains; the process text is historical only.
2. Print the selected module's allowed imports, exports, module-scope state, and free-reference policy as closed sets.
3. Pre-register and describe a clean-import setter/callback injection. The future AST/build rule must fail it and name the injected path.
4. Keep a clean immutable-schema-constant control green.
5. Re-parse the matrix and all capability-contract carriers after the edit; no promise may exist without a matching catcher.

## STOP CONDITION

Stop if a clean import graph is treated as proof that no callback, setter, mutable singleton, or captured reference can feed expectations into `project()`. Stop if “separate process” remains an operative choice without a named sandbox mechanism.

## LESSON TO PERSIST

> **An import graph closes imports. It does not close state injection.**

> **A withdrawn option survives until every operative carrier is removed.**

> **The smallest credible pure-module boundary is a zero-import leaf with a closed export and state surface.**

**Authorized next action:** revise this one design boundary now, in the existing worker seat, then return one design-only receipt. Implementation, grading, merge, deployment, Phase-1 profile, Surface B, P3, and Gate B remain blocked.
