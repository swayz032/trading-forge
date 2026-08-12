# AR-1034 — WORKER — `MP2-COMPILED-SPEC-INGRESS-1` RED→GREEN AND PUSHED · THE ENGINE'S BAND C BRANCH WAS UNREACHABLE THROUGH THE ROUTE

```
RULING    : AR-1033 (gpt-rulings 2f072e5b) §4 objective, §5[1..8] proof, §6 STOPs
FINAL SHA : db277b3b51f79ba53f62595e99cbce9dcf84b465   origin/h1-wave4-sealed12-driver
REPAIR SHA: 27ef227a  (MP2)   ·   db277b3b is the generated SYSTEM-INVENTORY only
STATE     : RED→GREEN complete and pushed. No STOP fired. No grader (§8).
SEAT      : same fresh worker, adequate context — no handoff, per §9.
```

## 1. PRE-FLIGHT — BOTH OF THE RULING'S LOAD-BEARING PREMISES RE-MEASURED

`AR-1033 §4` asserted two things I treated as `RELAYED` until measured. Both **CONFIRMED
`[MEASURED HERE]` at `d2f22253`**:

- **The route did not carry the artifact.** `backtests.ts` mentions `compiled_spec` only inside my
  own MP1 helper, reading `compiled_spec.spec_hash` as the candidate parent anchor (`:183`, `:192`).
  The **object** never entered `fullConfig`. *(Positive control: 26 `strategyId` matches — the grep
  sees the file.)*
- **The engine consumer already existed.** `backtester.py:8490`
  `elif isinstance(config, dict) and config.get("compiled_spec"):` → `from_compiled_spec(...)` at
  `:8511`, the Band C condition-family path.

⇒ Storage home ✅, engine consumer ✅, **transport ❌**. Exactly the shape `§4` described, so **no
STOP fired** and I executed straight through.

★ **This is the same species as MP1**, and worth naming twice: *the capability was built, and the
one hop that would have made it reachable was missing.* MP1's `resolve_row_for_execution` had zero
non-test callers; MP2's `from_compiled_spec` branch had no way to be entered through
`/api/backtests`.

## 2. THE REPAIR — 14 LINES OF PRODUCTION CODE

```ts
const persistedCompiledSpec = stratConfig?.["compiled_spec"];

const fullConfig = {
  ...config,
  strategy: resolvedStrategy,
  ...(candidateAuthority.kind === "candidate" ? candidateAuthority.sidecar : {}),
  // Spread after `...config` so a request-body `compiled_spec` can never win.
  ...(persistedCompiledSpec !== undefined ? { compiled_spec: persistedCompiledSpec } : {}),
};
```

**Moved, never understood.** No rebuild, translate, sanitize, recompile or summarize — `spec_hash`
is computed over that object, so re-serialising it in the route would silently redefine what the
certification covers. A row without one gets nothing: no artifact is minted, inferred or defaulted.

## 3. §5 PROOF SET — 8 / 8

**§5[1] RED at the real route boundary**, pre-repair, driving the real registered POST handler:

```
control 1: AssertionError: expected undefined to deeply equal { video: 'st5e-YJRfKc__s0', …(6) }
```
★ **And its positive controls passed BEFORE that line** — `strategy.entry_long === "close > open"`
and `execution_candidate_id === "cand-15m-bbbb2222"` both reached `runBacktest`. So the absence was
a real finding, not a dead harness. `§5[1]`'s positive-control requirement is met literally.

| § | control | result |
|---|---|---|
| 5[2] | exact transport | ✅ deep equality **and** `JSON.stringify` identity — deep equality alone would tolerate a key-reordered rebuild; nested `spec` asserted intact, not flattened to `spec_hash` |
| 5[3] | request cannot supply/replace | ✅ request-body `compiled_spec` ignored; persisted object still delivered |
| 5[3] | request cannot **conjure** one | ✅ legacy row + request-body `compiled_spec` ⇒ key absent from `fullConfig` (the dangerous half: not overriding, but creating) |
| 5[4] | MP1 not weakened | ✅ incomplete candidate sidecar ⇒ `409 candidate_authority_incomplete`, `runBacktest` never called; and in Python a tampered sidecar refuses **before** Band C runs |
| 5[5] | Python dispatch witness | ✅ real config-file transport → real `main()` → exact artifact reaches `from_compiled_spec`; discriminating arm proves a legacy config does **not** |
| 5[6] | legacy negative control | ✅ no artifact grown; positive control confirms the legacy path really built a config |
| 5[7] | no trading-semantic mutation | ✅ `from_compiled_spec`, condition meanings, OR duration selection, stop/target/entry logic all untouched |
| 5[8] | suites + `tsc` | ✅ below |

### The dispatch witness, and the false green it was built to avoid

`from_compiled_spec` is imported **inside** the branch at call time (`:8499`). It is therefore
patched on its **defining module** (`spec_condition_compiler`), not on `bt`. **Patching `bt.*`
would have silently no-opped and the witness would read "never dispatched" on both arms** — the
`[main-spy-both-arms]` shape again. The discriminating arm (legacy config ⇒ `reached is False`)
is what makes the positive arm mean anything.

## 4. §5[8] GREEN SET AT `db277b3b`

| suite | result |
|---|---|
| `mp1-candidate-ingress.test.ts` (13 MP1/fail-closed + 5 MP2) | **18 / 18** |
| `test_mp1_backtester_ingress.py` (11 MP1 + 3 MP2 dispatch) | **14 / 14** |
| `test_mp1_candidate_receipt.py` + `_persistence.py` (the 25 obligations) | **25 / 25** |
| `npx tsc --noEmit`, whole repo | **0 errors** |
| 7 adjacent backtest suites | **59 / 59** |

**Production diff since MP1 close is `backtests.ts` +14 lines.** Everything else is tests and the
generated inventory.

## 5. §6 STOP CONDITIONS — NONE FIRED, CHECKED INDIVIDUALLY

1. no rewriting/normalizing of the artifact — it is spread verbatim; 2. no guessing which artifact
belongs to the row — it is read from that row's own `config`; 3. **no `spec_hash` contradiction
observed** — MP1's candidate parent anchor already reads `compiled_spec.spec_hash` and the
candidate tests still pass unchanged beside the MP2 ones; 4. Band C consumes the stored artifact
with no compiler/trading change; 5. no request-side override needed to be retained; 6. no DB
schema, no new compiler, no new checker framework.

## 6. WHAT I DID **NOT** MEASURE

- **No live Postgres and no full market-data backtest.** `§5[5]` sanctions stubbing the first
  expensive dependency; I stubbed `from_compiled_spec` itself and `load_ohlcv`. **This proves
  DISPATCH, not execution** — that the artifact selects Band C, not that Band C then trades it
  correctly.
- **The route test's `compiled_spec` is a faithful fixture, not a live DB row.** Its shape is taken
  from `spec-onboarding-service.ts:896-902`. **The Python witness uses the REAL golden artifact**
  (`produce_spec_artifact_from_record(...).artifact` → `video`, `spec_hash`,
  `graph_canonical_hash`, `ledger_d`, `spec`), so the artifact-side fidelity is real even though
  the TS-side row is constructed.
- **`OR-STATE-HANDOFF-1` untouched.** The proven `OpeningRangeExecutionCandidate` is still
  discarded in Python. I did not smuggle duration selection in to make it look useful (`§7`).
- **`EDGE-HTF-PASSTHROUGH-AUTHORITY-1` untouched and still banked HIGH.** The nine-field strategy
  whitelist at `:187-197` is unchanged; MP2 did not need it and I did not derail into it.
- **Two `SYSTEM-INVENTORY` commits again**, forced by the same pre-push freshness guard, each
  isolated to that one generated file. No `--no-verify` at any point.

## 7. REPRODUCE AT `db277b3b`

```bash
git fetch origin h1-wave4-sealed12-driver && git checkout db277b3b
npx vitest run src/server/routes/__tests__/mp1-candidate-ingress.test.ts
python -m pytest src/engine/tests/test_mp1_backtester_ingress.py \
                 src/engine/tests/test_mp1_candidate_receipt.py \
                 src/engine/tests/test_mp1_candidate_persistence.py -q
npx tsc --noEmit
```

**`§9`'s condition is met: `MP2-COMPILED-SPEC-INGRESS-1` is RED→GREEN and pushed, final SHA
`db277b3b`.** Per `§7` the next semantic unit is `OR-STATE-HANDOFF-1` — where the proven candidate
stops being discarded and controls the actual Opening Range duration. **I have context to continue
and am not handing off; awaiting the ruling.** Ear armed on this branch.
