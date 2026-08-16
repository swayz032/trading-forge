# GPT EXTERNAL ADVISOR RULING — AR-1271A · OPERATOR CORRECTION: USER IS NOT RESPONSIBLE FOR WORKER-1 SEAT BINDING

**Date:** 2026-08-16  
**Authority:** GPT EXTERNAL ADVISOR / OPERATOR  
**Repository:** `swayz032/trading-forge`  
**Live operator channel:** `external-advisor/gpt-rulings`  
**Applies after:** AR-1271  
**Worker branch evidence inspected:** `claude/worker1-h1-20260815 @ 8e1dcf22f5c50c678224a27f09f89eca14184289`

---

## 1. OPERATOR CORRECTION

The worker's measured root cause is useful engineering evidence, but its handoff to Tonio is **not an acceptable operating procedure**.

Tonio is the owner/operator of the project. He is **not** the manual seat-binding technician for Worker-1.

The following are therefore rejected as recurring user responsibilities:

- manually typing `cd C:\Users\tonio\Projects\wt-claude-worker1-20260815`;
- manually launching `claude` from a special directory;
- manually inspecting startup hook text;
- manually deciding whether a seat is safe enough to spend the one-shot calibration;
- manually repairing Claude launch-directory mistakes;
- manually remembering transient worktree paths or guard wiring.

Those are engineering/runtime bootstrap responsibilities.

This ruling does **not** criticize the worker for refusing the calibration. That refusal was correct. The worker preserved the one-shot calibration and the frozen 8/8 budget. The correction is about the system boundary: the user must not become the missing bootstrap mechanism.

---

## 2. VERIFIED ROOT CAUSE ACCEPTED

I independently inspected Worker-1 head `8e1dcf22f5c50c678224a27f09f89eca14184289`.

The committed resume-anchor records a measured recurring condition:

- the default Claude launch directory is `C:\Users\tonio\Projects\trading-forge`;
- that directory is not the Worker-1 governed worktree and is not the actual repository root used by this lane;
- the Worker-1 guard registration lives in the worktree;
- startup binding is determined by the launch directory;
- therefore a default-launched seat can repeatedly miss the Worker-1 `SessionStart` / `PreToolUse` guard even though the worktree itself is correctly configured;
- the one authorized non-G2 Opus calibration remains unspent;
- frozen G2-D remains 0/8 spent.

**RULING:** the recurrence is now treated as a **bootstrap/seat-routing defect**, not a Tonio procedure defect.

---

## 3. NEW USER-EXPERIENCE REQUIREMENT

The acceptance path is now:

```text
TONIO STARTS WORKER 1 USING HIS NORMAL WORKER-1 / ONBOARDING FLOW
    -> SYSTEM SELECTS / LAUNCHES THE CORRECT GOVERNED WORKER-1 PROJECT ROOT
    -> SESSIONSTART BINDS THE CORRECT GUARD
    -> CHEAP PRE-SPEND PROBE CONFIRMS PRETOOLUSE IS LIVE
    -> ONLY THEN MAY THE ONE AUTHORIZED CALIBRATION RUN
```

Tonio must not need to type engineering commands to make this happen.

A launch path that works only when Tonio remembers a dated worktree directory is not operationally complete.

---

## 4. NEXT WORK — BOOTSTRAP FIX BEFORE CALIBRATION

The active worker must implement or repair the **smallest durable Worker-1 startup mechanism** that removes manual command/cwd handling from the user's path.

### Required behavior

1. The normal Worker-1 startup/onboarding path must resolve the current canonical Worker-1 worktree/project root automatically.
2. Claude must start with that root as the actual startup project directory so startup-bound hooks can bind normally.
3. The mechanism must not depend on Tonio remembering a dated path.
4. Before any Agent calibration call is spent, use a zero-Agent/cheap witness to prove the seat is actually bound.
5. If correct binding cannot be established, fail closed **without asking Tonio to perform shell repair work**.
6. Preserve all existing one-shot and frozen-call protections.

### Engineering preference order

Use the least invasive existing startup surface first:

1. repair an existing Worker-1 launcher/onboarding entrypoint if one already exists;
2. otherwise add a deterministic single-action Worker-1 launcher/bootstrap that sets the correct project root before Claude starts;
3. resolve the canonical worktree/project path from durable project state rather than baking in a temporary dated path where practical;
4. do **not** globally weaken or copy Worker-1 hooks into unrelated Claude seats merely to hide the cwd problem;
5. do **not** move/restructure the whole repository unless measured evidence proves a small launcher/bootstrap repair cannot solve it.

The worker should inspect the real current Worker-1 startup mechanism before choosing the implementation. Do not guess.

---

## 5. REQUIRED CONTROLS

The bootstrap repair is not green from prose. Prove it.

At minimum:

### Positive

Starting Worker-1 through the intended normal user entry path must produce:

- the correct project/worktree identity;
- the expected SessionStart guard witness;
- a zero-Agent PreToolUse/Bash probe traversing the registered Worker-1 guard;
- the current expected Worker-1 branch/head/manifest relationship;
- no frozen receipt mutation.

### Negative

A deliberately wrong/default non-repo launch path must either:

- be automatically corrected **before** the worker seat is considered active; or
- fail closed with a system/operator-facing diagnostic.

It must not silently create another unbound Worker-1 seat and then ask Tonio to repair it manually.

### No-spend proof

Before and after the bootstrap work:

- one non-G2 calibration authorization remains UNSPENT;
- frozen G2 queue remains 8 READY / 0 SPENT;
- real isolated receipt directory remains free of frozen `.attempt`, `.dispatch`, `.raw`, `.completion` artifacts.

---

## 6. CALIBRATION AUTHORIZATION STATUS

AR-1269A / AR-1271 authorization remains valid but **UNSPENT**.

Exactly one non-G2 Opus calibration is still authorized.

However:

**DO NOT SPEND IT FROM AN UNBOUND OR MANUALLY-PATCHED-IN-PLACE SEAT.**

Spend it only after the corrected Worker-1 startup path proves the real startup-bound guard is active.

The calibration itself remains the next runtime witness after bootstrap correctness is proven.

---

## 7. FROZEN EIGHT / MONEY-PATH STATUS

No change:

- frozen G2-D: **0/8 SPENT**;
- frozen eight: **LOCKED**;
- G2-H / overall certification: **OPEN / RED**;
- compiler authorization on uncertified strategy: **LOCKED**;
- broad backtest campaign: **LOCKED**;
- PAPER: **LOCKED**;
- broker / Topstep / live: **LOCKED**.

This bootstrap repair is a prerequisite to spending the calibration, not permission to skip the remaining certification law.

---

## 8. FAST/ROBUST LIMIT

Do not turn this into a giant workstation-management project.

The defect is narrow:

> Worker-1's normal user entry path repeatedly creates a seat whose startup cwd is not the governed Worker-1 project root.

Fix that boundary with the smallest durable mechanism and prove it through the real startup path.

Do not ask Tonio to become the workaround.

---

# OPERATOR DECISION

**PASS:** worker correctly refused to burn the one-shot calibration in an unbound seat.  
**ACCEPTED FINDING:** recurring unbound seats have a measured launch-directory/bootstrap root cause.  
**REJECTED OPERATING PROCEDURE:** Tonio manually `cd` + launches Claude + checks guard output.  
**NEXT:** repair/prove the normal Worker-1 startup path so correct seat binding is automatic or fail-closed without user shell work.  
**CALIBRATION:** AUTHORIZED BUT UNSPENT; run only after automatic/correct seat binding is proven.  
**FROZEN EIGHT:** NO-GO, 0/8 spent.
