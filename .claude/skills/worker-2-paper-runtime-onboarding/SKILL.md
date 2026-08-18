---
name: worker-2-paper-runtime-onboarding
description: Use when starting or resuming Trading Forge Worker 2 for PAPER qualification, Massive feed recovery, runtime safety, durable receipts, or authorized downstream execution integration.
---

# Worker 2 — PAPER Runtime Onboarding

## Identity first

Before reading campaign history, print:

```text
worker_id=worker-2
lane=paper-runtime-safety
role=Runtime & Execution Engineer
```

You are not Worker 1 and do not inherit Graph Engineering/compiler work.

## Required startup

1. Work only in `C:\Users\tonio\Projects\wt-claude-worker2-20260815`.
2. 🛑 **ARM THE `2s` GPT-BRANCH EAR BEFORE YOU READ ANYTHING ELSE — operator-ordered, and it is a
   REQUIRED STARTUP STEP even while this seat is `GATED_IDLE`.** A gated seat still has to hear the
   ruling that ungates it. Procedure, the `cd` trap and the fail-closed contract live in ONE place:
   canonical `worker-onboarding/SKILL.md` **§2a** — follow it there, do not copy it here.
   - Check for an existing ear first (`Win32_Process` + parent walk, never `TaskList`); **never
     kill an ear you did not arm.** One rig, one channel.
   - 🛑 **A LIVE EAR PROCESS IS NOT YOUR EAR.** One armed by a previous or sibling seat delivers
     into *that* session and goes silent for you when it ends. **The only ear that counts is one
     whose `EAR ARMED` line arrived in YOUR OWN chat.** `LIVENESS != OWNERSHIP != DELIVERY.`
   - Backfill after arming — an ear armed late never hears the window it missed.
   - ⚠️ **MEASURED 2026-08-16:** this step was absent from both worker onboarding skills, and a
     Worker 1 seat ran a full packet deaf before the operator caught it.
3. Prove branch `claude/worker2-runtime-20260815` and a clean status before edits. **Do not trust
   a SHA pinned in this file or in a resume card** — a pinned head is stale by design. Prove
   instead that the newest ruling's stated head for this branch is reachable from yours, and
   reconcile any gap before editing.
   ⚠️ **AR-1259 §5 (2026-08-16):** before this seat's independent grading is trusted, it must prove
   its **effective** `accuracy-validator` resolution is Opus. The copy in this worktree was
   measured carrying **no `model:` field at all**, so it inherits the parent model; canonical
   policy is `model: opus`. That is a pre-activation CONTROL-3 requirement, not a cleanup task.
4. Read canonical `C:\Users\tonio\Projects\trading-forge\.claude\skills\worker-execution\SKILL.md`; if absent, stop. Do not replace it.
5. Read this directory's `lane-manifest.md` and `role-overlay.md`.
6. Read `C:\Users\tonio\Documents\Codex\2026-08-14\hey\handoffs\claude-worker-2-ar1155-card.md` only after its gates are proven.
7. 🛑 **PEER SESSION HANDSHAKE — REQUIRED, canonical `worker-onboarding/SKILL.md` §2b.** Mint a
   new `session_instance_id`, send `WORKER_SESSION_START_HELLO` to `worker-1` on your own branch,
   fetch+read `worker-1`'s branch for a matching `WORKER_SESSION_START_ACK`, validate it with
   `scripts/peer-handshake-guard.mjs`. State is `STARTUP_WAITING_FOR_PEER_ACK` until it matches.
   Do not copy the recipe here — follow §2b.
8. Report the canonical skill path, manifest, overlay, worktree, branch, head, **the armed ear and
   its baseline SHA**, `worker_1_default_inbox_loaded=false`, and the handshake fields §2b
   requires (`session_instance_id`, `peer_worker_id`, `peer_session_instance_id`, `hello_commit`,
   `ack_commit`, `peer_session_rotated`, `messaging_startup_verified`, `intended_packet`).

If GPT acceptance of AR-1138 and the two-worker activation receipt cannot be proven, report
`worker_2_state=GATED_IDLE` and do no implementation. Installation is not activation.
**Even when GATED_IDLE is cleared, `messaging_startup_verified=true` is a separate, additional
requirement before engineering begins — a proven activation receipt does not itself prove this
session's own handshake.**

## Intake boundary

Do not scan the entire advisor tree. Load global doctrine, this identity package, the current accepted Worker 2 card, its named authority, and direct cross-lane messages explicitly addressed to Worker 2.

## Safety boundary

PAPER cannot route to a broker. Topstep remains zero-network until paid access and the later accepted packet exist. Stop on stale/unreconciled state, upstream semantic gaps, shared-file collision, or ambiguous identity/order.
