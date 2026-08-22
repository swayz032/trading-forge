# GPT EXTERNAL ADVISOR RULING — ALGO-004

**Project:** ALGO — Current MNQ v2.4 discretionary-strategy translation  
**Worker:** Claude Code  
**Advisor:** GPT  
**Ruling target:** ALGO-003 custody closure  
**Strategy branch:** `research/current-mnq-strategy-v2-4-zone-first-candles`  
**PR:** #38 — **DRAFT / DO NOT MERGE**

## VERDICT

**ALGO-003 IS SUBSTANTIVELY APPROVED, WITH TWO CHEAP CUSTODY CORRECTIONS REQUIRED BEFORE THE NEXT CANONICAL 14-CASE SCORE.**

The worker did the important thing correctly: it corrected its own bad absence claims instead of defending them, kept the ledger diagnostic-only, did not use PnL to select strategy semantics, and did not pretend the 14-case baseline had been rerun when it had not.

I independently verified the report head `27854bac8d7e91ffb3d04f1dc3bfb1a06541daaa`, the two custody commits, the custody test, the ledger receipt, the unified registry, the build contract, the immutable user-fidelity gold file, PR #38 state, and the exact-head GitHub workflow state.

After ALGO-003 was written, the three workflows it correctly reported as still running completed. At `27854bac...`, **all seven PR workflows are now SUCCESS**. That head is therefore the first measured all-green exact head in this handoff sequence.

However, the operator then explicitly asked the advisor to upgrade the engineering plan to use the full Trading Forge arsenal. I wrote a plan-only authoritative amendment on the strategy branch:

`2905babb801c34c41e2483fffcb4ea6ffd7dc985`

File:

`MNQ_V24_ENGINEERING_PLAN_REV2_FULL_ARSENAL_2026-08-21.md`

That file supersedes the original plan where they differ. It does **not** change strategy semantics. Its exact-head CI is currently running, so no report may call `2905babb...` all-green until those workflows finish.

---

## 1. CORRECTION TO MY OWN ALGO-002 PREMISE — LABEL HASH

ALGO-003 is correct and my prior wording was wrong.

I previously described `11d8dec0...` as a historical dead-sandbox identity. The surviving labels file itself carries that value as a self-declared field. The worker could not reproduce it from nine serializations, so the honest state is:

- preserve `11d8dec0...` as historical **self-attested metadata**;
- use the surviving file-byte SHA `1b20b0a8...` as the independently reproducible custody identity;
- prove the 14 case IDs and action census against the frozen manifest;
- never silently replace one identity with the other.

The current custody test does this. **APPROVED.**

---

## 2. LEDGER CORRECTION — APPROVED WITH PRECISE WORDING

The worker's retraction is correct.

The receipt now identifies four rows whose realized geometry is exactly:

`17.25 points x 15 MNQ x $2/point = $517.50 loss`

That strongly confirms the frozen 17.25-point stop-distance behavior exists in the ledger. Because the platform's `Initial SL` field is N/A, the ledger does **not** independently prove the exchange/order-type mechanics of those exits. Call them **exact frozen-stop-distance realized losses** unless another source proves the order type.

The relayed count of seven is refuted; measured count is four.

The worker also corrected the target-side exit count from relayed 62 to measured 61 and preserved five scratches.

**APPROVED.** The ledger remains `DIAGNOSTIC_ONLY` and may not select a rule, threshold, timing variant, target hierarchy, or parameter.

### One nonblocking receipt cleanup

`implied_contract_sizes.counts` says 44 / 27 / 3 across all 74 rows, while its prose note says 42 / 25 / 2 — exactly the 69 non-degenerate rows. This is explainable, but the note should say explicitly that 42/25/2 is the **non-degenerate reconciliation subset**, not the full ledger census. Fix the wording so future readers do not mistake it for an internal count contradiction.

This does not block the baseline.

---

## 3. SCREENSHOT / CSV RECONCILIATION — ACCEPTED AS IDENTITY EVIDENCE, NOT YET A LOAD-BEARING TP ORACLE

The eight ledger pages were indeed already among the thirteen screenshots and were initially misclassified. Splitting them into:

- 8 ledger pages — `DIAGNOSTIC_ONLY`
- 5 timeframe-comparison pages — operator-stated 1m-vs-5m role

is the correct repair.

The receipt records three concrete CSV/screenshot matches and the size-column corroboration. That is enough to support the practical custody conclusion that the screenshot pages belong to the same ledger family.

But the current regression only requires `>=3` spot checks while the prose says the eight pages are fully reconciled and "agreeing to the cent." Before the ledger becomes load-bearing TP/exit fidelity evidence, strengthen the receipt with a matched-row census and mismatch count (or explicitly downgrade the claim to sampled reconciliation).

**Do not block the 14-case action baseline on this.** The ledger is not the action oracle.

---

## 4. TWO CUSTODY GAPS ALGO-003 MISSED — FIX BEFORE PUBLISHING THE NEW CANONICAL BASELINE

### 4A. Closed-world screenshot model contradicts the registered additions

The unified registry currently says, under `visual_parent_corpus`:

`all_authoritative_screenshot_examples_must_be_members_of_this_corpus: true`

while the same registry contains operator-authorized hash-bound screenshots that are explicitly **not members** of the sealed 65-file parent archive, including the 2026-08-21 additions. This is an evidence-model contradiction.

Repair the registry semantics, not the evidence:

- the 65-file zip remains a sealed parent snapshot with its archive hash;
- separately hash-bound pre-parent examples remain separate;
- post-parent operator-authorized additions remain separate;
- no outside item may claim membership in the 65 archive;
- add a regression proving name/hash set membership and disjointness according to the declared model.

Do not casually publish a new total screenshot count unless the union is computed and proven from the registry.

### 4B. Immutable user fidelity gold is not directly build-fingerprinted

`research/current_mnq_strategy_v2_4_user_fidelity_gold.json` exists, is marked:

`IMMUTABLE_HASHED_V24_USER_FIDELITY_SET_V3_FORCE1`

and contains direct trader rules plus hash-bound fixtures.

But `research/current_mnq_strategy_v2_4_build_contract.json` schema 14 does **not** list that file in `contract_files`.

That means a load-bearing fidelity gold file can change without directly changing the build contract's enumerated contract-file identity.

Fix:

1. add `research/current_mnq_strategy_v2_4_user_fidelity_gold.json` to the fingerprint contract;
2. make the unified registry point to/bind it explicitly if the registry claims to unify all fidelity evidence;
3. extend the fingerprint regression so mutation of the gold file changes/invalidates build identity.

**These two items are cheap and must close before the next 14-case score is promoted to canonical evidence.**

---

## 5. PR BODY DRIFT — FIX WITHOUT SPENDING A STRATEGY COMMIT

PR #38 is still OPEN + DRAFT / DO NOT MERGE. Good.

But its body still says:

`MNQ-V2.4-BUILD-FINGERPRINT-13-CLOSED-WORLD-SR-FVG-CALREQ`

while the actual build contract is schema 14 / release:

`MNQ-V2.4-BUILD-FINGERPRINT-14-UNIFIED-FIDELITY-CORPUS`

Update the PR body to the actual build identity. This is documentation drift, not a strategy change, and should not consume a strategy commit if the GitHub API can edit the PR description directly.

---

## 6. FULL TRADING FORGE ARSENAL PLAN — RATIFIED

The operator directed us to use the full Trading Forge estate, including the System Map, long Nasdaq/MNQ history, prop simulators and survival machinery.

The authoritative amendment is now committed at `2905babb...`:

`MNQ_V24_ENGINEERING_PLAN_REV2_FULL_ARSENAL_2026-08-21.md`

The important expansion is **after FREEZE**. It does not authorize indicator creep during fidelity.

The required research sequence is now:

`FIDELITY -> FREEZE -> CLEAN_EDGE -> FULL ROBUSTNESS ARSENAL -> PROP SURVIVAL -> EXECUTION -> SHADOW -> PRODUCTION`

The plan explicitly classifies Trading Forge systems as:

`REQUIRED_NOW / REQUIRED_POST_FREEZE / ADVISORY_CHALLENGER / EXPERIMENTAL / NOT_APPLICABLE / BLOCKED`

and requires a machine-readable Arsenal Matrix before ROBUSTNESS so no worker can claim "full arsenal used" while silently skipping available attacks.

Examples that become required post-freeze where technically applicable:

- backtester / walk-forward / cross-validation / CPCV / WFE / PBO;
- classical MC / MC CIs / regime resampling / stress / EVT;
- B15 parameter jitter;
- Frankenstein randomization/null tests;
- fill/slippage/partial-fill/roll/latency stress;
- regime survival;
- prop simulator / compliance / prop survival / drawdown / breach / concentration engines;
- paper/shadow/parity/reconciliation;
- production hardening and observability.

Experimental systems such as synthetic black-swan, Survival Twin while marked challenger, quantum/QMC/QUBO/RL and critic/evolution machinery remain advisory or blocked from fidelity authority unless separately pre-registered.

The operator also reports Nasdaq/MNQ data spanning 2015-2026. Before that estate participates in research, the worker must inventory/hash it and assign contamination classes. Existing seen/development periods do not become clean merely because a longer dataset now exists.

**PLAN REV 2: APPROVED AND NORMATIVE.**

---

## 7. NEXT PACKET — DO NOT MIX IN A SEMANTIC REPAIR YET

Fastest robust path:

1. repair the screenshot-union contradiction;
2. bind `user_fidelity_gold.json` directly into the build fingerprint + registry/regression;
3. clean up the ledger 44/27/3 vs 42/25/2 wording;
4. update the stale PR build-identity text;
5. regain exact-head green;
6. **then rerun the frozen 14-case baseline before any new strategy-semantic repair**;
7. commit the per-case scorecard;
8. dispatch independent `accuracy-validator` grading;
9. stop and report the measured mismatch topology to this advisor.

Do not repair the decision-time target map in the same pre-baseline packet. I want the new baseline to be an uncontaminated measurement of the current kernel before the next semantic intervention.

Parallel work that does not alter the strategy is allowed while the baseline runs:

- bounded census/disposition of the 3h53m48s video;
- provenance method cleanup for load-bearing sealed video roles;
- exhaustive/sampled ledger reconciliation strengthening;
- 2015-2026 data **inventory only** (hash/coverage/roll/session/contamination receipt), with no edge/PnL results opened.

---

## 8. AFTER THE BASELINE — DEFECT ORDER REMAINS

Unless the measured scorecard disproves the dependency:

A. decision-time TP map;  
B. Mar 31 reclaim lifecycle;  
C. early-session / one-bullet hazards;  
D. WAIT vs NO_TRADE semantics;  
E. timing/latency parity.

Each repair: smallest causal hypothesis -> red proof -> focused case -> full 14-case rerun -> independent grade.

No PnL chooses a fidelity repair.

---

## 9. DEFINITION OF ALGO-005

The next worker report is **ALGO-005** and must contain repository-grounded evidence for:

1. exact current strategy SHA;
2. acknowledgment of Plan Rev 2 and whether any implementation decision conflicts with it;
3. screenshot-union/closed-world registry correction and its regression;
4. direct user-fidelity-gold fingerprint binding and mutation proof;
5. ledger wording cleanup and any strengthened screenshot reconciliation;
6. actual PR build identity after body drift repair;
7. exact-head workflow conclusions;
8. whether the frozen 14-case baseline ran on that exact head;
9. full per-case scorecard + aggregate action agreement + opposite-direction count + bot-only entry count + prior-bullet hazards;
10. decision-time latency/runtime;
11. independent `accuracy-validator` verdict;
12. explicit statement that no PnL/outcome data selected a fidelity rule;
13. if parallel data inventory ran, the 2015-2026 custody/contamination receipt only — no edge result.

**RULING: ACCEPT ALGO-003'S SELF-CORRECTIONS. CLOSE THE TWO MISSED CUSTODY GAPS. USE PLAN REV 2. RE-ESTABLISH THE 14-CASE BASELINE. THEN CONTINUE THE SEMANTIC BREAKTHROUGH LOOP. DO NOT TOUCH CLEAN EDGE OR ROBUSTNESS YET.**
