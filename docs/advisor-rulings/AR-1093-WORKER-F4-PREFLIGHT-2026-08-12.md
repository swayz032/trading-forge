# AR-1093 (worker) — F-4 §6 PRE-FLIGHT, MEASURED AND RECORDED BEFORE ANY PRODUCTION EDIT

**Governing:** AR-1092 §6 (six pre-flight questions), §7 (constraints), §8 (proof matrix P1–P8), §9 (stops)
**Pin at pre-flight:** `7f518040` · **Tree:** `wt-h1-wave4-20260712` / `h1-wave4-sealed12-driver`

> AR-1092 §6: *"Before changing production code, measure and record the smallest existing reuse path."*
> This file is that record. It is committed **before** the first production edit, deliberately, so the
> order of operations is auditable rather than asserted.

---

## Q1 — WHERE IS POSITION OCCUPANCY CURRENTLY OWNED? `[MEASURED HERE]`

**`vbt.Portfolio.from_signals` at `src/engine/backtester.py:7814`**, driven by `entries_pd` / `exits_pd`
(built at `7592`–`7593` from the `entry_long` / `exit_long` columns).

Occupancy is owned **entirely inside vectorbt**, and it is decided **before** any Trading Forge source
logic runs. The collapse mechanism, stated as a chain of measured lines:

| step | line | what happens |
|---|---|---|
| exits array is empty on the source arm | `7593` | `exit_long` is framework-owned; no source strategy sets it |
| portfolio built | `7814` | vectorbt opens on the first entry and **never sees a reason to close** |
| population frozen | `7831`–`7832` | `pf.trades.count()` → `1`; `trades_records` has ONE row |
| source management runs **after** | `1095` | `_apply_source_fixed_r_management` iterates `trades_records` |

★ **The source engine is downstream of the decision it needs to influence.** It can re-price the one
trade vectorbt made; it cannot create the trades vectorbt refused. That is F-4, and it is now measured
at the line rather than relayed from the grade.

---

## Q2 — CAN `_apply_source_fixed_r_management` BE MADE AUTHORITATIVE **DURING** EXECUTION? `[MEASURED HERE]`

**Yes, and its arithmetic needs nothing from vectorbt.** Read at `backtester.py:1095`–`1163`, its
per-trade inner loop consumes only:

- `entry_idx`, `entry_p`, `direction` — available from the source event audit, not only from a trade record;
- `structural_stop_map` — already built pre-portfolio by `_build_source_stop_map` (called at `7453`);
- `r_multiple` — read off the persisted artifact;
- `high_np` / `low_np` / `open_np` — the executed frame.

Its **only** vectorbt couplings are (a) reading `Entry Idx` / `Avg Entry Price` off a `trades_records`
row and (b) using `original_exit_idx` as the scan's upper bound. Both are supplied equally well by a
pre-portfolio caller. **The scan itself is already causal:** `for bar in range(entry_idx + 1, ...)`
tests `low/high` against a stop and target that are **fixed at entry**, so the exit bar depends only on
bars at or before it.

⇒ **This is an EXTRACTION, not a new engine.**

---

## Q3 — DOES A SEQUENTIAL open → managed exit → flat → next-entry PRIMITIVE ALREADY EXIST? `[MEASURED HERE]`

**YES — and this is the prior art that decides the architecture.**

**`_apply_dsl_stop_loss_and_time_stop`, `src/engine/backtester.py:3597`.** It is a forward bar loop that:

- tracks occupancy in `in_long` / `in_short` (`3846`, `3853`);
- computes a stop price **at entry** and holds it;
- writes `exit_long_out[i] = True` when the bar breaches it (`3849`);
- sets `in_long = False` in the same breath (`3850`), **releasing the state so a later entry survives**;
- clears occupancy on pre-existing exits too (`3861`–`3864`);
- and it runs **pre-portfolio**, feeding its arrays into `from_signals`.

★ **F-4's required shape already exists in this file, in the class path, one bypass away.** It is
skipped for SOURCE_FAITHFUL (`7696`) — correctly, because its *content* is the house ATR ceiling and the
15:55 flatten, which are not taught. **The bypass was of the house RULES; it silently also gave up the
OCCUPANCY RELEASE, and nothing replaced it.**

⇒ The repair reuses this **architectural slot and state-machine shape** with source-owned arithmetic.
No second strategy engine, no parallel simulator.

---

## Q4 — CAN VECTORBT ITSELF CARRY THE PER-TRADE SOURCE STOP/TARGET? `[MEASURED — AND THE ANSWER IS NO, DELIBERATELY]`

**Measured, not assumed.** `from_signals` at `7814` is called with `close`, `entries`, `exits`,
`short_entries`, `short_exits`, `size`, `freq`, `init_cash` — **no `sl_stop`, no `tp_stop`, no `price=`
array.** The codebase states why at `5487`:

> *"This is cleaner than passing `price=` arrays to `vbt.Portfolio.from_signals` because our stop logic
> is already pre-computed in signal arrays and we own all P&L math."*

And at `7809`: *"vectorbt handles SIGNAL TIMING only — no slippage/fees. We compute all P&L ourselves."*

Delegating stop/target to vectorbt would hand **exit-price authority** to an engine whose gap-through,
same-bar stop-vs-target ordering, and entry-candle-exclusion conventions are **not** the ones this
campaign certified (conservative stop-before-target at `1140`–`1163`; entry-bar exclusion via
`entry_idx + 1`). That is exactly **AR-1092 §9.3 — two authorities**.

⇒ **DO NOT DELEGATE.** vectorbt keeps signal timing and occupancy; Trading Forge keeps source exit
semantics and P&L. This preserves the existing, already-certified division of authority instead of
inventing a new one.

---

## Q5 — WHERE DOES THE SINGLE SOURCE OF TRUTH LIVE AFTER THE REPAIR? `[DESIGN — PRE-REGISTERED]`

**One helper, two callers, one arithmetic.** The per-entry scan currently embedded in
`_apply_source_fixed_r_management` is extracted verbatim into a single function of the shape

```
(entry_idx, entry_price, is_short, structural_stop_map, r_multiple, ohlc, scan_bound)
    -> (exit_idx, exit_price, exit_reason, risk_points, stop_basis)
```

- **Pre-portfolio occupancy pass** calls it to decide where each accepted source entry closes, and
  writes that bar into `exit_long` / `exit_short`.
- **Post-portfolio `_apply_source_fixed_r_management`** calls **the same function** to re-price each
  resulting trade record.

They cannot disagree, because **there is only one implementation of the arithmetic** — which is the
literal requirement of AR-1092 §9.7 and §7's "no two independent source exit engines".

**Overlap policy (§8 P2), chosen and to be made explicit:** while a source trade is open, later source
entry events are **rejected and COUNTED**, never silently dropped. sVkm does not teach pyramiding. The
count is surfaced in audit metadata so the suppression is *documented policy*, not a vectorbt accident.

---

## Q6 — WHICH LEGACY / `TF_OVERLAY_VARIANT` LINES STAY IDENTICAL? `[NAMED BEFORE EDITING]`

The new pass is gated on the existing `_source_faithful` flag (`7081`) and placed in the block that
already branches on it (`7696`). Therefore, named in advance:

- `_apply_dsl_stop_loss_and_time_stop` (`3597`) — **untouched**, still applied to legacy/overlay.
- `_apply_dll_halt_to_entries` (E.4) — **untouched**.
- Rollover suppression (`7609`) — **untouched**; already `not _source_faithful`.
- The `from_signals` call (`7814`) and its arguments — **unchanged for every arm**.
- `_apply_trade_management`'s ladder below `1407` (naked / stop_only / Style C / adaptive) — **unreachable
  from this change**; the `source_faithful` branch at `1400` already returns above it.
- Legacy `exit_long` arrays — untouched: the new writes happen **only** under `_source_faithful`.

**Predicted legacy/overlay delta: ZERO.** Recorded here as a falsifiable prediction, to be **measured**
by P6 rather than asserted at the end.

---

## STOP CONDITIONS — CHECKED AT PRE-FLIGHT, NONE FIRED

| § | condition | state |
|---|---|---|
| 9.1 | needs a second backtester beside `run_class_backtest` | **NO** — reuses the `3597` slot in-place |
| 9.2 | needs future-looking exits | **NO** — stop/target fixed at entry; scan reads bar `i` only (Q2) |
| 9.3 | vectorbt would become a second exit authority | **AVOIDED BY DESIGN** — Q4, no delegation |
| 9.4 | needs SOURCE_FAITHFUL walk-forward | **NO** — single-run only; the `9202` refusal stands |
| 9.5 | changes legacy/overlay population | **PREDICTED NO** — Q6, to be measured by P6 |
| 9.6 | event ↔ trade identity cannot stay 1:1 | **NO** — occupancy pass consumes the event audit directly |
| 9.7 | helper cannot be reused without duplicating arithmetic | **NO** — one extracted function, two callers (Q5) |

**VERDICT: NO CONTRADICTION. PROCEEDING TO IMPLEMENTATION UNDER AR-1092 §7–§8.**

⚠️ **HONEST LIMIT OF THIS PRE-FLIGHT:** every claim above is a read of the executable line at
`7f518040`. **None of it is yet a behavioural measurement** — the P1–P8 matrix is what converts this
design from a plausible reading into evidence, and a pre-flight that turns out wrong under P1–P8 gets
reported as wrong rather than quietly re-written.
