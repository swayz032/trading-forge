# V1 Worker and Advisor Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create four tested skills that keep worker and advisor effort on the frozen Compiler V1 vertical slice and its subsequent truthful batch run.

**Architecture:** Track one canonical copy of each new skill under the app repo’s `.agents/skills/`. Install exact-byte mirrors into the workspace Claude and Codex skill directories. Existing onboarding files receive only role-specific invocation pointers; procedural logic remains in the new skills.

**Tech Stack:** Markdown/YAML agent skills, Python `quick_validate.py`, SHA-256 parity checks, fresh-context subagent pressure tests, Git explicit-SHA worktree.

## Global Constraints

- Base worktree at explicit SHA `0c57c86b8ce6456ede77a0a54502de8de5c6e3dc`.
- No compiler, engine, database, workflow, grader, or production behavior changes.
- Each skill remains below 500 words and contains only `SKILL.md` unless deterministic support code becomes necessary.
- Create and test one skill completely before starting the next.
- Preserve the newer R-648 directives when repairing Claude/Codex onboarding drift.
- Canonical, Claude, and Codex copies of every new skill must have identical SHA-256 values.

---

### Task 1: `vertical-slice-breakthrough`

**Files:**
- Create: `.agents/skills/vertical-slice-breakthrough/SKILL.md`
- Install: `C:/Users/tonio/Projects/trading-forge/.agents/skills/vertical-slice-breakthrough/SKILL.md`
- Install: `C:/Users/tonio/Projects/trading-forge/.claude/skills/vertical-slice-breakthrough/SKILL.md`

**Interfaces:**
- Consumes: a frozen real strategy with zero or partial production bindings
- Produces: a six-column first-divergence trace and one bounded repair contract

- [ ] Preserve the no-skill baseline response from `baseline_vertical_slice`.
- [ ] Initialize the canonical skill with `init_skill.py`.
- [ ] Replace the template with the approved source→extraction→canonical→binding→capability→failure contract, explicit adjacent-tool admission rule, stop rule, and counterexample for genuinely broad failures.
- [ ] Run `quick_validate.py` and require exit `0`; require word count `<500`.
- [ ] Forward-test the zero-binding scenario and a counterexample where two independent traces may run in parallel.
- [ ] Install exact bytes into both runtimes and require three matching hashes.
- [ ] Commit the canonical skill before starting Task 2.

### Task 2: `critical-path-campaign-manager`

**Files:**
- Create: `.agents/skills/critical-path-campaign-manager/SKILL.md`
- Install: `C:/Users/tonio/Projects/trading-forge/.agents/skills/critical-path-campaign-manager/SKILL.md`
- Install: `C:/Users/tonio/Projects/trading-forge/.claude/skills/critical-path-campaign-manager/SKILL.md`

**Interfaces:**
- Consumes: competing findings plus the current V1.0/V1.1 exit condition
- Produces: ranked authorization, explicit deferrals, wake conditions, and a no-loss register

- [ ] Preserve the failing baseline where tool repairs displaced the frozen zero-binding strategy.
- [ ] Initialize canonically.
- [ ] Encode the money-path admission test: work precedes the vertical trace only when it prevents the trace or invalidates its evidence.
- [ ] Require stable deferred IDs, owners, acceptance tests, wake triggers, and a current critical-path sentence.
- [ ] Add rationalization counters for “fix the tools first,” “while we are here,” and “a broad sweep is safer.”
- [ ] Validate, pressure-test the original scenario, and test a counterexample where a broken instrument genuinely must precede the trace.
- [ ] Install exact runtime mirrors, verify hashes, and commit before Task 3.

### Task 3: `source-to-engine-conformance`

**Files:**
- Create: `.agents/skills/source-to-engine-conformance/SKILL.md`
- Install: `C:/Users/tonio/Projects/trading-forge/.agents/skills/source-to-engine-conformance/SKILL.md`
- Install: `C:/Users/tonio/Projects/trading-forge/.claude/skills/source-to-engine-conformance/SKILL.md`

**Interfaces:**
- Consumes: frozen extraction artifact, sealed spec, canonical conditions, bindings, evaluator trace, independent reference
- Produces: V1.0 PASS/FAIL/REFUSE decision with complete semantic membership

- [ ] Preserve the correct baseline refusal of fixture/parity/backtest evidence.
- [ ] Initialize canonically.
- [ ] Encode real-artifact lineage, complete condition/parameter membership, source-vs-framework separation, independent bar comparison, and required meaningful mutations.
- [ ] State that TS/Python agreement proves parity only and profitable output proves no fidelity.
- [ ] Validate and forward-test both the original deceptive-green scenario and a valid real-artifact conformance packet.
- [ ] Install exact runtime mirrors, verify hashes, and commit before Task 4.

### Task 4: `batch-disposition-integrity`

**Files:**
- Create: `.agents/skills/batch-disposition-integrity/SKILL.md`
- Install: `C:/Users/tonio/Projects/trading-forge/.agents/skills/batch-disposition-integrity/SKILL.md`
- Install: `C:/Users/tonio/Projects/trading-forge/.claude/skills/batch-disposition-integrity/SKILL.md`

**Interfaces:**
- Consumes: immutable input manifest plus per-strategy compiler results
- Produces: exactly one official V1.1 disposition per member and a reconciled run verdict

- [ ] Preserve the correct baseline rejection of `38+61+21=120` as sufficient.
- [ ] Initialize canonically.
- [ ] Encode the twelve official V1.1 dispositions from the external ruling.
- [ ] Require refusal evidence fields, reusable capability-unlock classification, duplicate identity, and exact condition membership.
- [ ] Fail and quarantine on missing/duplicate rows, silent semantic loss, unresolved overlays, generic refusals, or nondeterminism; allow evidence-backed refusals.
- [ ] Validate and forward-test the original count-only scenario plus a valid mixed compile/refusal batch.
- [ ] Install exact runtime mirrors, verify hashes, and commit before integration.

### Task 5: Integrate role triggers without duplicating skills

**Files:**
- Modify locally: workspace `.agents/skills/{worker-onboarding,worker-execution,advisor-onboarding,advisor-ruling}/SKILL.md`
- Modify locally: matching workspace `.claude/skills/.../SKILL.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: four validated skill names and role boundaries
- Produces: mandatory discovery at cold start, execution, ruling, and project coordination

- [ ] Copy the newer Claude R-648 onboarding directives into the Codex onboarding copies before adding new pointers.
- [ ] Add worker triggers: vertical-slice on zero/partial bindings; conformance before V1.0 claims; batch integrity during V1.1 runs.
- [ ] Add advisor triggers: campaign-manager before ranking/authorizing; conformance before V1.0 ruling; batch integrity before V1.1 ruling.
- [ ] Add four concise rows to `CLAUDE.md`’s project-skill table.
- [ ] Require worker and advisor onboarding pairs to be byte-identical after integration.
- [ ] Verify pointer-only integration: no copied procedural blocks from the new skills.

### Task 6: Final verification and publication

**Files:**
- Modify: `AGENT-LOGS.md`
- Create: `docs/superpowers/evidence/2026-08-08-v1-worker-advisor-skills-receipt.md`
- Verify: all canonical/runtime skills, onboarding pairs, `CLAUDE.md`, design, and plan

**Interfaces:**
- Consumes: integrated artifact set
- Produces: reviewable pushed branch and reproducible receipt

- [ ] Run all four skill validators and word counts.
- [ ] Compare canonical/Claude/Codex hashes for all four skills.
- [ ] Verify onboarding pair hashes and all required trigger strings.
- [ ] Run `git diff --check`, placeholder scan, and expected-path membership check.
- [ ] Append the required session log with baseline and forward-test evidence.
- [ ] Publish the exact pressure scenarios, observed invariants, static review receipts, and local-only role-integration boundary.
- [ ] Commit explicit paths, push `docs/role-skills-20260808`, and confirm local/remote SHA equality.
