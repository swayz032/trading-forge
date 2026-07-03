# Overlay Unfreeze Protocol

**Roadmap Band E, item E3 (2026-07-02).**
**Status:** MECHANISM DOCUMENTED — codifies the existing standing rule; does not itself unfreeze
anything. The overlay remains FROZEN until an operator runs this protocol end-to-end.

---

## The standing rule this protocol codifies

> **The overlay is FROZEN. No optimization without a profitable baseline.**

This has been true since the Layer 4 research-conveyor pivot (2026-07-02) and is restated in
every measurement-instrument script shipped since: `scripts/confluence-overlay-ablation.py`,
`scripts/overlay-attribution.py`, `scripts/overlay-delta-corpus.py`,
`scripts/exit-policy-replay.py`, `scripts/filter-ablation-cpcv.py`, and this session's
`scripts/full-battery-mode-ab.py` all print or docstring some form of "measurement instrument
only — overlay is FROZEN." Until now that sentence was enforced by *convention* — every script
says it, nothing *checks* it. This document turns the sentence into a mechanism: a named
audit action, a required evidence bundle, and an explicit interaction with the frozen-policy
hash machinery (Wave 29 Pass B.2) so an overlay change is not a silent, unaudited edit to
`framework-overlay.ts` / `src/engine/context/eligibility_gate.py`.

**This document does not grant permission to unfreeze anything.** It defines what evidence must
exist and what audit trail must be written *before* an operator manually flips one overlay
component. There is no auto-unfreeze path anywhere in this protocol — every step below is
operator-executed.

---

## Scope: "component," not "the overlay"

The overlay is not one thing. It is the 7-layer eligibility gate
(`apply_eligibility_gate()` in `src/engine/backtester.py`) plus the 11-factor weighted
confluence score (`confluence-score.ts`) plus Style C exit management. This protocol governs
unfreezing **one component at a time** — e.g. the `no_trade` playbook layer, the
`macro_alignment` factor's non-hard-block sibling factors, a single confluence weight. It never
governs "turn the whole overlay off in production" — that is a different, far larger decision
this protocol does not cover.

Component names are the same vocabulary `src/engine/ablation_layers.py::ABLATION_LAYER_MAP` and
`scripts/filter-ablation-cpcv.py`'s `--layers` flag already use for the eligibility-gate layers,
plus the confluence factor names in CLAUDE.md §2b's 11-factor table for confluence-score
components. Do not invent new component names — if a component you want to unfreeze isn't in
either vocabulary, register it there first (that registration is itself a code change subject to
normal review, not this protocol).

---

## The five preconditions (ALL required, condition (d) enforces exactly one)

Unfreeze of a single overlay component requires ALL of the following to be true and evidenced
before the operator executes the unfreeze:

### (a) A profitable Mode A baseline exists

At least one strategy has passed the FULL gate battery (WF/CPCV + DSR + PBO + B14) in **Mode A**
(`TF_CONFLUENCE_OVERLAY_DISABLED=true` — source-signal-only, no institutional overlay) **above
the null noise floor** established by `scripts/null_gate_calibration.py` /
`docs/gate-battery-calibration.md`.

- Run: `scripts/full-battery-mode-ab.py` (this session's E1 deliverable) against the candidate
  strategy set, `--include-mc` for the B14 leg.
- The Mode A `full_battery_pass` equivalent — `dsr_pass=true`, `pbo <= PBO_OVERFIT_THRESHOLD_PCT`
  (0.15), `wfe >= WFE_HARD_FLOOR` (0.70), `b14_ci_high <= B14_RUIN_CI_HIGH_THRESHOLD` (0.20) — must
  hold for at least one strategy's Mode A run.
- That pass count must exceed the null-calibration noise floor
  (`docs/gate-battery-calibration.md`'s "Population-scale passes only count above this floor"
  rule) — a single Mode A pass with no null-calibration context is not sufficient evidence; cite
  the noise-floor-adjusted count per `docs/corpus-fdr-standard.md`'s composition rule
  (floor-relative check FIRST, then FDR-across-survivors) if evaluating a population rather than
  one strategy.
- **Why this precondition exists:** unfreezing a component to help an overlay that has never
  demonstrated it improves anything over a raw, gate-passing baseline is optimizing a broken
  premise. The overlay can only earn back complexity it took away from a signal that was already
  shown to work without it.

### (b) Filter-ablation evidence: HARMFUL or DEAD_WEIGHT

Run `scripts/filter-ablation-cpcv.py --layers <component>` (or the confluence-score equivalent
methodology — see "Confluence-score components" below) against the SAME strategy(s) that
satisfied (a). The component's verdict from that harness's taxonomy must be:

- `HARMFUL` (`delta_dsr >= +0.05` — removing the component IMPROVED OOS DSR), or
- `DEAD_WEIGHT` (`|delta_dsr| < 0.05` — removing the component made no measurable OOS DSR
  difference)

`CONTRIBUTING` (`delta_dsr <= -0.05`, removal degraded OOS DSR — the component is earning its
overfit cost) is a **disqualifying** result. A component whose removal degrades OOS DSR by
`>= 0.05` (the Bailey & Lopez de Prado threshold shared by `filter-ablation-cpcv.py` and this
session's `full-battery-mode-ab.py`) is doing real work; do not unfreeze it.

- **Threshold citation:** `DSR_CONTRIBUTING_THRESHOLD = 0.05` in
  `scripts/filter-ablation-cpcv.py`. This is the SAME numeric threshold
  `scripts/full-battery-mode-ab.py` uses for its `DSR_EDGE_THRESHOLD` — the two harnesses answer
  related but distinct questions (per-layer marginal contribution vs whole-overlay-mode
  comparison) and intentionally share the threshold so their verdicts are directly comparable.

### (c) A+ retention >= 80% on gate-passed strategies under the proposed change

Of the gate-passing strategy(s) from (a), re-run `scripts/full-battery-mode-ab.py` with the
proposed change applied in a THIRD, throwaway mode (component disabled but overlay otherwise ON
— use `TF_OVERLAY_DISABLE_LAYERS=<component>` per `ablation_layers.py`'s env contract for
eligibility-gate layers, or the confluence-score weight override for confluence factors) and
compute A+ retention against the Mode A baseline trade set, the SAME method
`scripts/overlay-attribution.py` and `scripts/full-battery-mode-ab.py::compute_aplus_retention_pct`
use (entry-timestamp-matched, `>= APLUS_POINTS`-point winners, default 14 pts).

- Required: `aplus_retention_pct >= OVERLAY_APLUS_RETENTION_FLOOR` (default `0.80` / 80%).
- **Named constant, not a magic number:** `OVERLAY_APLUS_RETENTION_FLOOR` — Python:
  `scripts/full-battery-mode-ab.py` (env `OVERLAY_APLUS_RETENTION_FLOOR`, default `0.80`); TS
  mirror: `src/server/lib/mode-ab-guard.ts::getOverlayAplusRetentionFloor()` /
  `OVERLAY_APLUS_RETENTION_FLOOR_DEFAULT`. Both read the SAME env var name so an operator setting
  it once in `.env` affects both surfaces identically. If you ever change the default, change it
  in BOTH files in the same commit — see the file-header comments cross-referencing each other.
- **Why 80% and not 100%:** the whole point of unfreezing a component is that it is
  HARMFUL/DEAD_WEIGHT overall — some individual trades legitimately change when a filter changes.
  80% retention of the operator's actual A+ winners (the 14+ point trades that matter per the
  "1-2 A+ trades/day" mandate, CLAUDE.md §4) is the bar for "this change doesn't accidentally
  throw out the good trades while removing dead weight."

### (d) ONE component per unfreeze

Every unfreeze action targets exactly one named component (eligibility-gate layer name from
`ABLATION_LAYER_MAP`, or one confluence-score factor). Never batch multiple components into a
single unfreeze action, even if evidence exists for several simultaneously.

- **Why:** unfreezing N components at once makes conditions (a)-(c) untestable post-hoc — if the
  strategy's live/paper performance changes after a multi-component unfreeze, there is no way to
  attribute the change to a specific component, and the next `frozen_policy_hash` re-freeze
  (see "Interplay with frozen-policy-hash" below) bakes all N changes into one hash with no
  per-component audit trail.
- Operator workflow for multiple qualifying components: run this protocol N times sequentially,
  each with its own audit row, its own evidence bundle, and its own observation window before the
  next component's unfreeze begins.

### (e) One audit row per unfreeze

Every unfreeze action writes exactly one `audit_log` row with:

- **Action name:** `overlay.component_unfrozen`
- **Required payload fields:**
  - `component` (string) — the exact `ABLATION_LAYER_MAP` key or confluence-factor name being
    unfrozen
  - `evidence_refs` (object) — pointers to the three evidence artifacts satisfying (a)/(b)/(c):
    - `mode_a_battery_report` — path to the `full-battery-mode-ab.py` report JSON (or manifest
      key) satisfying condition (a)
    - `filter_ablation_report` — path to the `filter-ablation-cpcv.py` output satisfying
      condition (b), including the exact `verdict` and `delta_dsr` value
    - `aplus_retention_report` — path to the report satisfying condition (c), including the exact
      `aplus_retention_pct` value
  - `strategy_ids` (array) — every strategy the evidence bundle was computed against
  - `operator_identity` (string) — who executed the unfreeze (this protocol has NO automated
    path — `decision_authority` on this audit row MUST be `"operator"`, never `"system"`)
  - `rationale` (string, `>= 50` chars) — mirrors the existing
    `frozen_policy.override_rationale_too_short` reject convention (Wave 29 Pass B.2,
    `POST /api/admin/frozen-policy-override`) so unfreeze rationale quality matches the bar
    already set for frozen-policy overrides
- **decision_authority:** `"operator"` (hard requirement — see (e) above; there is no automated
  or "system" path that can emit this action)

This mirrors the existing `frozen_policy.*` audit-action family's shape
(`src/server/lib/frozen-policy-contract.ts`) closely on purpose: an overlay unfreeze and a
frozen-policy HMAC override are both "operator manually overrides a machinery that defaults to
strict" actions, and should be equally discoverable in the audit log by an operator scanning for
"what changed and why."

**Implementation note (not yet built — this document specifies the contract; wiring the actual
`insertAuditRowSafe({action: "overlay.component_unfrozen", ...})` call at the point where an
operator flips the component is a follow-up code change, out of scope for E3's documentation
deliverable and outside this agent's `src/server/lib/**` mode-ab-prefixed file boundary for
anything beyond the `mode-ab-guard.ts` thin lib already shipped this session).**

---

## Interplay with the frozen-policy-hash machinery

Wave 29 Pass B.2 (`src/server/lib/frozen-policy-contract.ts`) hashes a **5-field, per-strategy**
slice: `{entry_quality, position_size, stop_loss, take_profit, exit_plan_config}`. This is a
narrower surface than "the overlay" — the overlay lives in `framework-overlay.ts` (global
defaults applied at graduation time) and `eligibility_gate.py` / `confluence-score.ts` (global,
env- and code-level logic, not per-strategy config fields).

**Consequence: an overlay-component unfreeze does NOT automatically re-hash any strategy's
`frozen_policy_hash`, because the overlay's global logic is not part of the 5-field slice.**
This is a real gap between the two contracts, and this protocol closes it procedurally (not by
changing the 5-field slice — CLAUDE.md §13 explicitly forbids changing that slice without a
versioned migration):

1. **Before unfreezing a component that is EXPRESSED as a per-strategy config field** (e.g. a
   confluence-score weight override stored in `strategies.confluence_score_weights` JSONB, or an
   `exit_plan_config` change) — the unfreeze WILL cause `frozen_policy_hash` drift on every
   DEPLOYED strategy whose config field actually changes, and the existing
   `lifecycle.frozen_policy_drift_blocked` gate will correctly block re-promotion until an
   operator HMAC-overrides or re-freezes via a fresh CPCV + PBO + WFE pass. **No special handling
   needed — the existing gate does its job.**
2. **Before unfreezing a component that is GLOBAL logic** (e.g. an `eligibility_gate.py` layer,
   or a `framework-overlay.ts` default that is not read back into per-strategy config) — the
   5-field hash does NOT change, and the existing `frozen_policy_hash` gate will NOT detect the
   drift. **This is the case the audit row in condition (e) exists to cover**: since the hash
   machinery cannot see this class of change, the `overlay.component_unfrozen` audit row is the
   ONLY record that a DEPLOYED strategy's effective behavior changed underneath it. Operators
   auditing a DEPLOYED strategy's history MUST check both `frozen_policy.*` rows AND
   `overlay.component_unfrozen` rows to get the full picture of "what could have changed this
   strategy's live behavior since it was frozen."
3. **Recommendation, not a hard gate (out of scope to enforce in code this session):** any
   `overlay.component_unfrozen` action for a GLOBAL-logic component should be followed by a
   forced re-freeze (fresh CPCV + PBO + WFE pass on every affected DEPLOYED strategy) even though
   the 5-field hash technically still matches — global overlay behavior changed, so the strategy's
   validation evidence is stale by the same logic `regime-drift-detector` already applies to
   regime drift (CLAUDE.md, "Regime drift auto-demotion"). This is a documented follow-up, not
   built by this protocol document.

---

## Relationship to "Ship gates STRICT, then loosen with DATA — not fear"

CLAUDE.md §13 Architecture states the operator's overarching doctrine, backed by
`src/engine/gate_block_analyzer.py`:

> **Ship gates STRICT, then loosen with DATA — not fear.** [...] Diagnose with
> `src/engine/gate_block_analyzer.py` — for every gate-BLOCKED signal [...] it replays the
> FAITHFUL counterfactual [...] and verdicts each gate COSTING (blocked big-move winners) vs
> SAVING (blocked losers). [...] Loosen only the gates the DATA shows are blocking winners.

This protocol is that doctrine applied specifically to the confluence/exit overlay (as opposed
to `gate_block_analyzer.py`'s domain, which is the live/paper signal-blocking gates —
`macro_alignment`, `daily_trade_cap`, `lunch_blackout`, structural-stop ceilings, etc.). The two
tools measure different things and are complementary, not redundant:

| Tool | Question answered | Domain |
|---|---|---|
| `gate_block_analyzer.py` | "Did this specific BLOCKED signal cost us a big-move winner?" | Live/paper signal-time gates |
| `filter-ablation-cpcv.py` | "Does removing this eligibility-gate layer change OOS DSR?" | Backtest eligibility-gate layers |
| `full-battery-mode-ab.py` (E1) | "Does the WHOLE overlay survive the full institutional battery, and by how much per axis?" | Whole-overlay Mode A/B, full battery |
| This protocol (E3) | "What evidence + audit trail is required before unfreezing ONE component?" | Process/governance, not measurement |

The shared principle across all four: **loosen with DATA, never with fear, and never all at
once.** This protocol's conditions (a)-(c) are exactly "the DATA" the doctrine demands, formalized
into named, versioned thresholds so "loosen with data" cannot degrade into "loosen because
someone eyeballed a chart."

---

## Operator commands

```bash
# 1. (a) Mode A/B full battery — establish the profitable Mode A baseline + get the whole-overlay
#    comparison for context. Export gate-eligible strategies to a spec-array JSON first:
#    (one-liner sketch — adapt column names to the live strategies schema)
psql "$DATABASE_URL" -t -A -c \
  "SELECT json_agg(jsonb_build_object(
      'id', id, 'strategy', config->'strategy', 'start_date', '2023-01-01',
      'end_date', '2025-12-01', 'firm_key', 'topstep_50k'
   )) FROM strategies WHERE lifecycle_state IN ('TESTING','SHADOW','PAPER')" \
  > docs/designs/gate-eligible-strategies.json

PYTHONPATH=. TF_ALLOW_FIXED_1=true python scripts/full-battery-mode-ab.py \
  --strategy-list-file docs/designs/gate-eligible-strategies.json \
  --manifest full_battery_mode_ab_manifest.jsonl \
  --report-out full_battery_mode_ab_report.json \
  --include-mc

# 2. (b) Filter-ablation verdict for the specific component you want to unfreeze
PYTHONPATH=. python scripts/filter-ablation-cpcv.py \
  --strategy-class <the winning strategy's class or spec> \
  --start 2023-01-01 --end 2025-12-01 \
  --layers <component_name>

# 3. (c) A+ retention under the proposed change (re-run the Mode A/B harness with the
#    component disabled via TF_OVERLAY_DISABLE_LAYERS, compare against Mode A baseline trades)
TF_OVERLAY_DISABLE_LAYERS=<component_name> PYTHONPATH=. python scripts/full-battery-mode-ab.py \
  --spec-file docs/designs/<strategy>-spec.json --include-mc

# 4. (e) Write the audit row (operator-executed, manual today — see "Implementation note" above)
#    action=overlay.component_unfrozen, decision_authority=operator, payload per condition (e).
```

---

## Summary checklist (all boxes required before flipping a component)

- [ ] (a) A Mode A baseline exists, passes the full battery, and clears the null-calibration
      noise floor
- [ ] (b) `filter-ablation-cpcv.py` verdict for the component is `HARMFUL` or `DEAD_WEIGHT`
      (never `CONTRIBUTING`)
- [ ] (c) A+ retention `>= OVERLAY_APLUS_RETENTION_FLOOR` (80%) under the proposed change
- [ ] (d) Exactly one component targeted by this unfreeze action
- [ ] (e) `overlay.component_unfrozen` audit row written with full evidence-ref payload,
      `decision_authority="operator"`
- [ ] Frozen-policy interplay checked: if the component is expressed as a per-strategy config
      field, confirm `frozen_policy_hash` drift blocks re-promotion as expected; if it is global
      logic, note that the hash will NOT detect the change and the audit row is the only record
