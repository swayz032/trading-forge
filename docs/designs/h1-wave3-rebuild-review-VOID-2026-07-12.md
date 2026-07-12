# H1 Wave-3 — Conformance rebuild REVIEW: VOID (independent ablation, 2026-07-12)

Independent reviewer ran real-Gemma ablations (4 scripts, not docstring-trust) + ruled out LLM noise via 32-item self-consistency re-run (100% self-agreement, deterministic under current code).

## Clean (verified by independent re-derivation):
- Decline gate STRUCTURAL/PRE-CALL: `if not sibling_rules: cannot-determine`, `llm_invoked=False`, no threshold/tunable. ✓
- Decline gate DIRECTION-SAFE: only lowers/holds absorption (structural counting guarantee + real-Gemma ablation). ✓
- W1-0147 fix blast radius = EXACTLY 1 item (only item with 'needs to'; no downstream sibling effect). ✓
- `_derive_label` unnamed-instantiation→context: strictly more conservative, no new gate path (inert on this data). ✓
- Birth fixtures ALL PASS + segmentation exact + decline routing 5/112 now nonzero. ✓

## VOID cause — diff-confinement REFUTED (scope-lock breach):
Beyond the 6 sanctioned changes (5 structural declines + W1-0147 no-op), **16 unexplained item flips** (13 walkthrough + 3 bias) that RAISE absorption in BOTH classes, reproducible (not noise):
- `bias_vs_movement`: 0.875 → **0.9375 (+6.25pp)** — 0 declines in this class, so the ENTIRE rise is unexplained by the sanctioned changes.
- `walkthrough_narration`: 0.781 → **0.833 (+5.2pp)** — the decline gate alone COSTS −4 correct (0.7396); the other 16 flips net +9, overpowering the gate's tax.
**Mechanism:** removing the tunable `ambiguous` clause_kind from the LLM JSON-schema enum (5→4 options) was REQUIRED for conformance (a model-side decline is the gaming-costume the structural gate replaces) — BUT removing an enum OPTION perturbs the constrained-sampling probability distribution over the REMAINING options, shifting the gate/context boundary on borderline items even though 'ambiguous' was never the argmax in pass1 (routing was 0.0). Un-vetted for absorption-direction; empirically NOT neutral; it RAISED the score → the exact class of change the ruling's scope-lock voids.

## The CLEAN fix the review points to (schema-neutral conformance):
Do NOT REMOVE the 5-option enum (that perturbs the boundary). Instead KEEP the schema unchanged and NEUTRALIZE the model-side `ambiguous` output → forced context-commit (the conservative default). Then the gate/context BOUNDARY is identical to pass1, and the ONLY absorption change is the structural decline gate's direction-safe −tax. That is conformance with NO boundary-perturbation and NO absorption raise — scope-honest by construction.

**Disposition: rebuild VOID. Do NOT run characterization or open the sealed 77 on these numbers.** Remediation fork = operator ruling: (A) corrected conformance rebuild (enum-NEUTRALIZE not enum-remove; schema unperturbed; only the decline-tax moves absorption, downward) — the clean design the reviewer proved exists; OR (B) the entanglement means the honest design-pool read is the pass1 NON-conformant numbers (force-determining, walkthrough 78%), which already point to the human-in-loop fork. doer≠grader caught the orchestrator's own rebuild breach — second scope-catch this wave.
