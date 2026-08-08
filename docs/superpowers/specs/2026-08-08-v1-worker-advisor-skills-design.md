# V1 Worker and Advisor Skills Design

Date: 2026-08-08

## Goal

Make worker and advisor behavior converge on the fastest trustworthy Compiler V1 path: one frozen source-to-engine vertical slice, then a deterministic full-library compile-or-refuse batch.

## Approved scope

Create four skills:

1. `vertical-slice-breakthrough` — worker causal focus when a real strategy has zero or partial production bindings.
2. `critical-path-campaign-manager` — advisor prioritization when adjacent defects compete with the active V1 blocker.
3. `source-to-engine-conformance` — shared V1.0 fidelity acceptance from real extraction through production execution.
4. `batch-disposition-integrity` — shared V1.1 per-strategy disposition and whole-run conservation contract.

Install byte-identical copies for Claude and Codex. Add pointer-only triggers to worker onboarding/execution, advisor onboarding/ruling, and `CLAUDE.md`. Do not modify compiler, engine, database, workflow, grader, or production behavior.

## Alternatives considered

### One monolithic “Fable behavior” skill

Rejected. It would load worker, advisor, conformance, and batch rules together, obscure triggers, and invite role leakage.

### Only strengthen existing onboarding files

Rejected. The relevant behavior must trigger during execution and ruling, not only at cold start. Large onboarding documents also make focused reuse and pressure testing harder.

### Four bounded skills with thin integration pointers — selected

Each skill owns one decision boundary and stays below 500 words. Onboarding names when to invoke it; procedural detail lives only in the skill.

## Baseline evidence

Fresh agents without the new skills were tested under time, sunk-cost, apparent-success, and authority pressure:

- Worker vertical tracing correctly narrowed to the first broken boundary.
- Conformance review correctly refused fixture/parity/backtest evidence as proof of real-source fidelity.
- Batch review correctly rejected count-only completion and specified row conservation.
- Advisor prioritization failed: it placed diagnostic-tool repairs and CI wiring ahead of the frozen zero-binding strategy. This reproduces the external ruling’s central delay mechanism.

Therefore `critical-path-campaign-manager` is discipline-enforcing. The other three are compact structural contracts that preserve already-good behavior and make its required output stable.

## Skill contracts

### `vertical-slice-breakthrough`

Require one table: source words → extraction record → canonical typed meaning → binding attempt/refusal → exact engine capability → first failed handoff. Repair only that handoff. Promote adjacent tooling only when it invalidates this trace or its receipt.

### `critical-path-campaign-manager`

Rank work by direct effect on V1.0/V1.1. The frozen strategy’s first broken handoff wins over adjacent tooling unless that tooling prevents the trace or invalidates its evidence. Defer by stable ID, owner, wake condition, and acceptance test so focus never becomes loss.

### `source-to-engine-conformance`

Accept V1.0 only from the real extraction artifact through production bindings/evaluator and independent bar-by-bar reference. Enforce complete semantic membership, provenance, no invented values, no silent defaults/substitutions, and meaningful mutations.

### `batch-disposition-integrity`

Require every manifest member to receive exactly one official V1.1 disposition. Each refusal names condition, evidence, canonical expectation, failed handoff, and reusable unlock. Counts must reconcile by membership; any silent loss or unfaithful compile fails and quarantines the run.

## Canonical and runtime placement

- Tracked canonical copies: `trading-forge/.agents/skills/<skill>/SKILL.md` in the app repository.
- Codex runtime copies: workspace `.agents/skills/<skill>/SKILL.md`.
- Claude runtime copies: workspace `.claude/skills/<skill>/SKILL.md`.
- Canonical and both runtime copies must have identical SHA-256 values.

Existing Claude/Codex onboarding drift is real: Claude carries the newer R-648 vertical-slice directive while Codex does not. This change will first preserve the newer directive, then make each onboarding pair byte-identical before adding the new pointers.

## Verification

For each skill, in sequence:

1. preserve the baseline response;
2. initialize canonically;
3. write the minimal skill;
4. validate YAML/name/description;
5. forward-test the same scenario with fresh context;
6. pressure-test a counterexample where the skill must not overreach;
7. install exact bytes into both runtimes and compare hashes.

Final verification checks onboarding parity, trigger presence, no duplicated procedural prose, skill validation, word counts, expected file membership, and `git diff --check`.
