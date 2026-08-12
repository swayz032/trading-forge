# AR-1035 — WORKER — `OR-STATE-HANDOFF-1` RED→GREEN AND PUSHED · THE PROVEN CANDIDATE NOW CONTROLS THE WINDOW

```
RULING  : AR-1034 (gpt-rulings 514b7f10) §4 objective · §5 pre-mutation trace · §6[A..G] · §8 STOPs
PIN     : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81   origin/h1-wave4-sealed12-driver
REPAIR  : c3355df4 (the unit)  ·  0bbcabc8 is the generated SYSTEM-INVENTORY only
TREE    : C:\Users\tonio\Projects\wt-h1-wave4-20260712  (campaign worktree, NOT runtime-production)
STATE   : RED→GREEN complete and pushed. No STOP fired. No grader owed under §9.
SEAT    : FRESH worker seated this session — the AR-1034 seat is gone. See FINDINGS 5.
```

## 1. §5 PRE-MUTATION TRACE — THE ANSWER THE RULING ASKED FOR

Read-only, on the frozen golden artifact (`st5e-YJRfKc__s0`), **before any mutation**.

**Does `resolved_candidate.source_condition_id` exactly equal the `ConditionBinding.condition_id`
consumed by `_h_opening_range`?** — **YES, EXACTLY. `[MEASURED HERE]`**

```
planned candidate rows : 3
  5-minute  opening range (5m)  source_condition_id = 'OPENING_RANGE_DEFINITION:once-you-take-the-price-that-s-establish#0'
  15-minute opening range (15m) source_condition_id = 'OPENING_RANGE_DEFINITION:once-you-take-the-price-that-s-establish#0'
  30-minute opening range (30m) source_condition_id = 'OPENING_RANGE_DEFINITION:once-you-take-the-price-that-s-establish#0'
  AGREE(source_condition_id vs definition.provenance.condition_id) : True  (all three)

OR binding condition_ids       : ['OPENING_RANGE_DEFINITION:once-you-take-the-price-that-s-establish#0']
candidate source_condition_ids : ['OPENING_RANGE_DEFINITION:once-you-take-the-price-that-s-establish#0']
EXACT SET EQUALITY : True
OR condition count : 1        ⇒ §8.2 (two OR conditions, ambiguous join) does NOT fire
```

★ **The join key was verified against the REAL routing predicate, not my reading of it.** The
dispatch is `elif b.type == "OPENING_RANGE_DEFINITION":` → `self._h_opening_range(b, ctx)`
(`spec_condition_compiler.py:2132,2156`). `ConditionBinding.handler` is `None` on every binding —
routing is by `type`. Selecting OR bindings by a `handler` field would have matched nothing and I
would have "measured" an empty set agreeing with an empty set.

⇒ ids agree ⇒ §5's conditional fires: **the relation is now pinned fail-closed.**

## 2. §3.1/§3.2 PREMISES — BOTH RE-MEASURED, BOTH CONFIRMED

Treated as `RELAYED` until measured (`[order-premise-grade]`). Both **CONFIRMED `[MEASURED HERE]`
at `db277b3b`**:

- **The proven object was discarded.** `backtester.py:8315` read `resolve_row_for_execution(row)`
  as a bare statement; `validate_candidate_authority` returned `None` on success.
- **The consumer was already built.** `from_compiled_spec` has carried
  `opening_range_candidate: OpeningRangeExecutionCandidate | None = None` all along — its own
  docstring calls it *"SURFACE 12A — TRANSPORT ONLY (S6 EXECUTION ACTIVATION)"* — and the Band C
  call site at `:8511` never passed it.

★ **Third instance of the same species in three units.** MP1: `resolve_row_for_execution` had zero
non-test callers. MP2: the `from_compiled_spec` branch was unreachable through the route. MP2→now:
the parameter existed, named for this exact purpose, and nothing filled it.
**`THE CAPABILITY WAS BUILT AND THE ONE HOP THAT WOULD HAVE MADE IT REACHABLE WAS MISSING.`**

## 3. THE REPAIR

`resolve_candidate_authority(config) -> (refusal, candidate)` returns the resolver's **own return
value**; `main()` holds it as a local and hands it to `from_compiled_spec(opening_range_candidate=…)`.
Both sites are in `main()`, so nothing is stashed on `config` and nothing is serialised — a
candidate cannot be forged into the transport. `validate_candidate_authority` remains as a
refusal-only wrapper that **delegates**, so MP1's committed controls exercise an unchanged entry
point and there is still exactly ONE proof.

**No rebuild, no rehydration, no `candidates[0]`, no default 15m, no inference from timeframe.**

§5's pin, in `_h_opening_range`, immediately after the existing no-candidate refusal:

```python
if candidate.source_condition_id != b.condition_id:
    raise FamilyMetaEnforcementError(...)   # names BOTH ids and the variant
```

## 4. §6 PROOF SET — A..G

**§6A RED, at the real config-file `main()` boundary, pre-repair:**

```
E  AssertionError: the object handed to from_compiled_spec is not the object the resolver returned
E  assert None is OpeningRangeExecutionCandidate(source_spec_id='st5e-YJRfKc__s0', …, duration_minutes=5, …)
   2 failed, 1 passed
```

★ **Its positive controls passed BEFORE that line:** `seen["reached"] is True` (Band C dispatch ran)
and `seen["artifact"]["spec_hash"] == cfg["compiled_spec"]["spec_hash"]` (the other payload on the
SAME call arrived). And the resolver spy recorded **exactly one** real candidate. So the absence was
a live finding, not a dead harness.

| § | control | result |
|---|---|---|
| 6A | proven candidate reaches `from_compiled_spec` | ✅ RED→GREEN |
| 6B | **object IDENTITY** (`handed is produced[0]`), one resolution only | ✅ — equality alone would tolerate a second rehydration |
| 6C | taught duration moves the REAL gate boundary | ✅ see below |
| 6D | candidate for another condition REFUSED | ✅ red-proved by ablation |
| 6E | MP1 refusal still fires BEFORE any handoff; no unproven candidate reaches the factory | ✅ |
| 6F | legacy row stays candidate-free | ✅ (green before AND after — it is a preservation control) |
| 6G | regression set | ✅ see §5 below |

**§6C — the decisive semantic witness.** Same compiled spec, same bar stream, only the candidate
changes, through the existing `SpecConditionStrategy` → `_h_opening_range` → `opening_range_adapter`
path on deterministic synthetic bars:

- both arms gate **False** before their own lock;
- in `bars[5:15]` — after the 5m lock, before the 15m lock — **5m is active, 15m is still forming**;
- after bar 15 both are complete, per the existing adapter contract;
- `not np.array_equal(a5, a15)`.

Positive witnesses `a5[5:].all()` and `a15[15:].all()` run first, so two all-False arrays cannot
satisfy the "not active" claims by doing nothing. **No prices, breakout rules or entry logic were
invented — the claim is state-window selection only.**

**§6D red-proof by ablation.** With the guard ablated to `if False and …`, `6D` FAILS
(`DID NOT RAISE FamilyMetaEnforcementError`) while `6C` stays GREEN; restored, both pass.
⇒ **without the guard a foreign candidate silently DRIVES the binding — no error at all.** The
guard bites, and it bites only the thing it is for.

## 5. §6G REGRESSION AT `0bbcabc8`

| suite | result |
|---|---|
| `test_mp1_backtester_ingress.py` (MP1 + MP2 + 5 new handoff controls) | **19 / 19** |
| `test_s6_candidate_transport_and_adapter_execution.py` (+2 new) | **20 / 20** |
| `test_mp1_candidate_receipt.py` + `_persistence.py` (the 25 obligations) | **25 / 25** |
| OR candidate · fanout · lowering · grammar-firebreak · family-meta · trigger-safety | **245 passed, 1 deselected** |
| `test_opening_range_adapter.py` | **31 / 31** |
| `mp1-candidate-ingress.test.ts` (real route, vitest) | **18 / 18** |
| `npx tsc --noEmit` | **NOT RUN — no TypeScript changed** (§6G's condition) |

Production diff: `backtester.py` and `spec_condition_compiler.py` only; the executable change is
~15 lines plus the 13-line guard, the rest is comment/docstring.

## 6. FINDINGS — INCLUDING AGAINST MYSELF

1. 🛑 **PRE-EXISTING RED, NOT MINE, AND IT SURVIVED TWO CLOSURES.**
   `test_flag_off_parameterized_refusal.py::test_the_canonical_population_matches_its_committed_manifest_by_member`
   FAILS: `[MANIFEST] committed=107 derived=108`. **I proved it red at `db277b3b` BEFORE my
   change** by extracting a pristine `git archive HEAD src` tree and re-deriving against it:
   `derived at HEAD = 108`, extra member `engine/tests/test_mp1_backtester_ingress.py`, identical
   to what I see now. **My change is population-NEUTRAL** — an AST edge diff of all four files I
   touched shows the only added edge is `family_meta_enforcement.FamilyMetaEnforcementError` on an
   S6 test file that was already a member.
   ⇒ **The MP1 test file entered the canonical population when MP1 created it and the manifest was
   never regenerated.** `[population-baseline]` says regenerate via `_regression_population()`,
   never hand-edit. **I did NOT regenerate it** — that is a denominator change outside this unit's
   authorization (§7) and `0-CTRL.8` forbids polishing acceptance infrastructure. **It is GPT's
   call.** ★ Neither AR-1033's nor AR-1034's regression set included this suite, which is why two
   closures passed over a live red.
2. ⚠️ **`validate_candidate_authority` is now TEST-ONLY in production terms.** The regenerated
   SYSTEM-INVENTORY reports it as *"no non-test reference outside its own definition"* — I moved
   the one production caller to `resolve_candidate_authority`. **Deliberate**, to keep MP1's
   committed controls unchanged, but it is a new BUILT-UNREACHABLE symbol. Retire it (and update
   8 MP1 test call sites) or keep it — **GPT's call; I did not decide it silently.**
3. ⚠️ **My first commit was rejected by `ruff` — `F821 Undefined name 'Any'`.** I annotated the new
   return type without importing `Any`. Fixed by importing it. **I deliberately did NOT use a
   `TYPE_CHECKING` import of `OpeningRangeExecutionCandidate`**, which would have been the more
   precise annotation, because `ast.walk` sees imports inside `if TYPE_CHECKING:` and it would have
   added a module edge to `backtester.py` — shifting the very canonical population I had just
   proven my change leaves untouched. The reason is recorded in the code.
4. ⚠️ **Two harness errors of my own, both mine and both corrected before any claim rested on
   them.** (a) I ran the §5 trace by absolute path, so `sys.path[0]` was the scratchpad and
   `src.engine` did not import — re-run with `PYTHONPATH` at the worktree root. (b) I assumed
   `BindingPlan` was iterable; it is a dataclass with `.bindings` / `.invalidation_bindings`.
   Neither produced a wrong measurement — both crashed loudly rather than returning a plausible
   number, which is the failure mode I would rather have.
5. ⚠️ **SEAT ROLL.** AR-1034 ended *"I have context to continue and am not handing off."* **That
   seat is gone** — a process census (`Win32_Process` + parent walk) shows exactly one live
   `claude.exe`, born after it. This is a fresh seat that cold-started from the branch. Flagging it
   because AR-1034's closing line would otherwise imply continuity that does not exist.
6. ⚠️ **An ORPHANED ear from the dead seat is still polling** this same ref every 2s (PID 13748,
   parent dead). **I did not kill it** — `worker-onboarding §2a.3` forbids killing a monitor I did
   not arm. It delivers to nobody. Flagged for disposal, not acted on.

## 7. WHAT I DID **NOT** MEASURE

- **§6C does NOT go red without this repair, and it is not claimed to.** It constructs the instance
  with a candidate directly, so it is the SEMANTIC witness (does the taught duration control the
  boundary), while **6A/6B are the transport red-proof** (does the proven object get there at all).
  The chain is proven by the pair; neither half proves it alone.
- **No live Postgres, no full market-data backtest.** §6C uses deterministic synthetic bars through
  the real adapter, as §6C directs. **This proves STATE SELECTION, not that a trade is then taken
  correctly.**
- **The 30m taught variant is not exercised in the discrimination test** — §6C asked for at least
  two, and 5m/15m give the tightest window. 30m is covered by the §5 trace only.
- **`runtime-production` NOT inspected.** Everything above is the campaign worktree
  (`[tree-divergence]` — `MEASURED ≠ MEASURED-WHERE-IT-RUNS`).
- **`EDGE-HTF-PASSTHROUGH-AUTHORITY-1` untouched and still banked HIGH.**
- **Nothing in §7's forbidden list touched**: no breakout, retest, stop/target, overlay, sizing,
  HTF, MC/OOS/WF/paper, DB schema, candidate identity redesign, second OR calculator, vocabulary.

## 8. §8 STOP CONDITIONS — NONE FIRED, CHECKED INDIVIDUALLY

1. ids match exactly (§1); 2. exactly ONE OR condition in the compiled spec, so no ambiguous join;
3. the resolver's returned object is preserved, never rebuilt; 4. `_h_opening_range` consumes it
with no arithmetic change; 5. the 5m/15m boundary moved in the expected direction; 6. MP1 refusal
ordering proven still earlier (§6E); 7. no new parameter channel, selector, migration, compiler or
checker framework; 8. nothing guessed from timeframe, name, prose, array order or a default.

## 9. REPRODUCE AT `0bbcabc8`

```bash
git fetch origin h1-wave4-sealed12-driver && git checkout 0bbcabc8
python -m pytest src/engine/tests/test_mp1_backtester_ingress.py \
                 src/engine/tests/test_s6_candidate_transport_and_adapter_execution.py -q
python -m pytest src/engine/tests/test_s6_candidate_transport_and_adapter_execution.py \
                 -k or_state_handoff -q
npx vitest run src/server/routes/__tests__/mp1-candidate-ingress.test.ts
```

**§10's chain is now closed end to end:**
`DB-authoritative receipt → resolver → exact OpeningRangeExecutionCandidate → from_compiled_spec →
SpecConditionStrategy → _h_opening_range → opening_range_adapter → OpeningRangeState`,
with taught-duration discrimination proven and no STOP active.

**NEXT:** awaiting GPT's ruling. Per §10 the next semantic unit is the remaining Opening Range V1.0
sequence (breakout / optional confirmation-retest / entry / invalidation / stop / target / exit),
which is **not** authorized yet. Two items above (**FINDING 1**, the stale canonical manifest, and
**FINDING 2**, the now-test-only wrapper) are **GPT's calls** and I have deliberately not acted on
either. Ear armed on this branch.
