# ALGO-003 — Custody closure delivered; baseline NOT yet rerun; two published verdicts retracted

**Answering ALGO-002 §9 in its own order.** Project: ALGO / `MNQ-V2.4-ZONE-CANDLE-PC3-FORCE1`,
PR #38, **DRAFT / DO NOT MERGE**.

Operator order 2026-08-21, recorded here because it changes the reporting contract: *"for now
on dont report to me only advisor."* He is no longer a reporting destination. Findings,
corrections and status come here. Still reserved to him: real capital, spend, irreversible
destruction, blast radius I cannot bound, and facts about his own intent that no artifact
records.

Pre-flight on ALGO-002 ran clean: every premise measured true, nothing had already landed, no
contradiction. Executed without a round-trip.

---

## 1. Exact current strategy SHA

`27854bac8d7e91ffb3d04f1dc3bfb1a06541daaa` on
`research/current-mnq-strategy-v2-4-zone-first-candles`.

Commits since ALGO-001 (`811894aa`): `bac90948` custody closure, `27854bac` ledger corrections.

## 2. Exact-head workflow conclusions

At `27854bac`:

| workflow | conclusion |
|---|---|
| CI | **SUCCESS** |
| Current MNQ Strategy v2.3 Production Gates | **SUCCESS** |
| Current MNQ Strategy v2.4 Zone + Candle Production Gates | **SUCCESS** |
| Metric Snapshot Regression | **SUCCESS** |
| Trading Forge Fast Lane | **SUCCESS** |
| Current MNQ Strategy v2.4 Human-Bot Replay Lab | IN PROGRESS |
| Current MNQ Strategy v2.4 5m Fidelity Calibration | IN PROGRESS |
| Current MNQ Strategy v2.4 Development Diagnostic | IN PROGRESS |

**I am NOT claiming all exact-head gates green**, per your §Phase-0 stop condition. Three are
still running. Gate 2 (Replay Lab) specifically remains "fix is correct, gate not yet green" —
your stop condition, honoured.

Local suite at this head: 8 failed / 982 passed. The 8 are pre-existing and byte-identical to
the `7e79d082` baseline set.

## 3. Evidence-custody closure results and hashes

### 3.1 Labels re-seal — AND A CORRECTION TO THE PREMISE EVERYONE HAS BEEN USING

`11d8dec0…` was described in ALGO-001, and by me all day, as "bytes that died with the GPT
sandbox." **That is wrong.** It is a **self-declared field inside the surviving file**:
`mnq_replay_v3_labels_FROZEN.json` carries `labels_sha256 = 11d8dec0…`, identical to the
registry. Nothing died.

It is, however, **not independently reproducible**. Nine serialisations tried — default,
compact, `sort_keys`, `indent=2`, `ensure_ascii=False`, ±trailing newline, and the raw file
bytes. None yields `11d8dec0…`. So the sealed value is **self-attested**: the file asserts its
own hash and no instrument here can check it. Same class as the 2026-08-20 seal's
unfalsifiable roles — not false, uncheckable. Both facts recorded; the sealed value preserved,
not overwritten.

Independently verifiable, and now guarded:

- file bytes `1b20b0a810df2009…`
- all **14 case IDs join the frozen manifest exactly**
- action census **4 ENTER_LONG / 3 ENTER_SHORT / 6 WAIT / 1 NO_TRADE**
- `wait_at_replay_end_count = 6`

Both match the sealed contract. No new trader labeling.

### 3.2 Thirteen 2026-08-21 screenshots — registered, then RE-SPLIT after an operator correction

First registered under one corpus-level 1m-vs-5m role. **Wrong: it was a mixed set.** Eight are
pages of the FX Replay closed-position ledger. Your §3.2 forbids inventing unique semantics per
frame — correct — but the opposite error is one role over a mixed set, and that is what I did.

Now: **8 ledger pages** (`trade_ledger_page_evidence`, DIAGNOSTIC_ONLY) + **5
timeframe-comparison pages** (`1m_vs_5m_same_move_appearance`). Disjoint, together exactly 13,
guarded. Per-file sha256 recorded for all 13; bytes not committed.

### 3.3 Ledger receipt — and **I RETRACT A PUBLISHED VERDICT**

`backtesting-analytics.csv`, sha `0282abdbb1e6562a…`, 74 rows, all `CME_MINI:MNQ`,
2025-04-02 → 2025-06-20, 28 buy / 46 sell, all closed.

**Money model solved, not assumed.** Assuming `amount` = contracts at $2/pt failed on 69 of 74
rows, worst discrepancy $23,477. Solving `rPnL/((close−entry)·dir·amount)` returns exactly
**1.0** on all 69 non-degenerate rows: **`amount` is dollars-per-point.** Dividing by $2
recovers contracts — 44 rows at the frozen **15**, 27 at 17, 3 at 20.

**RETRACTION.** I published: *"7 exact 17.25-point stops — UNSUPPORTED, the file records no
stop prices at all."* I had read `initialSL`, found it empty on all 74 rows, and published an
absence. **True of the column, false of the file.** A stop-out is recorded by its money.

MEASURED: **four** rows at realized exactly **−$517.50**, each at exactly **17.25 points**,
each at amount 30 = **15 contracts** — 2025/04/23 sell, 2025/05/13 sell, 2025/06/02 buy,
2025/06/09 sell. Arithmetic: 17.25 × 15 × $2 = $517.50.

So the relayed **7 is refuted on count (it is 4)** but its **substance is CONFIRMED** — the
frozen stop is in this ledger. **My "UNSUPPORTED" was the worse of the two errors: refuting a
true thing is more damaging than miscounting it.**

Also corrected: target-side exits measured **61**, relayed 62. Confirmed: 74 rows, 28/46, 5
scratches.

### 3.4 The eight ledger screenshots — **§3.3's reconciliation is now DONE**

I had reported them `NOT_RECONCILED — not supplied to this seat`, **in the same commit that had
already registered them under the wrong role.** The operator pointed at them by filename.

Join on `(dateStart, side, entryPrice)`, comparing close and realized:

| screenshot row | CSV | verdict |
|---|---|---|
| 2025/06/20 sell 22090.25 → 21941.75, +4455.00 | identical | match |
| 2025/06/09 sell 21829.50 → 21846.75, −517.50 | identical | match |
| 2025/05/13 buy 21093.25 → 21250.50, +4717.50 | identical | match |

**Same ledger, agreeing to the cent.** And they settle the money model from a second source:
every CSV row in the screenshots' date range (2025/05/13–06/20, 30 rows) carries `amount 30`,
while the screenshots show "15 contracts" on every row. The 17- and 20-contract rows are all
earlier than that range, so nothing contradicts them. Their `Initial SL` column also reads
`N/A`, independently corroborating that deriving the stop from the money was the only route.

### 3.5 Fingerprint

The receipt is in `build_contract.contract_files`; a regression proves it. Custody regression
`tests/test_current_mnq_strategy_v2_4_custody_closure.py` (8 tests) red-proofed against 21
mutation arms across two rounds — every arm red, byte-exact restore.

## 4. Was the 14-case baseline rerun?

**No.** Custody closed first, per your §3 reorder. This is the next packet.

## 5. Per-case mismatch census

**Not applicable — no rerun.** The relayed `6/14`, `0 opposite-direction`, `0 in-window
bot-only` and `~24 blockers` remain **not current truth**, exactly as you ruled.

## 6. Evidence that changes the ordered defect queue

**None.** Your order stands: (A) decision-time target map, (B) Mar 31 reclaim lifecycle,
(C) six pre-window signals.

One input for (A) that is now firmer: the ledger's exit distribution is available as a TP/exit
diagnostic — 61 target-side, 8 other, 5 scratch, 4 stop-outs — and is bound DIAGNOSTIC_ONLY
with a test forbidding it from selecting any rule or threshold.

## 7. Latency / runtime for the regrade

**Not applicable — no regrade run.** Recorded so it is not silently skipped when there is one.

## 8. Explicit statement on PnL

**No PnL, realized outcome, winner/loser status or later-session information participated in
any decision in this packet.** The only fidelity-relevant repairs were the two red gates, both
decided on contract text and commit chronology. The ledger's money was used solely to *derive
the stop family* and to reconcile screenshots to CSV — never to select a rule, threshold or
parameter, and a test enforces that.

---

## 9. Open, and what I intend next

Still open from your ruling:

- **3h53m48s video** — `UNENUMERATED`, ~0.001% coverage. Your §6 bounded-census method
  accepted; not started; not blocking.
- **Three 2026-08-20 sealed video roles without recorded method** — recorded, deliberately
  unrepaired, per your §7 and because re-deriving sealed roles is not this seat's to authorise.
- **CI-gate class guard** — accepted as covering the *currently enumerated* assertion syntaxes
  only, not "all gate literals." Your AST/extract requirement is logged against FIDELITY→FREEZE.
  I will not overclaim it.

**Intended next packet, absent a contrary ruling: the 14-case regrade at the exact head**, with
the per-case scorecard fields you enumerated in §4, no PnL in the comparison, and an independent
grade behind it.

**One correction I owe on my own conduct:** three separate times in this packet an instrument
returned an empty result and I nearly published it as a finding — a screenshot enumeration that
returned zero because filenames contain spaces, a heredoc extraction that yielded an empty
script, and the `initialSL` column above. The first two were caught by refuse-on-zero controls I
had added. **The third was caught by the operator.** That is the wrong order and I am treating
the empty-result class as the standing hazard in this lane.
