# Graph Engineering Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude-only Graph Engineering skill and a concise project trigger.

**Architecture:** Keep the reusable decision and execution contract in one self-contained skill. CLAUDE.md only declares when it must fire. Validate format mechanically and behavior with fresh-context pressure scenarios.

**Tech Stack:** Markdown agent skill, YAML frontmatter, Python skill validator, Git worktree.

## Global Constraints

- Create no `.agents/skills` or Codex mirror.
- Do not modify advisor or worker onboarding in this pass.
- Keep the skill below 500 words.
- Keep all edits in the explicit-SHA worktree based at `c766f468dd9f63027a7edc8f31506959c1ff2485`.

---

### Task 1: Establish behavioral RED evidence

**Files:** None

**Interfaces:**
- Consumes: three fresh-context coordination prompts
- Produces: observed baseline decisions and missing-response evidence

- [x] Run shared-write, wide-read, and serial-barrier scenarios without the skill.
- [x] Record that the shared-write scenario did not return and required interruption.
- [x] Preserve the two correct baseline decisions as behaviors the skill must not regress.

### Task 2: Create and validate the Claude skill

**Files:**
- Create locally: `C:/Users/tonio/Projects/trading-forge/.claude/skills/graph-engineering/SKILL.md`

**Interfaces:**
- Consumes: the approved design and RED evidence
- Produces: a discoverable `graph-engineering` skill

- [x] Initialize a staging copy with the canonical skill initializer.
- [x] Replace the template with the minimal approved workflow.
- [x] Install the exact skill bytes into Claude's workspace-level skill directory.
- [x] Run `quick_validate.py` against the installed copy and require exit `0`.
- [x] Check the word count is below `500`.

### Task 3: Forward-test the skill

**Files:** None

**Interfaces:**
- Consumes: `.claude/skills/graph-engineering/SKILL.md`
- Produces: fresh-context application evidence

- [x] Run fresh shared-write, wide-read, and serial-barrier scenarios with the skill.
- [x] Require explicit shared-resource inventory, fan-in accounting, and serial grade barrier.
- [x] Tighten only wording associated with an observed miss, then revalidate.

### Task 4: Add the CLAUDE.md trigger

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: validated skill name and trigger
- Produces: project-wide invocation rule

- [x] Add one skill-table row under §11.
- [x] Add one compact coordination rule before parallel dispatch.
- [x] Verify the diff contains no unrelated CLAUDE.md changes.

### Task 5: Verify and publish

**Files:**
- Verify locally: `C:/Users/tonio/Projects/trading-forge/.claude/skills/graph-engineering/SKILL.md`
- Verify: `CLAUDE.md`

**Interfaces:**
- Consumes: final worktree
- Produces: one reviewable commit

- [ ] Run skill validation, word-count, trigger grep, and `git diff --check`.
- [ ] Commit only CLAUDE.md, design, plan, and the required AGENT-LOGS entry. The runtime skill remains local because the app repo intentionally ignores `.claude/skills/`.
- [ ] Confirm commit diff-stat matches the reviewed four-file scope.
- [ ] Push the isolated branch without touching the dirty shared checkout.
