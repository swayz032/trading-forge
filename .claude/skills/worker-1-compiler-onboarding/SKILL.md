---
name: worker-1-compiler-onboarding
description: Use when starting or resuming Trading Forge Worker 1 for Graph Engineering, compiler, Strategy Factory, AR-1138, or the accepted source-faithful compiler vertical.
---

# Worker 1 — Compiler Factory Onboarding

## Identity first

Before reading campaign history, print:

```text
worker_id=worker-1
lane=compiler-factory
role=Team Lead / Graph Engineering -> Compiler -> Strategy Factory
```

You are not Worker 2 and do not inherit PAPER/runtime work.

## Required startup

1. Work only in `C:\Users\tonio\Projects\wt-claude-worker1-20260815`.
2. 🛑 **ARM THE `2s` GPT-BRANCH EAR BEFORE YOU READ ANYTHING ELSE — operator-ordered, and it is a
   REQUIRED STARTUP STEP, not a nicety.** The procedure, the `cd` trap and the fail-closed
   contract live in ONE place — canonical `worker-onboarding/SKILL.md` **§2a**. Read it and follow
   it there; do **not** copy the recipe into this file, because a second copy of a boundary rule
   drifts and stops biting while still reporting PASS.
   - First **check for an existing ear** (`Win32_Process` + parent walk, never `TaskList`) and
     **never kill one you did not arm**. One rig, one channel.
   - 🛑 **A LIVE EAR PROCESS IS NOT YOUR EAR.** An ear armed by a previous or sibling seat delivers
     its events into *that* session and goes silent for you the moment it ends. **The only ear that
     counts is one whose `EAR ARMED` line you saw arrive in YOUR OWN chat.** If you found a process
     but never received that event, you are deaf — arm yours.
     `LIVENESS != OWNERSHIP != DELIVERY.`
   - An ear armed late never hears the window it missed — **backfill it**: after arming, diff the
     branch against the head the newest ruling names and read anything that landed meanwhile.
   - ⚠️ **MEASURED 2026-08-16 (AR-1258 seat):** this skill previously said nothing about the ear,
     so a seat that onboarded through it ran a whole packet deaf and the operator had to catch it.
     Within minutes of arming, the ear caught AR-1259 landing mid-turn. **`AN UNARMED EAR AND A
     QUIET BRANCH ARE THE SAME OBSERVATION.`**
3. Prove branch `claude/worker1-h1-20260815` and a clean status before edits. **Do not trust a
   SHA pinned in this file or in a resume card** — the branch advances every packet, so a pinned
   head is stale by design ([[red-path-decay]]). Prove instead that the *newest ruling's*
   `CURRENT HEAD` is reachable from yours (`git merge-base --is-ancestor`), and reconcile any gap
   before editing. If the tree is dirty, read the newest ruling's disposition for that file rather
   than cleaning it.
4. Read canonical `C:\Users\tonio\Projects\trading-forge\.claude\skills\worker-execution\SKILL.md`; if absent, stop. Do not replace it.
5. Read this directory's `lane-manifest.md` and `role-overlay.md`.
6. Read the **current** Worker 1 card and only the authorities it names. ⚠️ The AR-1138 card at
   `C:\Users\tonio\Documents\Codex\2026-08-14\hey\handoffs\claude-worker-1-ar1138-card.md` is
   **historical** — its "one job" and its pinned head were both overtaken long ago. Take your
   assignment from the **newest GPT ruling on `origin/external-advisor/gpt-rulings`** (its
   `NEXT WORKER AR` / work-order section), never from the oldest card on disk. Assignment is still
   never inferred from a bigger AR number alone — read the ruling and see who it addresses.
7. Report the canonical skill path, manifest, overlay, worktree, branch, head, **the armed ear and
   its baseline SHA**, and `worker_2_default_inbox_loaded=false`.
8. Execute exactly one authorized Worker 1 packet, commit/push/report, then stop for GPT grading.
   A completed packet is a **fresh-session boundary** (AR-1255 §3.1) — do not start the next
   packet in the spent session.

The preserved dirty checkout at `C:\Users\tonio\Projects\wt-h1-wave4-20260712` is read-only evidence. Never clean, reset, copy over, or work from it.

## Intake boundary

Do not scan the entire advisor tree. Load global doctrine, this identity package, the active Worker 1 card, its named authority, and direct cross-lane messages explicitly addressed to Worker 1.

## Stop

Stop on Worker 2 scope, shared-file collision, ambiguous identity/order, invented source semantics, or unprovable worktree identity.
