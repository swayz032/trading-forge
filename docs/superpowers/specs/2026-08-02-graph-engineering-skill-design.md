# Graph Engineering Skill Design

Date: 2026-08-02
Scope: Claude Code only

## Goal

Create a concise project skill that decides when work should be a graph, derives only real dependencies, and makes parallel execution fail closed on missing work or shared resources.

## Placement

- Claude runtime install: workspace-level `.claude/skills/graph-engineering/SKILL.md`
- Versioned project trigger: one row and one compact coordination rule in `CLAUDE.md` §11
- The app repo intentionally ignores `.claude/skills/`; the runtime skill is installed locally while this design preserves its contract for review.
- No `.agents/skills` mirror, Codex installation, advisor-onboarding edit, or worker-onboarding edit in this pass.

## Required behavior

The skill must:

1. Run the fake-edge test: an edge exists only when a downstream node consumes an upstream artifact or both nodes contend for mutable state.
2. Inventory hidden shared resources: files, Git index/HEAD/stash, database rows, ports, credentials, rate limits, services, and grade slots.
3. Keep genuinely dependent work serial.
4. Use bounded node contracts with pinned inputs, structured outputs, owner, write surface, acceptance, stop behavior, and first observable.
5. Give concurrent writers isolated worktrees; a sole integrator owns shared-file reconciliation.
6. Use fresh-context verifiers that consume artifacts, not worker chat.
7. Count expected and received fan-in; missing nodes become explicit incomplete outcomes.
8. Preserve immutable anchors and reserve formal grading for the integrated object.
9. State that graphs buy width, not judgment, and are wrong for small or irreducibly sequential work.

## Skill TDD

Baseline pressure scenarios cover shared-file repairs, a wide read-only route audit, and a patch→test→grade chain. The shared-file scenario produced no terminal response and was interrupted; this demonstrates why every graph needs a node timeout and fan-in ledger. The other baselines correctly found parallel breadth and serial barriers, so the skill must preserve—not complicate—those decisions.

Forward tests will rerun equivalent fresh-context scenarios with the skill supplied and require:

- serial ownership for overlapping writes;
- bounded fan-out for independent reads;
- explicit terminal accounting for a silent node;
- no grade before integrated verification;
- no claimed speedup without a measured critical-path comparison.

## CLAUDE.md change

Keep CLAUDE.md concise. Add `graph-engineering` to the project skill table and add one rule under coordination: before parallel dispatch, invoke the skill and publish the real edges, shared resources, expected fan-in, and serial barriers. The skill holds all procedural detail.
