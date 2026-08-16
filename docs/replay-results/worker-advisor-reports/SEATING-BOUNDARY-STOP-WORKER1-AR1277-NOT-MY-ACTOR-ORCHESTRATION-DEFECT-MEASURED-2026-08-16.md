# WORKER-1 SEATING + BOUNDARY STOP RECEIPT — 2026-08-16

**THIS IS NOT A HANDOFF AND NOT ROUTING DOCUMENTATION.** AR-1276A §2 accepted the existing handoff
as complete routing and forbade another. This file does not route, does not re-assign, does not ask
Tonio for anything, and is deliberately **not `AR-`numbered** so it cannot occupy AR-1277 or be
discovered as a worker packet by `scripts/worker-report-latest.mjs`.

It exists because a stop fired and `worker-execution §10` requires a DECLINE-RECEIPT, and `§11b.5`
requires that a finding reach the branch rather than living only in chat.

---

## 1. SEAT

```
worker_id            worker-1
lane                 compiler-factory
worktree             C:\Users\tonio\Projects\wt-claude-worker1-20260815
branch               claude/worker1-h1-20260815
head at seating      e84295ae8115f122bb6b427f42973409b5134b5a
binding              BOUND — guard registered, PreToolUse matcher covers Agent|Task,
                     `GPT worker guard: anchor verified` arrived in this session's own context,
                     and the Bash fence fired live on `.claude/settings.json`
governed dirty       docs/wave25-exit-engine-ab-report.md (AR-1265 §4) — untouched
worker_2_default_inbox_loaded = false
```

Ear: armed by THIS seat on `origin refs/heads/external-advisor/gpt-rulings`, 2s poll, cwd = this
worktree. `EAR ARMED @ fe4c68eb52aecb5b2021dce2ea0f51db88a53b0f` was **delivered into this
session's own chat**. Red-proofed on a throwaway before trusting it: EMITS on move / SILENT with no
move / REFUSES from the non-repo decoy dir (exit 2) and on an absent ref (exit 3).

An **orphaned** ear process (pid 26992, parent 21192 gone, sole live `claude.exe` is this seat's)
was found watching the same ref. It was **not killed** — this seat did not arm it.

---

## 2. THE STOP

Newest ruling **AR-1276A** (`fe4c68eb`, channel head). Its next required artifact is **AR-1277**,
and §8 fixes the actor:

```
actor = top-level control-plane / guard-repair seat
NOT ordinary bound Worker-1
NOT Worker-1 subagent
```

This seat **is** ordinary bound Worker-1 — demonstrated, not asserted: its own guard denied Bash
access to `.claude/settings.json`, which is one of the surfaces AR-1277 must repair. AR-1276 graded
that refusal as correct, and AR-1276A §10 forbids the Agent probe, the frozen eight, the Opus retry
and PowerShell side-doors. **Worker-1 therefore has zero authorized packets**: §9 gates the normal
Worker-1 acceptance probe *behind* AR-1277 landing.

`STOP FIRED: assigned actor class is not this seat. No AR-1277 work attempted, in whole or in part.`

---

## 3. THE ONE NEW MEASUREMENT — AR-1276A §8 ORCHESTRATION DEFECT IS CONFIRMED

AR-1276A §8/§11 left this as a conditional: *"If no top-level control-plane seat can be instantiated
without asking Tonio to run commands … treat that as an orchestration defect."* It is no longer
conditional. **Measured this session:**

```
Worker-1 bound seat        HAS an entry path:  scripts/worker1_seat_launch.ps1
                                               scripts/install_worker1_seat_shortcut.ps1
control-plane / guard-repair seat
                           HAS NO entry path:  no launcher, no installer, no shortcut script
```

Search over `scripts/` for `control-plane|control_plane|guard-repair|guard_repair` returns exactly
one hit, and it is **historical prose, not a mechanism** — `scripts/claude_toolbox.mjs:70`:
`"RE-PINNED AGAIN 2026-08-16 by the guard-repair seat, on the operator's explicit instruction"`.

**Positive control for that near-absence:** the same instrument over the same directory returns 19
`worker1` hits across 6 files. The absence is real, not a bad path.

⇒ The guard-repair seat **exists as an actor class and has acted before**, but it was instantiated
**by the operator's explicit instruction** — exactly the manual bootstrap AR-1276A §8/§10 forbids as
a workflow. **The missing machine mechanism is a control-plane seat launcher/installer of the same
shape Worker-1 already has.**

This seat **identifies** that defect and **does not fix it**: `scripts/worker1_seat_launch.ps1` sits
inside AR-1277's authorized scope, not Worker-1's. Fixing it from here would be the self-protection
bypass AR-1276 graded correct to refuse.

---

## 4. FROZEN EIGHT — RE-VERIFIED INDEPENDENTLY BY THIS SEAT, NOT QUOTED

Read directly from `docs/replay-results/svkm-extraction-certified/grade/opus-v2/` via `Read`/`Grep`
(Bash is fenced from that surface):

```
isolated_fallback_queue_t1.json   queue[]    = 8 entries   (counted, lines 29-92)
                                  excluded[] = 4 entries
                                  "attempts": {}           -> READY 8 / SPENT 0
isolated-receipts-t1/             README.md ONLY           -> no .attempt/.dispatch/.raw/.completion
```

```
Agent/subagent model executions this session : 0
Opus calibration retries                     : 0
Frozen G2 calls executed                     : 0
Writes to any protected surface              : 0
```

Nothing in the frozen namespace, the guard manifest, the toolbox, or the queue was written.

---

## 5. WHAT THIS RECEIPT DOES *NOT* CLAIM

- It does **not** claim AR-1277 started. It has not.
- It does **not** re-route AR-1277; the accepted handoff already carries the packet.
- It does **not** prove the guard would DENY a real Agent event — that is precisely AR-1277's open
  witness, and this seat performed no Agent call to find out.
- No CI. GitHub exposes no status checks at this head; all evidence here is local and read-only.

`NEXT: AR-1277 from a top-level control-plane / guard-repair seat. Worker-1 stands down until a
ruling releases it. The nearest engineering repair is the missing control-plane launcher in §3 —
owned by that seat, not by this one, and not by Tonio.`
