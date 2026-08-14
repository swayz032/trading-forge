# GPT EXTERNAL ADVISOR RULING — AR-1167

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Status:** SKILL / ONBOARDING BUILD OWNERSHIP

---

# 1. RULING

The two-worker identity/onboarding architecture should be PREPARED in the GPT lane while Claude is paused.

Do not spend Claude quota rediscovering or designing the two-worker onboarding system after reset.

GPT lane owns:

- Worker 1 identity specification;
- Worker 2 identity specification;
- lane-specific ruling/report intake manifests;
- owned/forbidden surface contracts;
- teammate communication contract;
- startup ordering;
- role overlay requirements for the existing `worker-execution` skill;
- candidate repo-staged onboarding/skill source files and acceptance tests/checklist where feasible;
- exact Claude installation/work order.

Claude owns only the environment-specific installation/verification step where the canonical skill files live in Claude's local environment and are not directly writable by the GPT GitHub connector.

---

# 2. IMPORTANT BOUNDARY

The canonical worker skills have previously been referenced from Claude's local skill environment (for example `/root/.claude/skills/...`). GPT currently has GitHub access to the Trading Forge repository but not direct write access to Claude's local `/root/.claude/skills` filesystem.

Therefore GPT must not claim that writing a file to the GitHub advisor branch automatically installs or replaces the active Claude Code skill.

The correct model is:

```text
GPT LANE NOW
  design + freeze exact source/spec
        ↓
repo-staged candidate files / manifests / install order
        ↓
CLAUDE AFTER AR-1138
  narrow local comparison against canonical skill
        ↓
install/copy/link/adapt only what is necessary
        ↓
invoke each onboarding identity
        ↓
prove Worker 1 != Worker 2 identity/inbox/ownership
        ↓
commit/report repo-side changes if any
        ↓
GPT independent review
```

---

# 3. DO NOT REWRITE `worker-execution` BLINDLY

The current architecture decision remains:

- distinct onboarding identities are mandatory;
- the common `worker-execution` execution law may remain shared;
- role-specific execution overlays should be added only where role behavior genuinely differs;
- do not fork the entire worker-execution skill merely because there are two workers.

Until the canonical local `worker-execution/SKILL.md` source is directly available for complete audit, GPT should preserve its existing engineering law and stage only minimal role overlay requirements.

---

# 4. REQUIRED GPT PREP PACKAGE

Before two-worker activation, GPT should have frozen a package equivalent to:

```text
worker-1 onboarding identity
worker-2 onboarding identity
shared execution-law reference
worker-1 role overlay
worker-2 role overlay
worker-1 lane manifest/inbox
worker-2 lane manifest/inbox
Agent Teams communication contract
installation/verification checklist
```

Worker 1 identity:

```text
TEAM LEAD
Graph Engineering -> Compiler -> Strategy Factory
```

Worker 2 identity:

```text
Runtime & Execution Engineer
PAPER -> Qualification Ops -> Autonomous Runtime -> Execution Safety
```

---

# 5. CLAUDE RESET ORDER IS UNCHANGED

This work must NOT interrupt the paused AR-1138 implementation.

When Claude quota returns:

```text
1. Resume exact AR-1138 state.
2. Finish AR-1138.
3. Run required evidence/tests.
4. Commit/push/report.
5. STOP for GPT review.
6. Only after AR-1138 passes, perform the narrow local onboarding/skill installation verification order prepared by GPT.
7. Activate two-worker Agent Teams only after distinct identities are proven.
```

---

# 6. ACCEPTANCE TEST FOR TWO IDENTITIES

Two-worker onboarding is not considered installed merely because two files exist.

Before activation, prove at minimum:

```text
Worker 1 startup -> identifies as Worker 1 / Team Lead
Worker 1 startup -> loads compiler-factory lane only by default
Worker 1 startup -> does not ingest Worker 2 active reports/rulings by default

Worker 2 startup -> identifies as Worker 2 / Runtime & Execution Engineer
Worker 2 startup -> loads paper-runtime-safety lane only by default
Worker 2 startup -> does not ingest Worker 1 active reports/rulings by default

Both -> load shared worker-execution law
Both -> know teammate identity
Both -> use distinct worktree/branch
Both -> fail/stop on cross-lane ownership collision
```

A negative control must prove that invoking Worker 1 onboarding cannot silently resolve to Worker 2 identity and vice versa.

---

# 7. BOTTOM LINE

**GPT should do the thinking and build preparation now. Claude should do only the small environment-specific install/verification after AR-1138.**

This saves Claude quota, keeps AR-1138 untouched, and ensures the second worker is born with a distinct identity rather than spending Claude runtime inventing its own role.