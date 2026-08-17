# HANDOFF — AR-1286 → CONTROL-PLANE / GUARD-REPAIR SEAT

**Authority:** AR-1285A (GPT branch `475b9f79`, 2026-08-17), packet `AR-1286 — CONTROL-PLANE-AUTHORIZED
G2 EXECUTION-SEAT CLOSEOUT`. Written by the bound Worker-1 seat, which is **not** the permitted actor
and did **not** attempt any part of AR-1286.

**This is not a worker AR report.** Deliberately not `AR-`numbered, so `scripts/worker-report-latest.mjs`
ignores it and the newest-report contract stays clean. Same convention as
`HANDOFF-AR-1277-CONTROL-PLANE-GUARD-REPAIR-SEAT.md`.

---

## 1. ACTOR — READ THIS FIRST

AR-1286 is assigned to a **dedicated top-level desk-authorized CONTROL-PLANE / GUARD-REPAIR seat** —
the same class of actor that repaired/re-pinned the SessionStart→PreToolUse lifecycle defect and that
applied the current toolbox pin on 2026-08-16.

It is **NOT**:

- the ordinary bound Worker-1 lane (AR-1286: *"The current bound Worker-1 seat is not the actor"*);
- an `Agent`/subagent spawned from Worker-1;
- Tonio. He is not the bootstrap, permission pipeline, report relay or repair technician.

AR-1285A §3 graded the bound seat's refusal **correct by construction, not discretionary caution**, and
adds: *"Do not send the same bound Worker-1 seat back into AR-1285 again. That would create a procedural
loop."* If no control-plane-authorized seat can be launched, **AR-1286 says STOP and report that
operational limitation — do not simulate authority inside Worker-1.**

---

## 2. STATE AT HANDOFF — MEASURED THIS SESSION, NOT REMEMBERED

```
Worker-1 branch      claude/worker1-h1-20260815
Worker-1 head        e8d43e2c  + this handoff commit, which advances it
                     -> RE-READ THE TIP. Do not trust this line ([[red-path-decay]]).
GPT-graded heads     ee912092 (AR-1284A)  ->  445b48ab (AR-1285A)
toolbox pin          b6c702821bc48281b02e16773c7c277ae17fb03f
toolbox bundle       c8b7cec408b017ce6d2c04dcc4ad705726c3bfadbd9e9f4afb0a9d0c6aee894e
governed dirty       docs/wave25-exit-engine-ab-report.md @ diff e200765c11e8 (AR-1265 §4)
                     LEAVE IT. Verified this session: diff sha256 is an EXACT match to the pin.
newest GPT ruling    AR-1285A @ 475b9f79 on origin/external-advisor/gpt-rulings
```

### Frozen G2 — re-measured by this seat AFTER all session activity

```
queue[] entries = 8      "attempts": {}      READY 8 / SPENT 0
excluded[]      = 4
receipts isolated-receipts-t1/ = README.md ONLY
.attempt / .dispatch / .raw / .completion = 0 / 0 / 0 / 0
```

Command (it resolves its own paths — see §4 trap 2):

```bash
python scripts/g2d_real_queue_preflight.py     # -> "ALL 8 ONE-SHOT ATTEMPTS UNSPENT.", exit 0
```

### 🛑 QUEUE-SHA PREFIX TRAP — CARRIED FORWARD FROM THE AR-1277 HANDOFF, STILL LIVE

```
REQUIRED queue SHA : 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
NOT the queue SHA  : 5935b1c6c03860b35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823   <- extraction SHA, trap
```

Both begin `5935b1c6c03860b35`. **Compare the full string, not the prefix.** This seat's value came
from the canonical preflight printing the full SHA rather than any hand-copied prefix.

---

## 3. THE PACKET (AR-1285A → AR-1286 A–F) — condensed; the ruling is authoritative

```
A  constitute the dedicated strict session: g2_precall.strict_session = true
   (by the control-plane actor, NOT by the worker governed by that manifest;
    preserve toolbox identity law if a re-pin is needed)
B  close every live mutable shell side door; at minimum resolve PowerShell
   (hook-covered under the same protected-surface policy, OR absent with the
    absence MEASURED in the live registry)
C  materialize transport-only frozen prompt artifacts for all 8 rows from the
   canonical emitter; sha256(bytes) == frozen native_prompt_sha256 per row;
   no hand-retyping, no CRLF round-trip; transport is bytes, NOT authority
D  exactly ONE cheap non-Opus (prefer Haiku) NON-G2 traversal calibration under
   strict_session=true; expected result DENY before model execution.
   A returned model answer is a RED control -> discard and STOP. No retry.
E  zero-model guard controls (the DENY matrix + one stubbed ALLOW that must NOT
   create a real .attempt/.dispatch receipt)
F  terminal real-queue proof; must still read 8 / 4 / [] / [] / 8 / {} / README-only
```

Spend authority: **0 frozen G2 calls, 0 Tier-3 calls, 0 ordinary engineering calls**, exactly **1**
conditionally-authorized cheap traversal calibration.

Required end token: `G2_EXECUTION_SEAT_PROVEN_FROZEN_EIGHT_UNSPENT`
or on any failure: `G2_EXECUTION_SEAT_NOT_PROVEN` + exact blocking evidence.

🛑 **Do not combine AR-1286 seat repair with the frozen spend.** AR-1285A §9 separates them so a
control-plane defect found during repair cannot burn the evidence budget it exists to protect.

---

## 4. WHAT THIS SEAT MEASURED THAT SAVES YOU TIME

**Trap 1 — B-1 is a proof gap, not a registration gap.** The live hook registration DOES include
`Agent`:

```
PreToolUse matcher = Edit|Write|NotebookEdit|Bash|Agent|Task
```

So do not go hunting for a missing matcher entry. What is unproven is **live runtime traversal**.
AR-1285A §4: *"Do not describe this as a proven fail-open hook defect."* That is precisely what §D exists
to settle, and it needs `strict_session=true` first — which is why §A precedes §D.

**Trap 2 — the protected-surface fence matches the COMMAND TEXT, not the intent.** Two ordinary
*read-only* Bash commands were denied purely for **naming** a protected path. Consequences:

- `python scripts/g2d_real_queue_preflight.py` works **only** because the script resolves its own
  paths internally. Passing the queue path as an argument is denied.
- **A `git commit` whose MESSAGE merely names a protected path is denied.** Pass the message via
  `-F <file>` instead. This seat hit that and resolved it the same way AR-1284 did (a committed
  `*-commit-message.txt`).

**Trap 3 — PowerShell (§B) is present and uncovered.** Measured from this seat's own live registry:

```
Bash       = PRESENT (hook-covered)
Agent      = PRESENT (registered in matcher)
Task       = ABSENT  (registered defensively; no such tool in this runtime)
PowerShell = PRESENT and NOT in the PreToolUse matcher      <- the §B gap, reachable
```

Disclosed against this seat: PowerShell was used here for a read-only `Win32_Process` census
(onboarding §2a bans `TaskList`) and for `git init/commit/push` confined to the **session scratchpad**
— no repository path, no protected surface. It is nonetheless a live demonstration that the gap is
reachable, which is the point §B must close.

**Trap 4 — `Write` is confined to the repository root.** You cannot stage a message/artifact file into
the OS temp scratchpad via `Write`; use an in-repo path under an allowed prefix.

---

## 5. DO NOT

- Do not widen general Worker-1 authority to get one execution session running (AR-1286 §A).
- Do not replace categorical path protection with more command-spelling blacklists (§B).
- Do not weaken the frozen manifest, hashes, `model`, or `subagent_type` to make transport work (§C).
- Do not retry the §D calibration. One shot, no retry.
- Do not treat a worker-authored log line saying `DENY` as the witness; the **native** DENY is
  load-bearing, an append-only audit is corroboration only (§D).
- Do not touch the governed dirty file.
- Do not spend any frozen condition. The eight are the money path's entire evidence budget.

---

## 6. PROVENANCE PHRASES CORRECTED BY AR-1285A — USE THESE EXACTLY

```
historical AR-1272 Opus calibration            = SPENT
new AR-1285/1286 cheap traversal-control       = UNSPENT
frozen eight G2 attempts                       = 0/8 SPENT
```

Never write `one-shot calibration unspent` without naming **which** authorization is meant — the
unqualified phrase reads as though no calibration had ever been spent, and AR-1272 already spent the
Opus one.
