# GRADE — POLARITY INVERSION & INV-1 STARVATION (R-617)

## GRADER IDENTITY

**Agent:** `accuracy-validator`, dispatched under ADVISOR RULING **R-617** (standing operator approval for independent grading).
**Mode:** GRADE + adversarial HUNT. Briefed to **REFUTE**.
**Doer independence:** I did not author, design, or previously grade `AR-654`/`AR-658`/`AR-659`/`AR-660`/`AR-661`, nor any part of `backtester.py`, `signals.py`, `prop_sim.py`, or `invariant_harness/core.py`.
**Lineage declaration (required by my own charter):** I previously graded this invariant lane at `docs/designs/GRADE-INVARIANT-HARNESS-2026-08-03.md` (band 4/10, commit `3e266a85`). That grade is **the same lineage** as Claim 2. Every band below is **re-derived from current artifacts only**; I have deliberately not reused any prior score or "fixed" claim. Where the prior grade is relevant I cite it as `ARTIFACT-SOURCED`, never as authority.
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` — a **linked worktree**, `rev-parse --git-common-dir` = `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`, branch `h1-wave4-sealed12-driver`. **Every finding below is from THIS tree.** I did not read `runtime-production` and did not read the main repo `trading-forge/trading-forge`.

---

## INPUTS (pinned)

**HEAD at start:** `4776093f76436a1892504f13062f99db59af4ecb`
**HEAD at end:** `5154ab9a9e9996dd57a210146f8c114c449201c4` — 🛑 **the head MOVED mid-grade** (live worker committed `4465069b`, `a898709c`, `5154ab9a`).

`[MEASURED HERE]` Those three commits touched **only** `docs/designs/ADVISOR-RULINGS.md` and `docs/designs/AGENT-REPORTS.md` (`git diff --stat` = `2 files changed, 125 insertions(+)`). **All five code files under grade are byte-identical at both heads**, so every verdict below holds at `4776093f` *and* `5154ab9a`:

| path | blob SHA-1 (identical at both heads AND in worktree) |
|---|---|
| `src/engine/backtester.py` | `177ec9e14190c424a921d0a5d391a3a77f06dbd1` |
| `src/engine/signals.py` | `ad4cd1b9991ea91cbe7ef64e60e25bb1bec43205` |
| `src/engine/prop_sim.py` | `38d864707b486b9b259d1f00c6c5625d2450e94b` |
| `src/engine/invariant_harness/core.py` | `7e08dd2ca9e4cba91e230cf30ebef4edcb103c0b` |
| `scripts/null_gate_calibration.py` | `2ebdfd7ea1cb66c7e5bc686aacf8e7d59489068b` |

⚠️ **A near-miss I am recording because it would have poisoned the grade.** At end-of-run I compared `core.py`'s worktree SHA-1 (`7e08dd2c…`) against the **sha256** I had printed for my materialised copy (`26d12c74…`), read the mismatch as "the worker edited INV-1 under me", and nearly reported a stale finding. Re-derivation showed the blob is identical at pin, at new head, and in the worktree. **The instrument was my own hash-type confusion, not the artifact** — the third time this desk has been convicted by its own harness.

**Isolation / proxy proof.** The campaign worktree was **read-only**. Everything executed ran from `git cat-file blob <commit>:<path>` materialisation into
`C:\Users\tonio\AppData\Local\Temp\claude\C--Users-tonio-Projects-trading-forge\bf71e513-390a-4a0f-8dee-135d60168b22\scratchpad\polarity-grade\`

`[MEASURED HERE]` Per-file two-sided proof — `sha256(git cat-file blob …)` vs `sha256(materialised file)`, **7/7 OK**, plus **file count 7 on both sides**, plus `CR_count_in_copy=0` on all three large files (proves no CRLF smudge). A `copy == working-tree` check was **not** used, per brief.

| path | sha256 (object DB == copy) |
|---|---|
| `src/engine/config.py` | `137458305556420bd9f528a5c910191a561f2c44e5962d922813aee8998623df` |
| `src/engine/signals.py` | `c428b26de8de70761e4d67f32183b3f43ed992b1c0e2ce7a32deffc113c09e70` |
| `src/engine/backtester.py` | `e3d2db8345e4aa798bafa12a47e49619ab4842a182b58d8170610fae5a9e6003` |
| `src/engine/economic_calendar.py` | `b993b0c07cd8f1490a277d9127d118049f83552ba2c8c649eba1a7d14d092f35` |
| `src/engine/prop_sim.py` | `3d7b61b03ff5007c00a6c3c787ebc35fe5762ab0933b84b040d2b084ca643e6a` |
| `scripts/null_gate_calibration.py` | `a790eaa92a3b22b7c9303fd4860f4a03ef246e1584fd474a630ead5660f92c12` |
| `src/engine/invariant_harness/core.py` | `26d12c748d3ee2b44956220bb01d5b251ba3f8f41311f9b910721fee02d29efc` |

**Fixture independence.** I did not reuse the worker's harness. Producer functions were **lifted by AST** from the pinned blob (`ast.get_source_segment` → `exec`), not retyped, and fed through the **real** `generate_signals` imported from the pinned `signals.py`. Fixtures: `fixture_t1.py`, `fixture_t2_inv1.py`, `fixture_t3_reconcile.py` in the scratchpad above.

**`git status --porcelain` count:** **84 at start, 84 at end.** All five code files byte-pristine at end. `wt-lane3-pfanchor-20260803` @ `6eb4326d` recorded and left alone. I ran no checkout/reset/stash/clean/commit and no index operation.

---

## VERDICT TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| **Claim 1** — polarity inversion, "suppresses 100% of entries" | **6/10** | **VERIFIED IN MECHANISM, REFUTED IN MAGNITUDE** | Inversion confirmed 2 non-overlapping paths (behavioural arms + AST-lifted real producer). "100%" is false: measured **76.89%** on the real `--smoke` data, **92.5%** on my ET fixture | The control substituted a synthetic all-`True` array for the real producer's output — an undeclared proxy. The false "100%" is what made the 60/90 look like a contradiction |
| **Claim 2** — INV-1 "starved, not broken" | **5/10** | **UNVERIFIED AS CHARACTERISED** | Absence verified + positive-controlled. But INV-1 is **tautological, not starved**: 44/44 absent-input shapes PASS, `diff` structurally `0.0000` | The remedy the claim implies (feed it `ending_balance`) would create a **false CRITICAL** — that field is deliberately DLL-cap-inflated. INV-13 already owns the correct check |
| **Claim 3** — desk's own reading: blast radius bounded, "that is why 60 of 90 took trades" | **3/10** | **SPLIT — boundary TRUE but comment-sourced; reconciliation REFUTED** | Boundary proven by me via exclusion + both producers' polarity. The 60/90 clause is **false**: `:5323` ⊂ `run_backtest` (AST) and AR-658 witnessed it firing **60×** — the DSL path | Desk cited a **code comment** as behaviour. The comment happens to be true; the desk never verified it and its reconciliation is contradicted by its own adjacent artifact |

**Auto-downgrade triggers observed:** Claim 3 rests on a comment (documentation, not behaviour) plus a report from another lane — no execution. Claim 1's "100%" is a bare quantifier contradicted by measurement.

---

## TARGET-BY-TARGET FINDINGS

### T1 — Reproduce or refute Claim 1's control independently

`[MEASURED HERE]` My own 400-bar seeded walk (PCG64DXSM seed `20260803`), only `event_mask` varying:

```
event_mask=None        entry_long=271  entry_short=128  exit_long=400  exit_short=400
event_mask=all-True    entry_long=0    entry_short=0    exit_long=400  exit_short=400
event_mask=all-False   entry_long=271  entry_short=128  exit_long=400  exit_short=400
```

**Claim 1's control REPRODUCES structurally.** All-`True` zeros entries; all-`False` is identical to `None`; exits are constant in every arm. My absolute counts differ from the reported `32/33/23` because the fixture, seed and config are mine — the *structure* is the claim, and it holds.

`[MEASURED HERE]` **Inversion confirmed at the executable line, both sides:**
- Producer `backtester.py:3916` docstring "**True = ALLOW trade, False = SIT_OUT**"; `:3924` `mask = _np_ev.ones(n, dtype=bool)  # True = allow`; `:3947` `mask[i] = False` inside the windows.
- Consumer `signals.py:275` docstring "**True values block entry signals (SIT_OUT)**"; `:288` `block = pl.Series("event_block", ~event_mask.astype(bool))`; `:289-290` `entry_long = entry_long & block`.

🛑 **T1 FINDING — "100%" IS FALSE, AND THE TRUTH IS WORSE.** `[MEASURED HERE]` The worker's control fed a *synthetic* all-`True` array. I fed the **real producer's output**:

```
_build_default_event_mask_et  -> True=370  False=30   of 400
  => entry_long=21  entry_short=9   (not 0)
raw entry bars=399   surviving entry bars=30
ET clock-times of SURVIVING entries: ['14:00','14:05','14:10','14:15','14:20','14:25']
surviving entries INSIDE the intended blackout window: 30/30
```

Suppression is **92.5%, not 100%** — and **every surviving entry is inside the FOMC window the mask exists to sit out**. The defect is not merely "entries suppressed"; it is a **selection inversion: the engine trades ONLY during the macro-event windows it was built to avoid.** The mask is literally all-`True` (→ 100%) only in the degenerate case where the data contains no blackout-window bars — which is exactly `AR-660` ARM A/B.

🛑 **T1 NOVEL FINDING — the emitter reports the complement, and is SILENT in the worst case.** `[MEASURED HERE]` `backtester.py:3980` `_masked_bars = int((~event_mask).sum())`:

```
as-coded  _masked_bars = 30
actual bars whose entries were blocked = 370
```

The stderr line at `:3982` announces "masking **30** bars" while suppressing **370** — it reports precisely the set it *allowed*, understating by 12.3×. Worse, `:3981` guards on `if _masked_bars > 0:`; in the total-suppression case `_masked_bars == 0`, so **100% signal suppression prints nothing at all.** The loudest failure is the silent one. Fix point: `backtester.py:3980` (and the polarity at `:3924`/`:3947`) — not the log text.

**Exits — the brief's sub-question, answered NO.** `[MEASURED HERE]` `signals.py:301-305` assigns `exit_expr` to `exit_long`/`exit_short` with **no mask applied**, so exit *signal columns* are genuinely unaffected (my `400/400` is trivially all-True because my exit expression is `close == close`; the invariance across arms is the real result). But the engine **cannot** exit positions it never entered: `[MEASURED HERE]` both P&L blocks are guarded by `if trades_records is not None:` (`:5088` DSL, `:7318` class), and `trades_records` rows are entry/exit **pairs** — no entry, no record, no trade. `[ARTIFACT-SOURCED]` corroborated behaviourally by `AR-660` ARMs A/B: `0` trades and `total_return 0.00` on total-suppression arms. The unmasked exit column is **inert, not dangerous**.

### T2 — Attack Claim 3: does the class path really apply no mask, in code?

`[MEASURED HERE]` **Yes — and for a stronger reason than the comment gives.**
- The class path never calls `generate_signals` at all. `backtester.py:6727` `df = strategy.compute(data)` produces the signal columns; `:6823-6826` merely reads them. `[MEASURED HERE]` the *only* production `generate_signals` call site carrying an `event_mask` is `backtester.py:3991`.
- The class-path mask is gated at `:6846` `if event_calendar is not None and event_calendar.policies and "ts_event" in df.columns:` — structurally matching the comment at `:6835-6837`. The comment is **true**; the desk simply never verified it.

🛑 **T2 — THE POLARITY BOUNDARY, PROVEN BY WHAT IT EXCLUDES.** `[MEASURED HERE]` **Two producers feed ONE consumer with opposite polarities**, selected by the `if`/`elif` at `:3892`/`:3902`:

| producer | init | semantics | agrees with consumer? |
|---|---|---|---|
| `economic_calendar.generate_event_mask` `:1236`,`:1249` | `np.zeros` | "**True = bar is within an event window (SIT_OUT)**" | ✅ **correct** |
| `backtester._build_default_event_mask_et` `:3916`,`:3924` | `np.ones` | "**True = ALLOW trade**" | 🛑 **INVERTED** |

Excluded neighbours (this is what bounds the scope): explicit-policies DSL branch — correct producer; class path with policies — `apply_class_event_mask` `:1464` applies `block = ~event_mask` to the **correct** producer; class path without policies — no mask at all; `strategy.compute()` — `[MEASURED HERE]` **0 of 26** strategy files reference `event_mask`/`blackout`/`sit_out`.

**No THIRD path exists.** `[MEASURED HERE]` the entire event-mask surface in `src/engine/` is exactly three files: `economic_calendar.py` (16 refs), `backtester.py` (15), `signals.py` (4). The compiled-spec lane (`main()`'s `elif config.get("compiled_spec")` → `from_compiled_spec()` → `SpecConditionStrategy`) is a `BaseStrategy` and therefore a **sub-case of the class path**, not a fourth mask path; `run_walk_forward` → `run_backtest` and `run_walk_forward_class` → `run_class_backtest` are dispatchers, not producers.

🛑 **T2 — THE BOUNDARY IS WIDER THAN THE DESK STATED, AND I VERIFIED IT INDEPENDENTLY.** `[MEASURED HERE, positive-controlled]` **Nothing in the repo ever assigns `event_calendar`.** All twelve `.py` occurrences are a field declaration (`config.py:639`), a parameter declaration (`backtester.py:6563`), four reads (`:3892`, `:3897`, `:6846`, `:6848`), and four `request.event_calendar` pass-throughs (`walk_forward.py:376/1343/1423/1450`) that forward an already-`None` value. The two non-Python hits are **not** writers: `macro.ts:210` is a Python import string for a *different* module (`src.data.macro.event_calendar` — a name collision), and `backtest-service.ts:233` is a TypeScript **type declaration** (`event_calendar?: {`).
**Positive control on the same method and surface:** sibling config fields `fill_model` → **23** assignment-shaped hits, `exit_engine` → **26**, `event_calendar` → **6** (all six being decl/read/pass-through). The search can return non-zero; the absence is real.
**Consequence:** the `if` branch at `:3892` is **unreachable in production**, so **every** DSL backtest with a `ts_event` column takes the **defective** fallback; and `:6846` is likewise unreachable, so the class path applies **no mask ever** — not merely "without policies". `[CORROBORATED]` independently reported as `AR-661`/`4465069b`, which I did not read before measuring and which does not cite me.

### T3 — The reconciliation: AR-654's 60/90 vs AR-659's 100%

🛑 **THE DESK'S "DIFFERENT PATHS" RESOLUTION IS REFUTED.**

`[MEASURED HERE]` `scripts/null_gate_calibration.py --smoke` drives the **DSL** path: `:273-274` builds a `BacktestRequest`, `:276-281` calls `run_walk_forward`, which calls `run_backtest` per OOS window (`walk_forward.py:178/492/1379/1391/1426`).

`[MEASURED HERE]` Its synthetic data (`_make_synthetic_ohlcv`, `:195-205`) emits columns `['ts_event','open','high','low','close','volume']` — **`ts_event` present** (so the `elif` at `:3902` fires) and **`ts_et` absent** (so `:3953` selects the **UTC** builder). Measured on that exact generator's own output:

```
bars=780   mask True=600  False=180
producer intended to block 180/780 = 23.1%
consumer actually blocks   600/780 = 76.9%
entries WITHOUT mask: 779      entries WITH real default mask: 180
=> suppression = 76.89%   (AR-659 claims 100%)
=> any entries survive? True  -> a battery CAN still book trades
```

**So the smoke driver hits the DSL default-fallback branch, and suppression there is partial.** The two findings were never in conflict about *paths* — they conflict about *magnitude*, and Claim 1's "100%" is the wrong half.

`[MEASURED HERE + ARTIFACT-SOURCED — two legs, named separately]` The decisive refutation of the 60/90 clause combines one leg I measured with one leg that is the desk's **own** witness:
- `[MEASURED HERE]` AST enclosing-chain for `backtester.py:5323` = `def run_backtest` (lines 3625-6149) → `if trades_records is not None` **[BODY]**. `:5323` is **inside the DSL function**.
- `[ARTIFACT-SOURCED — AR-658 §1/§4]` execution witness `HIT5323 × 60`, `HIT7503` zero times, control probe 90 harness calls, `Errors: 0`.

Therefore the 60 trade-taking backtests ran **`run_backtest`** — the very function carrying the defective fallback. The class path explains nothing about 60/90. **Fix point for the desk's reasoning:** the reconciliation must be "same path, partial suppression", not "different paths".

🛑 **T3 — I SETTLED `AR-660` ARM B's `[UNMEASURED]` MECHANISM.** The worker predicted `ts_event` 08:45 would land in the blackout window and invert the mask into a *trading* arm; it produced 0 trades and the worker wrote "`[UNMEASURED]` why — the mask builder may not parse a `datetime` series". `[MEASURED HERE]` **The parser is fine; the window was wrong.**

```
08:45  str(v)='2024-03-04 08:45:00'  [11:16]='08:45'
   UTC builder -> True=50/50   ET builder -> True=0/50
18:15  -> UTC mask True=0/50   (IS blacked out)
```

With no `ts_et` column the **UTC** builder runs, whose windows are 12:30-14:00 and 18:00-19:30 UTC. `08:45` sits in the **ET** morning window but in **neither UTC window** → mask all-`True` → total suppression → 0 trades. ARM B *did* confirm the inversion; only its stated mechanism was wrong. The parser demonstrably reads `datetime` objects (`18:15` → `True=0`, i.e. correctly blacked out).

### T4 — Claim 2's absence, and the level-mismatch

`[MEASURED HERE, positive-controlled]` `ending_balance`/`starting_balance` appear **0 times** in `backtester.py` (grep exit 1 on the pinned blob). Spelling census across snake/camel/hyphen/case: **103 hits repo-wide, none in `backtester.py`.** Positive control on the same method: a planted token was found (planted → 1, clean → 0).

⚠️ **The "only writer" clause is imprecise.** `[MEASURED HERE]` `prop_sim.py:465` writes **`ending_balance`**; **`starting_balance` is written at `:456`** — a different line. The claim's join key names one line for two fields.

🛑 **T4 — INV-1 IS NOT STARVED, IT IS TAUTOLOGICAL. The distinction is the whole finding.** `[MEASURED HERE]` `invariant_harness/core.py:171-177`:

```python
starting = _safe_float(result.get("starting_balance", _STARTING_BALANCE))
total_return = _aggregate_metric(result, "total_return", 0.0)
ending  = _safe_float(result.get("ending_balance", starting + total_return))   # :173
expected_ending = starting + total_return                                      # :175
diff = abs(ending - expected_ending)
passed = diff <= TOLERANCE
```

`ending`'s default **is the expression it is then compared against**. Executed against the real input shape:

```
ARM 1 (no ending_balance key, as production always is):
  total_return=-16.22     passed=True  diff=0.0000
  total_return=-7000.0    passed=True  diff=0.0000
  total_return=12345.67   passed=True  diff=0.0000
ARM 2 falsification sweep: 44 absent-input shapes -> 0 produced a FAIL
```

A starved check is *silent*; this one **actively reports PASS at `severity="CRITICAL"` on every production backtest, and always has.** "Works when fed, input never arrives" is directionally right and materially understates the defect class. `[ARTIFACT-SOURCED]` note in fairness: the worker's **own** `AR-658 §1` states this correctly ("TAUTOLOGICAL ON EVERY REAL BACKTEST … `ending`'s DEFAULT IS *LITERALLY* THE EXPRESSION IT IS THEN COMPARED AGAINST"). **The weaker wording is an artifact of restatement into Claim 2, not of the worker's measurement** — the obligation was lost in translation, and it is the stronger statement that should carry forward.

🛑 **T4 — THE REMEDY CLAIM 2 IMPLIES WOULD MANUFACTURE A FALSE CRITICAL.** `[MEASURED HERE]` `prop_sim.py:457-462` documents the field the claim points at:

> `ending_balance` reflects the DLL-cap SIMULATION … When > 0, `ending_balance` is artificially **HIGHER** than the strategy's real P&L. Operators MUST read `ending_balance_uncapped` for real-economics view.

Feeding `prop_compliance[firm]["ending_balance"]` into INV-1 fails **by design** whenever `dll_capped_losses_total > 0`. `[ARTIFACT-SOURCED]` `AGENT-REPORTS.md:66` already carries the standing warning: "**DO NOT POINT `INV-1` AT `prop_compliance[firm]["ending_balance"]`** … `INV-13` already owns the uncapped figure." `[MEASURED HERE]` and INV-13 (`_check_per_firm_endings`, `:744-798`) does exactly that, correctly, with a working path to red — positive control: clean uncapped → `passed=True`, inflated uncapped → `passed=False, 1/1 firms failed`.

**Level-mismatch clause: CONFIRMED.** `[MEASURED HERE]` the value exists only nested under `prop_compliance[firm]`; the top-level result dict INV-1 reads has no such key. `[ARTIFACT-SOURCED]` frozen witness `docs/replay-results/inv-reachable-keys-2026-08-03.json`, `ending_balance_reachable: false` over 64 union keys.

🛑 **T4 — SEVERITY IS INVERTED AGAINST INFORMATIVENESS (novel).** `[MEASURED HERE]` the **tautological** INV-1 is `severity="CRITICAL"` (sets `overall_passed=False`); the **correct** INV-13 is `severity="WARNING"` (never does). The check that cannot fail is the blocking one; the check that can is the non-blocking one. This compounds a finding from my prior grade in this lineage: `WARNING` severity is a dead end with zero blocking readers.

### T5 — The `$7,000` figure: **the desk's absence is FALSE — it IS in a primary artifact**

🛑 **FOUND IT.** `[MEASURED HERE]` `src/engine/invariant_harness/core.py:13-15` — the instrument's **own** docstring:

```
  INV-1  balance_arithmetic
         Would have caught: Topstep ending_balance +$7K on a losing strategy
         (DLL-cap firing on EOD MTM swings inflated reported balance).
```

**The desk's measurement was right and its conclusion was wrong — it searched the wrong surface with a pattern that could not match.** `[MEASURED HERE]` I reproduced the desk's control exactly: in `GRADE-INVARIANT-HARNESS-2026-08-03.md`, `balance` → **0**, `7K`-spelling → **0**, `INV-1` → **12** (the desk's claimed 12, confirmed). Positive control on that same file: planted `$7,000`/`7000`/`+$7K` → 1 hit, clean → 0. **So the absence in that receipt is genuine — but the figure lives in the engine source, not in a grade receipt, and it is spelled `+$7K`, which the desk's `7000` pattern can never match.** A token-exact grep manufactured the absence.

`[MEASURED HERE]` **And the mechanism reconciles to the number exactly.** Reconstructing the documented case — a strategy that truly lost $3,000 with $7,000 of DLL-cap inflation:

```
starting=50000  total_return=-3000.0  ending_balance=54000.0
  -> passed=False
  -> ending_balance = 54000.00, diff = 7000.0000
  -> "ending_balance drifts by $7000.00 from expected $47000.00.
      Possible DLL-cap inflation or MTM-swing accounting error."
```

The engine's own evidence string returns **`$7000.00`** and names **DLL-cap inflation**. Corroborating source: `prop_sim.py:138` "Topstep `ending_balance` LOOK profitable on losing strategies", and the named quantity is `dll_capped_losses_total` (`prop_sim.py:467`) = `ending_balance − ending_balance_uncapped`.

**Disposition:** the operator's `$7,000` is **authorized as evidence**, sourced to `src/engine/invariant_harness/core.py:14` (`+$7K`) with mechanism at `prop_sim.py:457-462`. ⚠️ Precisely: the artifact establishes the **figure to one significant figure and its mechanism**; the exact string `$7,000` appears nowhere. `R-617 §6.2`'s order to build the negative control on a *derived* discrepancy instead should be **revisited** — the number has a primary source.

### T6 — Novel hunt: is `:7503` dead?

**Settled — the desk's correction is right, and I can name the mechanism of the original error.**

`[MEASURED HERE]` AST enclosing-chain: `backtester.py:7503` = `def run_class_backtest` (6541-8000) → `if trades_records is not None` **[BODY]**. It is **byte-identical to its DSL twin `:5323`** (`profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")`) inside the **same guard shape**. `run_class_backtest` has many live callers (`walk_forward.run_walk_forward_class`, `scripts/confluence-overlay-ablation.py:55`, `scripts/exit-policy-replay.py:121`, `scripts/filter-ablation-cpcv.py:134`, `scripts/corpus-v3-*`). **`:7503` is live, reachable code — "dead" is false.**

`[ARTIFACT-SOURCED]` `AR-658` measured it executing `0×` across 90 backtests with a genuine positive execution witness. **Both are true and not in conflance:** the 90-backtest population drove `run_backtest` (`HIT5323 × 60`), so `:7503`'s *enclosing function was never entered*. A branch shown 0 times in a population that never calls its function is a **presence-derived denominator**, not evidence of deadness. The desk's stated diagnosis — an over-claim from a 0-execution count on one population — is **CORROBORATED**, and the residual risk is that `profit_factor` still has **no engine anchor on either path** (`AR-657 §1`), so `:7503` is both live and unverified.

---

## NEGATIVE CONTROLS (every one I ran)

| # | Claim needing a path-to-red | Control | Result |
|---|---|---|---|
| 1 | consumer treats `True` as BLOCK | all-`True` arm must **differ** from `None`; all-`False` must **equal** it | ✅ `all-True == None? False` · `all-False == None? True` |
| 2 | fixture is not vacuous | unmasked arm must yield non-zero entries | ✅ `271/128` |
| 3 | INV-1 predicate *can* fail | supply `ending_balance` = 57 000 vs 50 000+1 000 | ✅ `passed=False, diff=6000` |
| 4 | INV-1 unfalsifiable on real shape | adversarial sweep, 44 absent-input shapes incl. ±1e9/±inf | ✅ **0 fails** |
| 5 | INV-13 can fail | inflate `ending_balance_uncapped` too | ✅ `passed=False, 1/1 firms failed` |
| 6 | `$7K` absence in the grade receipt is real | plant `$7,000`/`7000`/`+$7K` into a copy | ✅ planted → 1, clean → 0 |
| 7 | `event_calendar` never assigned | same assignment-shaped search on siblings | ✅ `fill_model` 23, `exit_engine` 26 vs 6 decl/read-only |
| 8 | no strategy builds its own mask | plant `event_mask`/`blackout`/`sit_out` into a strategy copy | ✅ planted → 1, clean → 0 |
| 9 | mask builder parses `datetime` | a timestamp inside a UTC window must blacken | ✅ `18:15 → True=0` |
| 10 | materialised copy is faithful | `sha256(objectDB)` vs `sha256(copy)` + file count + CR count | ✅ 7/7, 7 vs 7, 0 CR |

---

## FAILURES (mine, disclosed)

1. **My own fixture carried a wrong expectation label.** I annotated `13:15 → expect UTC mask True=1`; it measured `0`. The **code is right** — `13:15` = 795 min *is* inside the UTC morning window `12:30-14:00`. My comment was wrong, the measurement was not, and no conclusion rested on the label.
2. **A pathspec bug manufactured a false absence in my own work.** `git grep -l 'def compute' -- 'src/engine/strategies/**/*.py'` returned **0**, because `**/*.py` does not match files sitting **directly** in that directory. Re-measured with `-- 'src/engine/strategies/'`: **26 files, all with `compute`.** Had I trusted the first result I would have published "no strategy defines compute".
3. **A hash-type confusion nearly produced a stale finding** — see the near-miss under INPUTS. Comparing a git SHA-1 against a sha256 read as a mid-grade file mutation.
4. **My arm counts differ from the worker's absolute numbers** (`271/128` vs `32/33`). This is fixture/seed/config divergence, not a discrepancy; only the arm *structure* is load-bearing and it matched.

---

## COVERAGE

**Verified, and via which two-plus non-overlapping paths:**
- *Polarity inversion* — (a) behavioural arms through the real `generate_signals`; (b) AST-lifted real producer executed on real timestamps; (c) docstring + array-initialiser reading at `:3916`/`:3924` vs `:275`/`:288`. Three paths, no shared instrument.
- *Suppression magnitude* — (a) my ET fixture (92.5%); (b) the smoke generator's own data via the UTC builder (76.89%). Different data, different builder, same conclusion: **not 100%**.
- *Which path the battery drove* — (a) my AST enclosing-chain putting `:5323` inside `run_backtest`; (b) AR-658's independent execution witness. One leg mine, one leg the desk's own.
- *INV-1 tautology* — (a) executed 44-shape falsification sweep; (b) source read of `:173` vs `:175`; (c) the frozen 64-key artifact.
- *Boundary* — (a) polarity of **both** producers; (b) exclusion sweep over class path / strategies / compiled-spec / the 3-file mask surface.

**Absence claims and their positive-control witnesses:** all eight absence claims I make are listed in the NEGATIVE CONTROLS table with a live planted-bad or sibling-field witness. I assert no absence without one.

**Join keys checked for every "identical/unchanged/matches" claim:** blob SHA-1 per file at *both* heads and in the worktree (5/5 identical); sha256 object-DB-vs-copy (7/7); `_masked_bars` vs `event_mask.sum()` as complements; `:5323` vs `:7503` compared as source text *and* AST guard shape; `ending` vs `expected_ending` as the same Python expression.

### What I did NOT verify

1. **I never executed a full `run_backtest` or `run_class_backtest`.** Every runtime result is `generate_signals` + the AST-lifted producers + `invariant_harness.core` in isolation. The end-to-end trade/P&L consequence of the inversion is **inferred**, not measured. This is the single largest gap and the cheapest to close now that the engine is known to import in ~1.0s.
2. **I did not run the 90-backtest battery.** The `60/90` leg of my T3 refutation is `ARTIFACT-SOURCED` from `AR-658`, not re-measured. It is the desk's own witness, which is why I consider it sufficient to refute the desk's claim — but it is **not** a second independent path to the number 60.
3. **I did not identify which script the 90-backtest battery is.** My refutation does not depend on it (it turns on `:5323 ⊂ run_backtest`), but "the battery" remains `[UNENUMERATED]`.
4. **`vectorbt` never imported** — per brief. Any defect that only manifests through the vectorbt portfolio path is outside this grade.
5. **The main repo `trading-forge/trading-forge` was NOT examined.** `R-613 §4.2`'s both-trees obligation remains open; that tree is substantively diverged and every finding here is scoped to `wt-h1-wave4-20260712`.
6. **`runtime-production` not touched, not read.** So whether the inversion reaches live/paper signal generation is **`[UNENUMERATED]`** — and given the DSL fallback is now known to be universal, that is the question I would ask next.
7. **No pytest suite run.** `test_class_event_mask_parity.py`, `test_inv1_unfalsifiable_r615.py` and `test_invariant_harness.py` were **read, not executed**; whether they run in CI is `[UNENUMERATED]`.
8. **I did not verify that any invariant failure propagates.** The `try:` swallow at `backtester.py:5939` remains unadjudicated. INV-1 could be fixed and still have no reader — unchanged from my prior grade in this lineage.
9. **I graded no fix.** Per the operator's ruling I patched nothing; measurement only.

---

## DISPOSITION

1. **Claim 1 — accept the mechanism, strike the number.** The polarity inversion is a real, live `CRITICAL` at `backtester.py:3924`/`:3947` against `signals.py:288`. **Replace "suppresses 100% of entry signals" with "suppresses all entries EXCEPT those inside the blackout windows — measured 76.89% on the `--smoke` corpus, 92.5% on a 400-bar ET walk, and 100% only when the data contains no blackout-window bars."** The corrected statement is worse than the original: **the engine trades only during macro events.**
2. **Claim 2 — re-characterise before any repair.** INV-1 is **tautological**, not starved (44/44 absent-input shapes PASS at `CRITICAL`). **Do not** plumb `prop_compliance[firm]["ending_balance"]` into it — that field is deliberately DLL-cap-inflated and INV-13 already owns the correct uncapped check. The defensible repairs are: make INV-1 **fail closed on absence**, and reconcile the severity inversion (tautological check `CRITICAL`, correct check `WARNING`).
3. **Claim 3 — withdraw the reconciliation, keep the boundary on new evidence.** "That is why 60 of 90 took trades" is **false**; those 60 ran `run_backtest`. The boundary claim is true but must be re-sourced from the two producers' polarity and the exclusion sweep, **not from a code comment**. A comment is documentation; this one happened to be right.
4. **`$7,000` is authorized as evidence** — `src/engine/invariant_harness/core.py:14`, mechanism `prop_sim.py:457-462`. `R-617 §6.2`'s derived-discrepancy workaround is no longer necessary.
5. **`:7503` is NOT dead.** The desk's correction stands. Residual: `profit_factor` has no engine anchor on either path.
6. **Escalation — single-source truth.** The `60/90` figure now has exactly one source (`AR-658`). Until a second exists it is **unverifiable**, and it is load-bearing for the desk's reasoning about blast radius. Re-run the battery under an independent harness before it carries any further weight.
7. **Priority order, on measured severity:** the polarity inversion outranks INV-1. `[MEASURED HERE]` the `if` branch at `:3892` is unreachable, so **every** DSL backtest takes the defective fallback — the inversion is not an edge case, it is the default, and it silently selects for the highest-risk bars in the session while printing a masked-bar count that names the complement.

---

*Grader: `accuracy-validator` · R-617 · 2026-08-03 · tree `wt-h1-wave4-20260712` · verdict valid at `4776093f76436a1892504f13062f99db59af4ecb` and `5154ab9a9e9996dd57a210146f8c114c449201c4` (all five graded code blobs byte-identical at both).*
