# Trading Forge — Blueprint Map

**Audit date:** 2026-05-05
**Audit basis:** A-track (14 subsystems) + B-track (14) + C-track (11) + LLM/Quantum/Scout/n8n stacks deep-scanned by 3 parallel agents.
**Verdict:** Over-engineered. Not catastrophically — but enough to slow the path to a deployed strategy. Cleanup is a higher-leverage move than adding NeMo.

---

## Executive read

You've shipped a lot. Most of it works individually. A meaningful subset overlaps, conflicts, or sits in permanent advisory mode without graduating. The cumulative effect is decision ambiguity:
- "Which firm should I deploy on?" — answered by 3 different services (B5, B14, compliance_gate)
- "Is this strategy overfit?" — tested by 4 different gates (A4, A7, MC breach, Grover)
- "Can I trade now?" — checked by 4 different safety gates (C1, C2, C4, C8)
- "What regime are we in?" — classified by 3 different models (DeepAR, C11 HMM, fusion) with no source of truth
- "Which compliance?" — 8 different code paths use the word

Each layer was added for a defensible reason. Together they form a maze you can't deploy real money in. The fix is consolidation, not addition.

---

## The 15 cleanup items (grouped)

### KILL — dead weight, no graduation path, no value

| # | Item | Evidence |
|---|---|---|
| 1 | **A11 Shadow Re-Run** | Migration 0074 + table exists; zero callers in scheduler/services. Orphaned. |
| 2 | **C4 Network Failover** | `network-failover.ts` annotates positions with `connectivityState` but never blocks any order. C1+C2 do the actual blocking. Observational-only with no consumer. |
| 3 | **`nightly_review` LLM role** | Redundant with `critic_evaluator` + `dsl_quality_critic`. All 3 output the same `{score, accept, reasoning, concerns}` schema. ~40k tokens/month for the third critique. |
| 4 | **Z4 Nightly Strategy Research Loop (n8n)** | Phase 0 audit confirmed eCr7 is multi-symbol-correct. Z4 was the ES-only one we just rewrote in Pass 11. Functionally redundant with eCr7 + cron trigger. |
| 5 | **sAIr Weekly Strategy Hunt (n8n)** | Outputs `python_code` instead of StrategyDSL JSON, bypassing the dsl_quality_critic + C9 diversity gates. Second-class citizen in own pipeline. eCr7 covers the use case. |

### GRADUATE OR KILL — Phase 0 advisories that overstayed their welcome

CLAUDE.md defines Phase 0 as Day 0-60 advisory, Phase 1 as Day 60+ hard gate. **We are at Day 120+.** These never graduated:

| # | Item | Cost | Decision |
|---|---|---|---|
| 6 | **DeepAR regime forecaster** | weight=0 for 90+ days; HMM carries 100% regime authority; train+predict+validate crons run anyway | Run W7b graduation query; flip to weight=0.05 if hit_rate>0.50 over 30d, else delete |
| 7 | **A14 Synthetic Black Swan** | 1000 synthetic regimes/run, advisory only, never blocks PAPER→DEPLOY_READY | Graduate to Phase 1 hard gate at survival_rate<0.60 |
| 8 | **B10 MRP soft gate** | Logs advisory; never blocks | Graduate or merge into Regime Fragility composite |
| 9 | **B14 prop-firm survival twin** | Phase 0 advisory; ranks firms but doesn't gate | Graduate to Phase 1 tiebreaker in `bestFirm` selection |
| 10 | **Grover Adversarial Stress (quantum)** | 100 runs/month, 30s wall-clock each, never blocks | Run W7b graduation query; if predictive value clears, graduate. Otherwise delete. |
| 11 | **A+ Market Auditor (4-qubit VQC)** | Daily 8am ET cron; advisory only; rarely consumed (requires explicit DSL opt-in) | Either delete or wire as default skip-engine input |
| 12 | **quantum_mc.py** | Runs alongside classical Frankenstein; classical does the gating; quantum is shadow | Delete OR replace classical with quantum (pick one) |

### MERGE — duplicated logic that should be one service

| # | Item | Replacement |
|---|---|---|
| 13 | **A4 Frankenstein + A7 Signal Correlation** | One **Overfit Guard** at PAPER→DEPLOY_READY. A4 catches bar-ordering overfit; A7 catches signal-cosine overfit. Different axes, same intent. Merge into one service with two checks, one gate. |
| 14 | **B5 Multi-Firm Eligibility + B14 Survival Twin + compliance_gate.py** | One **Firm Readiness Service** returning `{firmId, eligibility:PASS\|FAIL, reason, survivalP365d, recommendation}`. Compliance freshness + adversarial priors in a single call. |
| 15 | **A14 Black Swan + B10 MRP** | One **Regime Fragility Score** (composite 0-100). One advisory at PAPER→DEPLOY_READY. One audit log entry per promotion. |
| 16 | **C1 CME Outage + C2 Prop Firm Health** | One **Entity Halt Registry** with `{type:exchange\|firm, entityId, startedAt, reason, affectedSymbols}`. Same state-machine code stays singular. |
| 17 | **5N brave-video-discoverer + 5O Supadata transcript** | One workflow: `YouTube Discovery + Transcription`. 5N finds the video; 5O extracts text. Sequential steps, not separate workflows. |

### RENAME / DOCUMENT — naming chaos that costs nothing to fix

| # | Item | Fix |
|---|---|---|
| 18 | **8 different "compliance" things** (compliance_gate.py, compliance_rulesets, compliance_reviews, compliance_drift_log, compliance-refresh-service, 6D-compliance-gate workflow, Pre-Session Compliance Gate, Daily Compliance Check, Weekly Compliance Re-Parse) | Rename `compliance_gate.py` → `prop_firm_rule_enforcer.py`; rename `compliance-refresh-service.ts` → `prop_firm_rules_sync_service.ts`; n8n workflows → `*-rule-*` pattern. Tables stay (backend concern). |
| 19 | **Three regime classifiers, no source of truth** | Designate **C11 HMM as source of truth.** DeepAR is a challenger that adjusts the HMM's `dominant_state` confidence (not a separate output). A+ Market Auditor produces `lead_market` only, not regime. Update `regime-state-service.ts` to emit one canonical `MacroRegime` shape. |
| 20 | **18 pending-row tables, 1 shared sweeper** | OK as-is. Document the contract: any new table using "pending → completed/failed" must be registered with the sweeper. Add a runtime check at startup. |

### CRON CLEANUP — sprawl + double-scheduling

| # | Item | Fix |
|---|---|---|
| 21 | **`lifecycle-auto-check` runs twice** (registerJob 6h + cron `0 */6 * * *`) | Pick one. registerJob is enough; remove the cron line. |
| 22 | **`deepar-train`, `deepar-predict`, `deepar-validate` double-scheduled** | Same fix. Remove cron duplicates. |
| 23 | **`stale-session-check` runs every 5 min** | 60-minute cadence is sufficient for 1-hour stale detection. |
| 24 | **C8 Windows + Pre-Session compliance + Pre-Session skip + multiple morning crons** | Merge into **one `pre-market-gates` cron** at 8am ET that runs all checks, returns `{canTrade, blockReasons[]}`. |

---

## The clean blueprint — how it should look

After consolidation, the system collapses from ~50 active subsystems to ~30 with clearer boundaries. Here's the puzzle:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  DATA LAYER                                                               │
│  Databento (backfill) · Massive (live stream) · Alpha Vantage (indicators)│
│  S3 ratio-adjusted continuous contracts                                   │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────────┐
│  MARKET CONTEXT LAYER (one source of truth per concern)                   │
│  ┌────────────────────────────┐  ┌────────────────────────────┐          │
│  │ MacroRegime  (C11 HMM)     │  │ EntityHaltRegistry         │          │
│  │ Growth/Inflation/Crisis/   │  │ (C1 CME + C2 prop firm)    │          │
│  │ Easing + crisis_prob gate  │  │ exchange|firm halts        │          │
│  │ DeepAR adjusts confidence  │  └────────────────────────────┘          │
│  └────────────────────────────┘                                          │
│  ┌────────────────────────────┐  ┌────────────────────────────┐          │
│  │ A+ Market Auditor          │  │ Pre-Market Gates Cron      │          │
│  │ lead_market signal only    │  │ (Windows + skip + cadence) │          │
│  └────────────────────────────┘  └────────────────────────────┘          │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼────────────────────────────────────────┐
│  STRATEGY GENERATION LAYER                                                │
│  ┌──────────────────────┐                                                 │
│  │ Scouts (4 only)       │   5K Parallel · 5L Tavily · 5M Brave News      │
│  │ → /scout-ideas        │   5O YouTube (5N folded in)                    │
│  │ + content_hash dedup  │                                                │
│  └──────────┬────────────┘                                                │
│             ▼                                                              │
│  ┌──────────────────────┐                                                 │
│  │ Synthesizer (eCr7)   │   ONE generator workflow.                       │
│  │ + prop-flight cache  │   StrategyDSL JSON output.                      │
│  │ + dsl_quality_critic │   Z4 + sAIr deleted.                            │
│  └──────────┬────────────┘                                                │
│             ▼                                                              │
│  ┌──────────────────────┐                                                 │
│  │ DSL Diversity (C9)   │   Pre-backtest hard gate                        │
│  └──────────┬────────────┘                                                │
└─────────────┼─────────────────────────────────────────────────────────────┘
              │
┌─────────────▼─────────────────────────────────────────────────────────────┐
│  VALIDATION GAUNTLET (consolidated, hard gates only)                      │
│                                                                            │
│  CANDIDATE ──► Backtest ──► A1 determinism + A2 provenance + A13 IR        │
│                                                                            │
│  CANDIDATE → TESTING:                                                      │
│    ◾ Walk-forward MC + tier requirements                                  │
│                                                                            │
│  TESTING → PAPER:                                                          │
│    ◾ Overfit Guard (A4 Frankenstein + A7 Signal Correlation, merged)       │
│    ◾ Regime Fragility Score (A14 Black Swan + B10 MRP, merged) — Phase 1   │
│    ◾ Grover Adversarial Stress — Phase 1 if graduation query passes        │
│                                                                            │
│  PAPER → DEPLOY_READY:                                                     │
│    ◾ Firm Readiness Service (B5 + B14 + compliance, merged)                │
│    ◾ 30-day rolling Sharpe ≥ 1.5                                           │
│                                                                            │
│  DEPLOY_READY → PILOT (B8): human action, 5-session canary, 1 contract     │
│  PILOT → DEPLOYED: automatic if rolling Sharpe ≥ 1.0                       │
│                                                                            │
└─────────────┬─────────────────────────────────────────────────────────────┘
              │
┌─────────────▼─────────────────────────────────────────────────────────────┐
│  LIVE / SAFETY LAYER                                                       │
│  EntityHaltRegistry · MacroRegime gates · Network monitoring                │
│  C3 prompt-injection (input/output/sandbox) · C6 Bitwarden vault            │
│  C7 Validation Cadence forcing function                                     │
└─────────────┬─────────────────────────────────────────────────────────────┘
              │
┌─────────────▼─────────────────────────────────────────────────────────────┐
│  FEEDBACK LAYER                                                            │
│  9A Nightly self-critique (humans + 1 LLM critic, not 3)                    │
│  11A Critic Optimizer · 7A Auto-evolution                                   │
│  B12 Closed feedback loops · Strategy memory                                │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key principles in the cleaned-up shape:**
1. **One source of truth per question.** "What regime?" → C11 HMM only. "Can I trade?" → EntityHaltRegistry only. "Which firm?" → Firm Readiness Service only.
2. **Phase 0 has an expiry date.** Day 60 graduation is mandatory. Subsystems either graduate or get deleted. No perma-advisory mode.
3. **Hard gates only at lifecycle transitions.** Advisory chatter goes to logs, not to the gate cluster. The gate cluster is for blocking decisions only.
4. **One workflow per concern.** No two n8n workflows do the same thing. Multi-symbol generators don't fork into 4 variants.
5. **Naming discipline.** "Compliance" means rule-enforcement only. Health-checks are health-checks. No 8-way overload.

---

## Where NeMo actually fits

After consolidation, NeMo Data Designer has exactly **one** clean integration point:

**Feeds the consolidated Regime Fragility Score (A14+B10 merge)** with novel regime archetypes.

NOT a new subsystem. A data feeder for an existing one. The integration looks like:

```
NeMo Data Designer (containerized, Ollama-backed)
   ↓  generates regime archetype labels + conditioning vectors
   ↓
A14 VAE (existing)
   ↓  synthesizes statistically-rigorous OHLCV per archetype
   ↓
Regime Fragility Score (consolidated A14+B10)
   ↓  Phase 1 hard gate at TESTING → PAPER
   ↓
Strategy promotion decision
```

Total new integration points: **2** (NeMo container + import script). Not 5+ as the original Pass 12 plan had. Why fewer? Because A14+B10 are merged first, so NeMo plugs into one consumer, not two.

**This is what "fits like a puzzle" means.** NeMo is shaped like a data-feeder for a regime-fragility judge. It's not shaped like its own gate or its own scoring service.

---

## Sequenced execution plan

### Pass 12 — Consolidation (highest priority)
**Estimated effort:** 12-16 hours · **Risk:** medium (touches lifecycle gates) · **Reversibility:** good (each item is independently revertable)

Order matters. Do these in sequence, verify after each:

1. **Cron deduplication** (1h, lowest risk) — kill double-scheduled jobs in `scheduler.ts`
2. **A11 + C4 + nightly_review LLM role deletion** (2h) — pure removal, no consumers to migrate
3. **Z4 + sAIr n8n workflow deletion** (1h) — eCr7 carries the load
4. **5N + 5O scout merge + content_hash dedup at scout-ideas intake** (2h)
5. **Compliance naming sweep** (2h) — rename files + n8n workflows; update CLAUDE.md
6. **Overfit Guard merge (A4 + A7)** (3h) — careful; touches lifecycle gate
7. **Firm Readiness Service merge (B5 + B14 + compliance)** (3h) — careful; touches dashboard
8. **Regime Fragility merge (A14 + B10)** (2h)
9. **Entity Halt Registry merge (C1 + C2)** (2h)
10. **Pre-market gates consolidation (C8 + pre-session crons)** (1h)

Verification per item: drift detector (`npm run audit:n8n`), test suite, system-map check.

### Pass 13 — Graduation Wave (after Pass 12 stabilizes)
**Estimated effort:** 8-12 hours · **Goal:** end Phase 0 perpetual advisory state

For each subsystem: run the W7b graduation query (canonical SQL in CLAUDE.md). For each:
- If `bad_rate(WOULD_HAVE_BLOCKED) > bad_rate(WOULD_HAVE_PASSED) + 0.10` AND sample ≥ 20: **graduate to Phase 1 hard gate**
- Else: **delete the subsystem**

Targets: DeepAR, A14 (consolidated), B14, Grover, A+ Market Auditor, quantum_mc.

End state: every subsystem in the gate cluster is either a real filter or removed.

### Pass 14 — NeMo Synthetic Regime Expansion (only if still needed)
**Estimated effort:** 6-8 hours · **Prerequisite:** Pass 12 + Pass 13 done

After A14 graduates and is merged into Regime Fragility Score, decide whether to expand archetypes from 5 → 50+. By that point you'll know:
- Is A14 actually filtering strategies? (Pass 13 told us)
- Are strategies passing A14 too easily? (graduation evidence shows this)
- Do you want stricter false-positive control? (yes if too many strategies pass)

If yes → run the original Pass 12 NeMo plan (now Pass 14, plugging into one consumer not five).
If no → don't add NeMo. The regime bar is already strict enough.

---

## What I'd skip indefinitely

- **NIM serverless inference** — your LLM stack is sufficient post-consolidation
- **Brev cloud GPUs** — RTX 5060 is not the bottleneck; quantum modules don't need it
- **Adding more scouts** — 4 sources is plenty; deduplication matters more than coverage
- **Adding more critics** — 2 LLM critics is plenty; humans should do strategic review
- **Cloud quantum** unless QUANTUM_CLOUD_ENABLED is producing measurable lift in graduation queries

---

## Bottom line

**You're not behind on capability. You're ahead on capability and behind on integration discipline.** 24 cleanup items above. None require new infrastructure. After Pass 12 ships, the system is meaningfully easier to trust, easier to debug, and ready for either real deployment OR thoughtful expansion (NeMo or otherwise).

The puzzle pieces are mostly correct. They're just stacked instead of placed.
