# External GPT review — `P0-vNext` design after `AR-573`

**Reviewed object:** worker delivery commit `abf9895622edac14c5669276089b413674051aee`; design blob `f68b15cad1e68cf59e91e602d493f60b0ca0bd20`, working-file SHA-256 `87FDB6EC9C92B3D18C264F54C70B3126C5F5C5C80FC8D9324134D69479621C74`. Blueprint remains blob `fa1ce96007967dc82638fd9e885f1fd84c50e303` from AR-571 and is unchanged by this delivery.

**Newest worker report read before publication:** `AR-573` (`AR-572` is its start receipt).

**RULING ID / TASK ID / DECISION:** external review of `AR-573` · **REVISE**. Sustain the five requested corrections, but keep implementation and grade blocked. The revised document severs Claim A from ledger classification and specifies the correct 10-key normalization → 5-key selection order. It then introduces a new semantic error: it equates ledger classification `NOT-APPLICABLE` with a runtime field value of JSON `null`. The pinned executable outputs directly refute that equation on six of the nine N/A cells.

## CLAIMS VERIFIED

- **[MEASURED HERE, exact design blob]** Claim A's both-missing case is now always a failure; no classification exception remains in that verdict.
- **[MEASURED HERE]** the full 10-field binding boundary is validated before the closed five-field Claim-A selector. The two real TS renames are correctly scoped.
- **[MEASURED HERE]** classification-only mutation, selector mutation, sixth-field mutation, and re-pointed destination mutation are separately registered.
- **[MEASURED HERE]** digest language is narrowed to one mutation over one exercised population.
- **[MEASURED HERE]** §10 has 33 contiguous rows: 32 mutations and one clean control.
- **[MEASURED HERE]** the contradiction pass is explicitly a document-text control, not runtime proof.

## F-1 — `NOT-APPLICABLE` means “no authority assertion,” not “the runtime value is null”

The new design says:

- *“A semantically inapplicable field is emitted as JSON `null`”*;
- the nine `NOT-APPLICABLE` cells retain skip witnesses;
- proof row 7 specifically requires a `NOT-APPLICABLE` cell with both lanes emitting JSON `null`.

That joins two different concepts by label rather than by evidence.

I parsed the exact committed ledger. Its nine N/A cells are three axes (`approximation`, `primitive_null`, `session_zone`) across three rows in `40-overrefusal-boundary.spec.json`. Every `declared_reason` says **“NO EXPECTATION”**. None carries a `value`. The classification records the authority's inability or refusal to assert the answer; it does not prescribe a runtime representation.

Then I executed **both pinned lanes at `c304b098`** on those exact three `(fixture, condition_id)` rows:

| condition | projected axis | TypeScript | Python |
|---|---|---|---|
| `filter_lunch` | `approximation` | `true` | `true` |
|  | `primitive` | `entry_quality.confluence_factor_presence` | same |
|  | `session_zone` | `null` | `null` |
| `bias_overnight` | `approximation` | `true` | `true` |
|  | `primitive` | `bias_engine.classify_institutional_regime` | same |
|  | `session_zone` | `null` | `null` |
| `retest_midday` | `approximation` | `true` | `true` |
|  | `primitive` | `spec_condition_compiler.retest_touch_check` | same |
|  | `session_zone` | `null` | `null` |

Therefore the nine N/A-axis values are **six non-null and three null**. The lanes agree on all nine. Requiring null for N/A would either rewrite six real outputs or build a proof row that exercises only the convenient third of the classified population.

The correct separation is:

- Claim A compares the actual five projected values for all 43 rows, including values whose corresponding ledger cells have no expectation.
- Claim B emits a skip witness for each N/A **ledger cell** and executes no expectation predicate for it.
- `null` is a legitimate runtime value where the lane actually emitted null; it is not the encoding of authority silence.
- `MISSING` still means the lane failed to emit a required key and remains a Claim-A failure.

Rewrite row 7 to use the actual pinned three-row N/A population: Claim A compares `true`/concrete primitive/`null` normally and stays green because the lanes agree; Claim B emits nine skip witnesses and no predicates. Add a mutation changing one lane's `approximation=true` to `null` on an N/A cell; Claim A must go red even though Claim B still skips it. That is the discriminator proving N/A does not suppress agreement.

## F-2 — the capability branch remains unresolved and cannot survive into implementation authorization

AR-573 correctly narrows the digest claim and labels same-process ambient denial `[UNRESOLVED — NAMED]`. That honesty is sustained. But the design still offers *“dependency-isolated module **or** separate process”* while only preferring the latter, and the separate-process paragraph asserts filesystem/network/environment denial without naming the enforcement mechanism.

A child process is not a sandbox by being a child process. On this Windows host it normally inherits filesystem access and can open the committed ledger by path. An empty environment and stdin-only API reduce accidental coupling but do not deny `fs.readFileSync()`.

Before implementation authorization, choose one concrete capability contract:

1. a genuinely restricted process/runtime with a named enforcement mechanism and a red-proof that attempts each forbidden channel; or
2. an explicitly non-adversarial pure-module contract, enforced by a closed dependency graph/AST rule and behavioral mutations, whose claim is narrowed to accidental coupling prevention rather than filesystem unreachability.

Do not retain a menu where one branch is unresolved and the other carries an unspecified denial. This does not require another broad architecture cycle; it requires one explicit threat model and one selected mechanism.

## EVIDENCE INDEPENDENTLY CHECKED

- Verified the worker commit and exact design blob; later campaign commits do not alter the reviewed design.
- Parsed all nine N/A cells by key: three rows × three axes; all nine `declared_reason` fields say `NO EXPECTATION`; zero contain `value`.
- Executed `compileBindingPlan()` in the pinned TypeScript worktree `wt-ledger-e-delivery-r497-20260730 @ c304b098` on `40-overrefusal-boundary.spec.json`.
- Executed Python `compile_binding_plan()` in the same pinned worktree and compared the same three condition IDs. Both lanes produced the table above exactly.
- Parsed the proof matrix: 33 contiguous unique rows, with row 33 the sole clean control.
- No P0-vNext implementation exists; `42/42` is a text-suite result and did not exercise the pinned lane values that refute row 7.

## TESTS RERUN

- Ledger N/A census: `count=9`, axes `{approximation:3, primitive_null:3, session_zone:3}`, `NO EXPECTATION=9/9`, values present `0/9`.
- TypeScript pinned execution: three target bindings returned `approximation=true`, concrete `primitive`, `sessionZone=null`.
- Python pinned execution: byte-equivalent values after source-to-wire normalization.
- Matrix parser: rows `1..33`, unique and contiguous, one clean control.

## ARCHITECTURE INVARIANTS TOUCHED

- Agreement still runs where authority truth is unknown; authority silence cannot erase observed lane values.
- `NOT-APPLICABLE` is a Claim-B predicate status, not a Claim-A data value.
- A process boundary and a sandbox boundary are different things.
- Design-text coherence checks do not replace execution against the pinned population.

## FAILED OR UNPROVEN CONDITIONS

- Proof row 7 and the semantic-inapplicability paragraph contradict six pinned runtime values.
- No selected, enforceable capability-isolation mechanism exists yet.
- No implementation, runtime mutation suite, CI execution, authority-semantic verification, or current Surface-B population exists.

## REQUIRED CORRECTIONS

1. Remove every equation of `NOT-APPLICABLE` with JSON `null` or semantic runtime inapplicability.
2. State that all five raw values are compared exactly as emitted; only `MISSING` is universally invalid.
3. Replace row 7 with the real three-row/nine-cell N/A control and add the one-lane `true → null` N/A mutation described above.
4. Select and specify one capability-isolation threat model/mechanism; keep implementation blocked while the branch remains unresolved.
5. Re-parse the matrix count after the new mutation lands.

## FILES / SCOPE ALLOWED

Design-only: `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` and the normal worker report. Blueprint need not change unless wording newly introduced there changes. No implementation, ledger/oracle/census mutation, engine/runtime/extraction/DB/Gate-B work, grade, merge, or deployment.

## ACCEPTANCE COMMANDS / OBSERVABLES

1. Parse the nine N/A ledger cells and print their exact `declared_reason`; the design describes them as authority-unasserted, never value-null.
2. Re-run both pinned lanes on the three IDs and embed/hash the measured nine values in the design receipt.
3. A one-lane `approximation true → null` mutation on an N/A cell makes Claim A red while Claim B still emits the same skip witness.
4. The clean N/A control preserves six non-null and three null values and produces nine Claim-B skip witnesses.
5. The capability section names one chosen mechanism, its threat model, and red-proofs for every channel it claims to deny.
6. Matrix rows remain contiguous, with exactly one clean control and a recomputed caption.

## STOP CONDITION

If `NOT-APPLICABLE` changes or suppresses a Claim-A projected value, stop: authority silence has become a data rewrite. If “separate process” is cited as filesystem isolation without an enforced sandbox, stop: a topology statement is being used as a capability proof.

## LESSON TO PERSIST

> **No expectation is not an expectation of null.**

> **A skip in the authority layer must not erase a value in the observation layer.**

> **A child process is a boundary for state, not automatically a boundary for authority.**

**External recommendation:** sustain AR-573's five structural repairs, correct the N/A semantic join using the pinned two-lane outputs, select a real capability-isolation contract, and keep implementation/grade blocked pending one more exact-object external review.
