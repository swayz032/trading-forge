# AR-1134 (worker) — **§5.1 PREDICATE REPAIRED AND D-REAL-1 PASSES ON REAL MARKET DATA** at `05b1f3b6`. First real-data witness in this chain. §9.2 still OPEN.

**Governing ruling:** AR-1133 · **Engineering head:** `05b1f3b6` (impl `e4b9b51d`)

## 1. YOUR EXACT-GAP REFINEMENT CLOSED A HOLE IN MY PROPOSAL

I proposed "every gap a positive integer multiple". **That was insufficient and you caught it:** a pure 10m series labelled `5m` has every gap a multiple of 5 and would have passed. Your added requirement — **at least one gap equal to the timeframe exactly** — forces the series onto the declared grid rather than merely compatible with it. Implemented as ruled.

**All six required controls verified:**

| case | result |
|---|---|
| `5m` with the 65m CME halt | **PASS** |
| contiguous `5m` | **PASS** |
| `1m` with 61m halt | **PASS** |
| `1m` series labelled `5m` | **REFUSE** |
| pure `10m` labelled `5m` | **REFUSE** |
| `7m` non-multiple | **REFUSE** |

Zone-awareness, strict ascent and duplicate refusal unchanged. I kept your scope note in the code: this proves **cadence/grid compatibility, not bar-content provenance**.

## 2. D-REAL-1 — REAL WITNESS, NOT A FIXTURE

`[MEASURED, real MES 2024-03-04..08]`

```
real 5m series   1308 bars   verify_spacing() PASSED inside the supplier
real 1m series   6536 bars   the executing frame
strategy.opening_range_source_frame IS the returned real frame
the 5m came from its OWN load_ohlcv("MES","5m") read — TWO SEPARATE DIRECT READS
```

**No resampling. No fixture stands in.** This is the first real-market-data witness in this chain.

## 3. THE SENTINEL IS REMOVED, NOT ADAPTED

It asserted the loader **refuses** — true only while the AWS keys sat unexported in `.env`. Your §3 forbids a generic regression test whose expected result depends on whether operator secrets are present. Replaced by an explicit opt-in integration witness behind `TF_REAL_DATA_WITNESS=1`: **9 passed + 1 skipped by default, 10 passed with the flag.** The module docstring's now-false *"real 5m cannot be loaded"* claim is corrected in place rather than left to rot.

**No credential value was printed, logged, committed, or included in any report.** Credentials were exported into a subprocess only; `.env` and the shell profile are untouched.

## 4. STATUS

| Item | State |
|---|---|
| §5.1 predicate + D-REAL-1 real witness | ✅ **COMPLETE** (`05b1f3b6`) |
| B3 stale-auditor repair (ORDER S-A+) | ⬜ NEXT — unblocks B-DB-ROUNDTRIP-1 |
| B-DB-ROUNDTRIP-1 | 🛑 blocked behind B3 |
| Lane C — C-a approved | ⬜ authorized, NOT started |
| §9.2 | 🔴 OPEN, NOT CLAIMED |

**I accept your correction on framing:** CLAUDE.md §4 is titled *"Stop Loss — structural, NEVER fixed-point"*, so this was never a two-standing-rules collision — **the auditor is stale and inverted the actual rule.** I will not describe the AR-1056/AR-1059 teacher-stop work as if it never existed; it existed and was dead on the onboarding path because another bug kept its contract from reaching it.

**DISCLOSURES:** regression **109 passed + 1 skipped** across the role/frame/opening-range closure · one ruff failure (`timedelta` unused after my rewrite) blocked the first commit and was fixed before landing · the real-data read refreshed the 5m and 1m caches from S3, which is the loader's normal behaviour, not a change I made · no grader · no backtest · no trade · nothing certified.
