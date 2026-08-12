# AR-1078 — WORKER — **HANDOFF AT `3 / 7`, WITH THE ENTIRE B/C/D/F UNIT LOCATED LINE BY LINE.** Your §4 blocker is CONFIRMED BY MEASUREMENT, not inherited from AR-1075's report.

```
RULING  : AR-1074 (gpt-rulings d8497100) §10.B-F, §11
TREE    : C:\Users\tonio\Projects\wt-h1-wave4-20260712        [MEASURED HERE]
PIN OUT : b609f039   [MEASURED] pushed, engineering branch
FAN-IN  : A ✅ · B ❌ · C ❌ · D ❌ · E ✅ · F ❌ · G ✅   =  3 / 7
PRIOR   : AR-1076 (0a353518) harness · AR-1077 (f56f784e) STEP G
```

**This session closed G and unblocked the §11 route. It did NOT start B/C/D/F, and did not
half-start it.** Nothing is uncommitted; the working tree carries no partial source-join work.

---

## 1. WHY I AM HANDING OFF AT A BOUNDARY RATHER THAN OPENING B

AR-1075 §7 established, and I agree after measuring, that **B, C, D and F are ONE ATOMIC UNIT** —
the event join produces the map, the map needs the timing convention, the target consumes both.
**Landing any part alone leaves a half-wired production execution path in an 8,000-line money-path
file**, which this campaign has convicted repeatedly.

I have context to *locate* that unit but not to *land* it whole with the red-proofed mutation
suite §11 requires. **Starting it would guarantee the exact half-landed state AR-1075 refused to
leave.** So I spent the remaining budget making the next seat's implementation cheap instead: the
map below is measured, not inferred, and nothing in it needs re-deriving.

---

## 2. ⭐ THE JOIN MAP — every line MEASURED at `b609f039`

### B — `src/engine/spec_condition_compiler.py`
- **`compute()` @2225-2230 IS the defect site.** For `direction="both"`:
  `entry_long = entry_signal & wait_bias_bull`, where `wait_bias_bull` is **the EMA-slope proxy**.
  Your §5: the source event must become the authoritative entry event/side.
- **`_eval_fvg` @1478-1486** computes `compute_fvg_signal(...)` then returns `result.any_active`,
  **discarding `.zones` at the return statement.** Those zones are exactly what
  `select_source_entry_events` consumes — **the identity is already in hand and thrown away**, so
  no second detector is needed (your §5).
- **@2249-2256** is the strategy-level refusal boundary (entries zeroed when ineligible). A source
  join must sit BEFORE it so that boundary still governs.
- **@2271-2278** returns `entry_long/entry_short` as polars columns — **the strategy's only output
  channel today.** C, D and F all need the EVENT, not the boolean array, so **the events need a
  carrier on the strategy object.** This is the one genuinely new piece of design in the unit.

### C — `src/engine/backtester.py` @7083-7085 🛑 YOUR §4 BLOCKER, CONFIRMED FIRST-HAND
```python
if skip_eligibility_gate or _source_faithful:
    empty_stats = {"total": 0, "take": 0, "reduce": 0, "skip": 0, "skip_reasons": {}}
```
**`empty_stats` has no `structural_stop_map` key at all.** The map is normally produced INSIDE
`apply_eligibility_gate` — declared @286, written @453, read via
`gate_stats.get("structural_stop_map", {})` @554. So the source arm receives `{}`, and AR-1073's
correctly fail-closed resolver refuses **every** trade.

★ **Two individually correct pieces, jointly non-functional.** I confirmed this by reading the
executable lines rather than carrying AR-1075's account of it (`[order-premise-grade]`).

### D — `src/engine/backtester.py`
`np.roll(long_entries_np, 1)` **@7199** · `np.roll(short_entries_np, 1)` **@7201** ·
`signal_bar_idx = entry_idx - 1` **@3083** (its rationale docstring @3050-3051).
Both become mode-conditional; **legacy untouched** (§11 disc. 21).

### F — `src/engine/context/structural_targets.py:360`
`compute_source_fixed_r_target` exists, **ZERO production callers**. The thing currently blocking
execution is the **Style-C refusal at `backtester.py` @6781-6787**. F replaces that refusal with
real fixed-R execution — **not a second target engine** (your §9).

### ⭐ TRANSPORT — DO NOT BUILD A PARALLEL CHANNEL
`run_class_backtest` **already threads `structural_stop_map` through the entire management chain**:
@948, @999, @1061, @1107, @1210, @1256, @1264, @1275, @1295, @1312. **The plumbing C needs already
exists; only the map's SOURCE changes.** Adding a second channel would be the duplicate-mechanism
shape your §5 and §9 both refuse.

---

## 3. THE HARNESS IS READY — §11's ROUTE IS OPEN (detail in AR-1076)

`[MEASURED]` the real Band C `compiled_spec` route, driven through the real `main()` callback with
`load_ohlcv` patched on **both** `src.engine.backtester` and `src.engine.data_loader`,
`TF_ALLOW_FIXED_1=true`, produces `total_trades = 1` over 44 days on a deterministic fixture.

**The "no market data" blocker carried by AR-1072/1073 is measurably false.** The legacy arm now
produces a real trade population, so a source-arm refusal spy is finally DISCRIMINATING rather
than reading zero on both arms.

**Four gates the engine imposes first**, each measured and each worth minutes to the next seat:
`spec.entry_trigger_id` is mandatory · **the body key is `entry_conditions`, NOT `conditions`, and
a wrong key does not raise — it silently yields an empty binding plan whose refusal is
byte-indistinguishable from a genuine `trigger_not_bound`** · `fixed_contracts=1` needs
`TF_ALLOW_FIXED_1=true` (which is precisely your §11 1-contract fixture) · `config["strategy"]`
needs the full `StrategyConfig` shape.

⚠️ **PATCH-TARGET TRAP:** `backtester.py:54` binds `load_ohlcv` at MODULE level. The nearest prior
art patches `src.engine.data_loader.load_ohlcv` — correct for `walk_forward`, **WRONG for the class
path.** Patch both.

🛑 The probe lives in the session scratchpad and is **NOT committed**, deliberately: a harness that
lands ahead of the thing it proves is a green with no subject. It becomes a committed test file
when B/C/D/F lands.

---

## 4. STATE — NOTHING OUTSTANDING

- **No sub-agent dispatched**, nothing owed, nothing half-written.
- **Working tree:** only the pre-existing untracked `docs/` files that were there at seating.
- **Ear:** armed on `origin refs/heads/external-advisor/gpt-rulings`, red-proofed four ways
  (REFUSE non-repo cwd exit 2 · REFUSE absent ref exit 3 · SILENT on no move · EMITS on a real
  move) and **observed firing twice on this branch for real**. It dies with this seat; re-arm from
  `b609f039` / gpt-rulings head.
- **Two ORPHAN ears** live under measurably DEAD parent seats (PID 13092, PID 25336). Not killed —
  I did not arm them.

## 5. NEXT SEAT — B/C/D/F ATOMICALLY, THEN §11, THEN THE GRADE

No round-trip needed: your §10 already authorizes it and the map above removes the discovery cost.
After the vertical GREEN, **self-dispatch `accuracy-validator` on DISPROVE** — AR-1075 §4 shipped
two falsely-green tests inside this very unit, so the §11 mutation suite is the artifact most in
need of an adversary, and the doer may not grade it.

**A fresh worker session is needed.**
