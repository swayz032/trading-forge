# AR-1102 (worker) — `VECTORBT-TEST-ISOLATION-1` CLOSED. IT ALSO CONVERTED 5 FALSE GREENS INTO HONEST REDS.

**Governing:** AR-1101 §2, §3, §7A · **Pin:** `eff81854` · **Units B/C/D: NOT STARTED (see §6)**

---

## 1. YOUR §2 CORRECTION WAS THE WHOLE UNIT

I proposed a session-scoped fixture. You said that is insufficient because **pytest imports test
modules during COLLECTION, before ordinary fixture setup** — so a fixture-taken baseline would
snapshot the already-poisoned state and canonize the defect. **You were right, and it is the reason
this guard works.**

★ **`A BASELINE TAKEN AFTER THE CONTAMINATION IS NOT A BASELINE, IT IS A RECORD OF THE DAMAGE.`**

**The hook, and why it is early enough:** `pytest_sessionstart` runs **after conftest import and
before any test module is imported** — the earliest point that can observe a clean `vectorbt`
namespace. `src/engine/conftest.py` now:

1. `pytest_sessionstart` → snapshot every `vectorbt` / `vectorbt.*` key in `sys.modules`;
2. an **autouse function-scoped** fixture restores that baseline **before and after every test**;
3. `TF_MOCK_VBT=1` / `mock_vectorbt_session` remains the explicit, restoring opt-in;
4. **no production diff** — a committed test asserts `_restore_vbt_baseline` never appears in
   `backtester.py` (your §2.5).

**FAKES ARE EVICTED, REALS ARE PRESERVED.** A stub is `not isinstance(mod, ModuleType)` (a
`MagicMock`) **or** a `ModuleType` with no `__file__` (a bare stub). ⚠️ A `__file__`-only test would
miss the MagicMock entirely — `getattr(MagicMock(), "__file__")` returns a truthy auto-attribute.
Evicting a genuinely imported vectorbt would force a re-import and JIT warm-up on the next test, so
the negative control pins that a real-shaped module survives.

**I also corrected the false claim you flagged.** `mock_vectorbt_session` carried *"Inject before any
test module imports — session scope runs first."* That is untrue, and **the false claim is why this
class went unnoticed for so long.**

---

## 2. YOUR §3 MATRIX — 13 TESTS, ALL GREEN

`src/engine/tests/test_vectorbt_test_isolation.py`. **Order dependence is proven by real pytest
SUBPROCESS runs** — asserting it inside one already-configured session would be measuring the guard
with the guard on.

| § | proof | state |
|---|---|---|
| 3.1 | clean control: source suites alone | **GREEN** |
| 3.2 | poisoner A (`test_black_swan_evaluator`) → source | **GREEN** |
| 3.3 | poisoner B (`test_deepscan14_cf_commission_sentinel_b2_closure`) → source | **GREEN** |
| 3.4 | A + B → source (count, identity, sizing, schema) | **GREEN** |
| 3.5 | reverse: source → poisoners | **GREEN** |
| 3.6 | intentional-mock opt-in still reachable | **GREEN** |
| 3.7 | planted `MagicMock` evicted · planted bare stub evicted · **real-shaped module preserved** | **GREEN** |
| 3.8 | no production diff | **GREEN** |

🛑 **POISONER B IS DELIBERATELY NOT EDITED.** It still installs its stub at module scope through a
**loop variable** (which is why no literal grep ever found it). The guard must make the poisoner
harmless **without the poisoner's cooperation** — that is what makes this a class fix rather than a
23rd edit.

### THE RED-PROOF, WHICH IS THE ONLY REASON THE ABOVE MEANS ANYTHING

`TF_MOCK_VBT=1` makes the guard step aside while installing nothing — a clean ablation switch:

```
guard ON  : green
guard OFF : 10 failed, 3 errors    (identical command)
```

Committed as `test_5b_RED_PROOF_ablating_the_guard_brings_the_contamination_BACK`.
★ **`A GUARD THAT CANNOT BE SWITCHED OFF CANNOT BE SHOWN TO BE DOING THE WORK.`**

**Your §3 acceptance test now passes:** source suites under **whole-directory collection** —
`252 passed`, the only reds being two long-known baseline failures matched by `-k source` purely
because their class name contains "Source".

---

## 3. 🛑 THE FINDING YOU MUST SEE: THE GUARD MOVED THE ACCEPTANCE POPULATION

Canonical population at `eff81854` vs baseline `66c9a476`:

```
35 failed / 2384 passed / 2 xfailed     (was 32 / 2387 / 2)

NEW REDS (5):  test_pnl_accuracy  TestCommissionImpact::test_commission_per_trade_matches_formula
                                  TestWave1CommissionGoldenFixture:: mffu_mes / topstep_mes /
                                                                     prop_sim_trusts_net_pnl
               test_three_fixes   TestWFIntraMaxDD::test_equity_bars_key_present_in_backtest_result
NOW GREEN (2): test_backtester    test_zero_trade_backtest_does_not_crash
               test_pnl_accuracy  TestEdgeCases::test_no_trades_returns_zero_metrics
```

**I did not break those five. They were never passing honestly.** Measured, four ways:

1. they fail **standalone** at HEAD;
2. they fail standalone with the **guard ablated** — so the guard is not the cause;
3. they fail standalone with my **sizing-ingress line removed** — so that is not the cause either;
4. 🛑 **they fail identically — `4 failed / 2 passed` — at the BASELINE PIN `66c9a476`, in a fresh
   detached worktree, before any of my work.**

⇒ **These are pre-existing standalone failures that a leaked vectorbt mock was making PASS in
full-population runs.** The guard removed the leak, so the population now reports what the tests
actually do.

★★ **`THE ACCEPTANCE POPULATION'S "32 FAILURES" WAS ITSELF PARTLY FICTION — FIVE OF ITS GREENS
DEPENDED ON A MOCK LEAKING OUT OF AN UNRELATED TEST FILE.`**

⚠️ **This inverts deep-scan B's recorded diagnosis.** Its comment in `test_wave_a_pbo_fail_closed.py`
says the leak *caused* 3 spurious failures in `test_pnl_accuracy`; here the same leak was *causing
passes*. **Both directions are real and I am not reconciling them from the armchair** — the point is
that a leaked stub moves results in whichever direction the mock happens to satisfy.

**I have NOT touched those five tests.** Whether the commission math or the tests are wrong is a
money-path question (`test_pnl_accuracy` is commission/P&L), and it is not in my authorization.
**Recommend a bounded unit; it is now visible for the first time.**

---

## 4. THE INSTRUMENT LIE I HIT INSIDE THIS UNIT

My first version of the guard tests did `import src.engine.conftest` and asserted on its
`_VBT_BASELINE`. Three assertions failed and **one passed for the wrong reason.** Cause: **pytest
loads `conftest.py` as its own plugin module**, so a plain import creates a SECOND module object
whose `_VBT_BASELINE` is forever `None`. The guard was working; I was interrogating a dead copy.

⚠️ The false green is the instructive part: with `_VBT_BASELINE is None` the restore is a **no-op**,
so the NEGATIVE control ("a real module is preserved") passed — **because nothing was ever removed.**
★ **`A NO-OP SATISFIES EVERY ASSERTION THAT SOMETHING WAS LEFT ALONE.`**
Fixed by resolving the guard through `request.config.pluginmanager`.

---

## 5. STOP CONDITIONS — NONE FIRED

§3 stop ("whole-directory collection still changes a source trade result") did **not** fire — it now
passes. No source assertion was weakened. No production file changed. No file swept.

---

## 6. HANDOFF — B, C AND D ARE UNSTARTED, AND I AM NAMING WHY

**Fan-in on your §7: `A` DONE · `B` `C` `D` NOT STARTED.** They are **unstarted, not blocked** — I am
handing off on genuine context exhaustion, at a clean seam, with `A` landed and green rather than
leaving a half-wired unit.

**What the next seat inherits, so nothing is re-derived:**

- **B — F-3 realized-vs-open metrics.** Your §4 supplies the semantic ruling and the exact
  discriminator (2 closed winners + 1 open → `closed_trade_count=2`, `open_trade_count=1`, realized
  win rate 100%, no synthetic exit). The open-trade fixture already exists and is measured:
  `src/engine/tests/test_source_population_grade_findings.py::TestGradeF3...` uses a last session
  truncated at the decision candle (`_SESSION[:9]`), producing `entry=74 exit=74 Status=Open
  exit_reason="signal" PnL=-93.60`, `win_rate=0.6667`. ⚠️ Your §4 warns the metric code is shared —
  measure blast radius before mutating; do not special-case SOURCE_FAITHFUL if the definition is
  globally wrong.
- **C — `SVKM-TIMEFRAME-AUTHORITY-1`**, read-only. The conflict is real and unresolved: the fixture
  is 5-minute bars with a **15m** `OpeningRangeVariant`, while the money-path authority describes
  **5m OR → 1m close outside ORH/ORL → 3-candle FVG → third-candle entry**. **This may reopen the
  execution vertical**, so it should probably run BEFORE more work is built on the current fixture.
- **D — dedicated SOURCE_FAITHFUL acceptance population**, plus the freshness/inclusion test. The
  member list must include: source vertical join · Band C vertical · source trade population ·
  grade-finding closures · sizing ingress · F-3 guard · **and `test_vectorbt_test_isolation.py`**.
  ⚠️ The existing 107-member manifest must NOT be mutated (comparability) — extend, version, and
  publish members, never a count.

**Environment facts worth inheriting:** `env -u GIT_INDEX_FILE` before git plumbing · the
`inventory-freshness` pre-push hook requires `python scripts/system_inventory.py` + committing
`SYSTEM-INVENTORY.md` · the GPT branch is not a fast-forward, publish single files by plumbing · a
full (non-sparse) worktree checkout is required or committed `docs/replay-results/**` assertions
error at collection.

**No sub-agent is outstanding. Nothing is half-written in the tree. No performance/edge run was
executed and none is authorized.**

**Pin `eff81854`.**
