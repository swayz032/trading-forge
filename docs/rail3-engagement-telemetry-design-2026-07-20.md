# Rail 3 — Engagement Telemetry + Contract Registry — DESIGN SPEC

**Status:** DESIGN ONLY — paper, for advisor review (OR-012 §3c). No code written. Build follows Grade A per the pinned sequence.
**Lane:** ops-experience. **Governance:** NON-INSTRUMENT throughout — read-only queries, a tracked JSON ledger, a report, and a CI check. Nothing here alters engine behaviour, gates, sizing, or measurement outputs.
**Source of truth:** `docs/hardening-machine-rails-2026-07-11.md` §5 (rail 3) + §8 (surface tiering) + §4c (soak-mold build standard).

---

## 1. Why this rail exists (evidence, not theory)

The rails program was created because **dormant features are discovered months late** (spec §1.3). Since then the campaign has produced a steady stream of confirmations that the class is real and recurring:

- **VIX-margin expansion** — code default-ON, production-UNREACHABLE (no VIX ever joins the frame). Discovered by scan luck.
- **`startInternalsSubscription()`** — zero callers; TICK/ADD/VOLD/TRIN WS never started.
- **Pre-market DXY/10Y producer** — 0/39 non-null values ever delivered.
- **Rail 5 itself** — shipped, tested, and never registered as a scheduled task; its divergence alarm has fired exactly zero times.
- **The soak** — `nightIndex: 0` after 7 scheduled nights.
- **`cert-2026-07-15`** — a genuine RED (`system-map:check: fail`) that sat unread for four days under a pile of skips.

Every one of these is the same shape: **something that reports nothing is indistinguishable from something that works.** Rail 3 makes zero-engagement *say so*.

## 2. Deliverables

| # | Artifact | Kind |
|---|---|---|
| 3.1 | `docs/feature-ledger.json` | tracked data |
| 3.2 | `docs/subsystem-tiers.json` | tracked data (spec §8) |
| 3.3 | `scripts/lib/engagement.cjs` — pure decision functions | code + DI tests |
| 3.4 | `scripts/rails/engagement-report.cjs` — weekly runner | code |
| 3.5 | Contract-registry extension of `check:gate-contract-keys` | CI check |

## 3. `feature-ledger.json` — schema

CLAUDE.md §12's hard-gates table is prose today, so doc-drift is untestable. This makes it **checkable data**.

```jsonc
{
  "schemaVersion": "feature_ledger_v1",
  "thresholdVersion": "rails_thresholds_v1",
  "features": [
    {
      "id": "b14_ci_high_gate",
      "name": "B14 Survival Twin ci_high gate",
      "tier": "CORE",                          // CORE | ACTIVE | FROZEN  (3.2)
      "defaultOn": true,
      "evidence": {                            // how engagement is PROVEN
        "auditActions": ["b14.gate_evaluated"],
        "prometheus": [],
        "minPer7d": 1
      },
      "livenessExpectation": "per_promotion",  // per_bar|per_signal|per_trade|per_promotion|
                                               // nightly|weekly|on_demand|dormant_by_design
      "dormantReason": null,                   // REQUIRED when livenessExpectation=dormant_by_design
      "owner": "money-path",                   // which lane fixes it
      "addedBy": "ops-experience 2026-07-20"
    }
  ]
}
```

**Design decisions:**
- **`livenessExpectation` is mandatory and enumerated.** A feature that legitimately fires rarely (`per_promotion` with zero promotions this week) must not generate noise — but it must *declare* that, so "quiet" is a claim on the record rather than an inference.
- **`dormant_by_design` requires `dormantReason`.** This is where VIX-margin, market-internals, and the DXY/10Y producer land — visible, justified, and exempt from alerting rather than silently absent. **Being on this list is not absolution; it is a receipt.**
- **`owner`** exists because ops-experience cannot fix instrument dormancy — a CORE/money-path entry going quiet produces a **cross-lane REQUEST**, never an edit.

## 4. `subsystem-tiers.json` (spec §8)

`{ CORE: [...], ACTIVE: [...], FROZEN: [...] }` verbatim from spec §8's table. Read by the engagement report for alert exemption (FROZEN entries are **listed but never alerted**) and by the deep-scan skill for default scope. Moving a subsystem is a one-line edit + operator say-so; zero runtime effect.

## 5. Pure decision functions (`engagement.cjs`) — soak mold §13

```js
THRESHOLDS_V1 = { version: "rails_thresholds_v1", windowDays: 7, minEngagements: 1 }

// PURE — no clock, no DB, no I/O. Counts are injected.
evaluateFeatureEngagement({ feature, counts, thresholds }) ->
  { id, tier, engagements, status, alertable, reason }
// status ∈ "engaged" | "zero_engagement" | "expected_quiet" | "dormant_declared" | "unknown_evidence"

evaluateLedger({ features, countsById, thresholds }) ->
  { evaluated, alertable[], byStatus{}, unknownEvidence[] }

formatEngagementReport(result) -> string   // plain English, ONE Discord line + detail block
```

**Status semantics (the whole design is here):**

| status | when | alertable |
|---|---|---|
| `engaged` | count ≥ `minPer7d` | no |
| `zero_engagement` | count 0, expectation says it should have fired | **YES** |
| `expected_quiet` | count 0, but `livenessExpectation` legitimately allows it (e.g. `per_promotion`, no promotions occurred) | no — **but reported in the detail block** |
| `dormant_declared` | `dormant_by_design` + a reason | no — listed every week so it never fades from view |
| `unknown_evidence` | the ledger entry declares no `auditActions` and no `prometheus` | **YES — a feature we cannot prove is a hole in the ledger, not a passing feature** |

`unknown_evidence` is deliberately alertable. A ledger that lets an entry declare no evidence source would launder unmeasurable features into green — the same defect shape as the pytest `collectionFloor: 1` and "245 packages looks normal."

## 6. Fail-closed error matrix (soak §11)

| Failure | Behaviour |
|---|---|
| DB unreachable | report SKIPPED, one Discord line, **no green claimed** |
| audit_log query errors for one feature | that feature → `unknown_evidence` (alertable), others still evaluated |
| `feature-ledger.json` missing/unparseable | **hard fail + Discord CRITICAL** — the ledger IS the check |
| `subsystem-tiers.json` missing | proceed, treat all tiers as CORE (strictest), warn |
| Discord post fails | retry once, then JSONL + audit row retained; never silently drop |

**Never** infer engagement from absence of errors. Absence of evidence is `zero_engagement`, not `engaged`.

## 7. Persistence + surface

JSONL `data/rails/engagement-<date>.jsonl` + one `audit_log` row (`rails.engagement_report`). Weekly cron; consults the tower-idle guard? **No** — spec §4b explicitly exempts one-query lightweights. Discord: one plain-English line on a clean week; the detail block only when something is alertable.

> 🟠 3 default-ON features did nothing this week: VIX margin expansion (no VIX feed — declared), market internals (not started), pre-market cross-asset (no producer). 41 engaged, 6 legitimately quiet.

## 8. Contract registry (3.5)

Extend `scripts/check-gate-contract-keys.ts` from the gate-key set to a **declared producer→consumer registry** over the JSONB seams: `walk_forward_results`, `risk_metrics`, `entry_quality`, `b15_battery`, `exit_plan_config`, `structure_state`, `htf_narrative`. CI fails on an **unregistered** seam key. Kills the wrong-key grandfather-pass class (`probability_of_ruin_ci` written to `bca_confidence_intervals` and read from `risk_metrics` — silent for weeks).

## 9. RED-proofs (mandatory — a detector without a proven-red path is a false green)

1. Seed a fake ledger feature whose audit action never occurs ⇒ report lists it as `zero_engagement`. *(spec §9 names this exact proof.)*
2. Ledger entry with empty `evidence` ⇒ `unknown_evidence` + alertable.
3. `dormant_by_design` without `dormantReason` ⇒ schema validation fails.
4. Feature with `per_promotion` + zero promotions ⇒ `expected_quiet`, NOT alertable.
5. FROZEN-tier feature at zero engagement ⇒ listed, NOT alertable.
6. DB unreachable ⇒ SKIPPED, and **no feature reports `engaged`**.
7. Unregistered seam key in a fixture ⇒ CI check fails.

## 10. Open questions for the advisor

1. **Ledger seeding scope.** Full CLAUDE.md §12 sweep (~40 gates, high value, slow, and much of it is money-path-owned) vs. start with the ops-owned + already-known-dormant set and grow it? I lean **start narrow and honest** — a ledger claiming completeness it does not have is the disease.
2. **Does the engagement report belong to us at all for CORE/money-path entries?** My read: we own the *mechanism*, they own the *fixes*; a CORE entry going quiet is a cross-lane REQUEST. Confirm before I encode `owner` semantics.
3. **`dormant_by_design` entries need an operator-visible list** — this is where VIX-margin/internals/DXY live, and quietly-declared-dormant is how they stayed invisible. Should the weekly line always name the dormant count, even on a clean week? I lean **yes**.
