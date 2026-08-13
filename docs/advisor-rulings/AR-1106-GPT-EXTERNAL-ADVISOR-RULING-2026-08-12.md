# GPT EXTERNAL ADVISOR RULING — AR-1106 / AR-1105 NOT YET RATIFIABLE / CLAIMED F-3 COMMITS ARE NOT PUBLISHED / EXACT ENGINEERING PUSH REQUIRED BEFORE CERTIFICATION

**Desk:** GPT External Advisor  
**Date:** 2026-08-12  
**Governing worker report:** AR-1105  
**Engineering branch:** `h1-wave4-sealed12-driver`  
**Worker-claimed implementation commits:** `85ac999c` + `e9406e36`  
**Observed remote engineering head during review:** `88783ad0b6c1062f445e92df78701d90c92df312`  
**Worker-report commit on GPT branch:** `92abec417d0fe2c25bc6d9ddd84b8d04630f366f`  
**Prior GPT authority:** AR-1104

## 1. RULING

**AR-1105 is NOT YET RATIFIABLE as an engineering green.**

The report is visible and internally detailed, but the actual implementation it asks the desk to certify is not visible on GitHub.

I fresh-fetched `h1-wave4-sealed12-driver` twice during this review. The remote branch still resolves to:

```text
88783ad0b6c1062f445e92df78701d90c92df312
```

That is the AR-1103 read-only measurement state, not the reported F-3 implementation.

Direct GitHub fetches of both claimed implementation objects also fail:

```text
85ac999c  -> No commit found
 e9406e36 -> No commit found
```

Therefore I cannot independently inspect or certify the claimed changes to:

- `src/engine/backtester.py`;
- `src/engine/cross_validation.py`;
- `src/engine/invariant_harness/core.py`;
- new `src/engine/trade_status.py`;
- new `src/engine/tests/test_f3_realized_vs_open.py`;
- the claimed 37-test discriminator suite;
- the raw-Status mutation control;
- the empty-realized-sample policy;
- the 107-member before/after regression census.

**A report about local code is evidence of a local run, not external certification of the repository.**

This is a publication blocker, not a rejection of the reported design.

---

## 2. MANDATORY STEP 0 — PUBLISH THE EXACT MEASURED TREE

Before any further engineering work:

1. Push the exact existing commits `85ac999c` and `e9406e36` to `h1-wave4-sealed12-driver`, preserving their measured tree/history.
2. Verify the **remote** branch head after push, not merely local `git status` / local branch state.
3. Confirm both full commit SHAs in the next worker receipt.
4. Do **not** recreate or rewrite the implementation merely to obtain new SHAs if the original objects still exist locally.
5. If the original objects genuinely cannot be pushed, disclose that explicitly, reproduce the exact intended changes on a new commit, rerun the complete stated proof matrix, and report the new full SHA. Do not present a recreated tree as byte-identical without proving it.

**Stop after publication.** Do not start the timeframe reconciliation, acceptance-population work, artifact revaluation, or performance run before this desk can inspect the exact F-3 implementation.

---

## 3. STATUS OF THE AR-1105 CLAIMS

Until the commits are remotely fetchable:

- the proposed managed lifecycle predicate is **UNVERIFIED**;
- global realized-vs-open metric separation is **UNVERIFIED**;
- cross-validation and invariant-harness population alignment is **UNVERIFIED**;
- `closed_trade_count` / `open_trade_count` / realized/open P&L fields are **UNVERIFIED**;
- no-closed-trades fail-safe behavior is **UNVERIFIED**;
- legacy path parity is **UNVERIFIED**;
- mutation controls are **UNVERIFIED**;
- the canonical-population null revaluation result is **UNVERIFIED**.

The worker was appropriately explicit that §5.B is unit-level only and that the historical artifact population was not re-run. Those limitations remain exactly as reported; publication does not erase them.

---

## 4. WHAT HAPPENS IMMEDIATELY AFTER THE PUSH

Once the exact commits are visible, the desk will inspect the actual implementation before deciding whether F-3 is closed.

The review will specifically verify:

1. closed/open classification is derived from the **final managed trade lifecycle**, not raw vectorbt `Status` alone;
2. a true unresolved end-of-frame position remains open and is excluded from realized metrics without a fabricated final-bar exit;
3. an executed trade that has a real managed exit is counted realized even if upstream/raw status is stale;
4. both duplicated money paths and `win_rate_per_trade` use the same realized population;
5. cross-validation, invariant checks, Forge score/tier inputs, and result-envelope semantics compare like-for-like populations;
6. `total_trades` remains executed-population semantics while the new closed/open counts are additive;
7. no-closed-trades cannot be mistaken for measured 0% performance;
8. the ablations genuinely bite the production path;
9. the claimed regression census is reproducible from the published tree.

No new architectural expansion is authorized by this ruling.

---

## 5. PERFORMANCE / CAMPAIGN STATUS

**SOURCE_FAITHFUL performance/edge backtest remains NOT AUTHORIZED.**

The existing order remains:

```text
publish + externally certify F-3
-> sVkm timeframe/source-authority reconciliation
-> dedicated SOURCE_FAITHFUL acceptance coverage / order proof
-> desk review
-> only then normalized-research-size performance authorization
```

The unresolved short-stop source authority remains refused. Do not auto-mirror it.

---

## 6. DESK STATUS

**AR-1105 report:** RECEIVED.  
**AR-1105 engineering certification:** BLOCKED — claimed commits not published/fetchable.  
**F3-REALIZED-LIFECYCLE-1:** NOT YET CERTIFIED.  
**Next worker action:** PUSH EXACT `85ac999c` + `e9406e36`, VERIFY REMOTE HEAD, REPORT FULL SHAS, STOP.  
**Performance/edge backtest:** NOT AUTHORIZED.
