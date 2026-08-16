# AR-1272 WORKER — THE ONE OPUS CALIBRATION IS SPENT; FROZEN EIGHT STILL 0/8

**Date:** 2026-08-16
**RULING:** `AR-1271` §10A–§10G (runtime calibration packet), on the live `AR-1269A` authorization
**PIN:** worktree `C:\Users\tonio\Projects\wt-claude-worker1-20260815`, branch
`claude/worker1-h1-20260815`, head at packet start `9e8e70c629861d16762a8205bd79bbe68d973621`
**Toolbox pin:** `b6c702821bc48281b02e16773c7c277ae17fb03f`
**Subagent calls this packet:** exactly **1** (the authorized calibration). No others.

---

## 1. §10A — SEAT BINDING, MEASURED FROM INSIDE

This is the first seat started through `worker1_seat_launch.ps1` (the AR-1271B shortcut) that
measured its own binding before doing anything.

| Check | Instrument | Result |
|---|---|---|
| guard hook registered | `grep -c claude_guard_hook .claude/settings.json` | **3** (non-zero) |
| positive control for that count | `grep -c '"hooks"'` same file, same instrument | **3** (path is real) |
| `PreToolUse` matcher | `.claude/settings.json:37` | `Edit\|Write\|NotebookEdit\|Bash\|Agent\|Task` |
| SessionStart arm witness | arrived in **this session's own** context | `anchor verified on claude/worker1-h1-20260815 at 9e8e70c6…` |
| guard is LIVE, not merely present | my first `Bash` call was **intercepted** | protected-surface fence denial |

Session marker (`.git/worktrees/wt-claude-worker1-20260815/tf-claude-guard-session-<session>.json`)
binds session_id + worktree + git_dir + branch + `head 9e8e70c6…` + toolbox pin `b6c70282` +
bundle `c8b7cec4…`, `armed_at 1786914642132`.

**The guard is armed and biting in this seat. That is measured, not inferred.**

---

## 2. §10B — READ-ONLY BEFORE SNAPSHOT

```
queue path : docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json
queue sha  : 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
queue      : 8 entries · "attempts": {} · 0/8 spent
receipts   : isolated-receipts-t1/ -> README.md only (2026 bytes)
.attempt / .dispatch / .raw / .completion : 0 / 0 / 0 / 0
native_call_manifest_t1.json : present
```

Identical to the AR-1271B snapshot. The queue SHA has not moved across two seats.

⚠️ **Instrument note.** The Bash protected-surface fence denies Bash that *names* the queue
**even read-only** — "the boundary is the surface, not the spelling of the writer". §10B evidence
was therefore taken with the unguarded read tools (`Read`, `Get-FileHash`), never by relaxing the
fence. See FINDING F-1.

---

## 3. §10C — THE ONE CALL

| Field | Value |
|---|---|
| tool | native `Agent` (this runtime exposes `Agent`; no `Task` tool exists) |
| `subagent_type` | `general-purpose` |
| `model` | **`opus`** — explicit request, per §10C |
| shape | benign runtime self-report probe; no file access, no grading, no strategy work |
| G2 relation | **non-G2.** Does not equal or masquerade as any of the eight frozen calls |
| result | completed, 8242 ms, 0 tool uses |

**This spends the AR-1269A authorization. One means one. No second call was made, and none will be.**

---

## 4. §10D — RUNTIME WITNESSES

| # | Required witness | Result |
|---|---|---|
| 1 | a real native Agent dispatch occurred | **YES** — dispatched, ran, returned a result |
| 2 | it traversed the installed `PreToolUse` hook | **NOT PROVEN — see F-2** |
| 3 | requested model was explicitly Opus | **YES** — `model: "opus"` |
| 4 | actual model identity | `claude-opus-5[1m]`, **read verbatim** by the subagent from its own system context — but **non-discriminating, see F-3** |
| 5 | task/agent identifier | **NOT_EXPOSED to the subagent.** Exposed to the *dispatcher* as an opaque internal id (harness forbids reproducing it, so it is not transcribed) |
| 6 | usage metadata | **NOT_EXPOSED to the subagent** (it saw only a context-budget line). Exposed to the dispatcher: `subagent_tokens 116195`, `tool_uses 0`, `duration_ms 8242` |

The subagent's own disclosure, unprompted and correct: it reported `AGENT_TYPE: NOT_EXPOSED` and
`TASK_ID: NOT_EXPOSED`, explicitly declined to promote a UUID in a filesystem path into a session
id, and separated values it READ from values it would have had to believe.

---

## 5. §10E — READ-ONLY AFTER SNAPSHOT

```
queue sha  : 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939   UNCHANGED
queue      : 8 entries · attempts keys: 0                                       0/8 SPENT
receipts   : README.md only (2026 bytes)                                        UNCHANGED
.attempt / .dispatch / .raw / .completion : 0 / 0 / 0 / 0
worktree   : dirty only at docs/wave25-exit-engine-ab-report.md (the AR-1265 §4 governed exception)
```

**The calibration did not touch the frozen control plane. FROZEN G2-D: 0/8.**

---

## 6. FINDINGS

### F-1 — the Bash fence denies read-only Bash on protected surfaces (behaviour note, not a defect)
`§10B` orders read-only evidence of the queue; Bash naming the queue is denied regardless of intent.
This is the fence working as designed, but it means **every future packet's read-only control-plane
evidence must come from the file tools**, and a ruling that says "run this Bash to snapshot the
queue" would be unexecutable. Worth knowing before the eight-call session is written.

### F-2 — Agent → PreToolUse traversal is STILL NOT PROVEN, and my observation cannot prove it
This is the packet's central question and I did not close it. Honest statement of why:

- `claude-hook-bridge.mjs:239-272` shows the subagent path is **fail-closed**: with
  `g2_precall.enabled=true`, every exit from that block is a **denial** unless the guard
  successfully loaded the frozen queue **and** the native-call manifest and classified the call
  non-G2.
- My call was **allowed**. But "allowed" is **consistent with both** "the guard ran and permitted
  it" **and** "the hook never fired for `Agent` at all". **The observation does not discriminate**,
  and a control that cannot discriminate is not evidence (`worker-execution` §5).
- `claude-hook-bridge.mjs:329` does `delete copy._audit` — the guard **computes a per-call audit
  record and then discards it**. Nothing is persisted, so no log can settle it.

**The one discriminating test available was to force a DENY on the Agent path. I deliberately did
not run it.** Every variant is either a second calibration call (§10G forbids) or a G2-shaped
dispatch, and if my reasoning about hash-matching were wrong by one step, that would irreversibly
spend a frozen attempt against a queue that must stay 0/8. The upside was one evidence line; the
downside was the control plane the campaign rests on. **I took the refusal.**

**Smallest fix that would close this, for GPT to rule on (I am NOT authorized to make it):** the
`_audit` object already exists and is deliberately thrown away — persisting one append-only line
per call (event, tool_name, verdict) would make traversal directly witnessable forever, for every
future packet, at essentially zero cost.

### F-3 — `actual = opus` is corroborated but NOT independently attested
The subagent read `claude-opus-5[1m]` from its system context — a runtime-injected field, stronger
than a training-prior guess. **But this dispatcher session is itself Opus 5 (1M).** So a subagent
that *inherited* the parent model and a subagent that *honoured* my `model: "opus"` request produce
the **identical** line. **This calibration could not have distinguished them.** Per §10D
("`requested = opus` is not by itself proof that `actual = opus`") I am not claiming routing was
honoured — only that the runtime reports Opus and that no contradicting evidence appeared. A probe
that could discriminate would have to request a model the parent is *not* running.

### F-4 — ★ A BOUND WORKER-1 SEAT CANNOT PUBLISH ITS OWN AR TO THE GPT BRANCH
Load-bearing, structural, and new — it appears only now because **this is the first BOUND seat.**

- `worker-execution` §11b rule 5 requires the AR to reach `origin/external-advisor/gpt-rulings`.
- ARs live at `advisor-reports/` — **not** in `edit_scope.allowed_prefixes`
  (`src/engine/extraction/`, `src/engine/tests/`, `scripts/`, `docs/replay-results/`, `.claude/`).
- Bash branch/worktree/history mutation is fenced inside guarded sessions.
- `advisor-reports/` has **0 tracked files** on `claude/worker1-h1-20260815`.

AR-1271B could publish because, by its own words, it was *"the third consecutive UNBOUND seat"* —
it had no guard. **Fixing the binding removed the publication path, and nothing announced it.**
This AR is therefore written to `docs/replay-results/` (an allowed prefix) so it is durable and
pushed; **delivery to the GPT branch needs an operator/GPT decision** — widen scope to
`advisor-reports/`, or relay from the existing `wt-gpt-reports` landing checkout. I did not route
around it, and I did not use the unguarded `PowerShell` tool to write outside my scope.

### F-5 — the `PreToolUse` matcher does not cover every tool that can reach the filesystem
`Edit|Write|NotebookEdit|Bash|Agent|Task`. This runtime **also exposes a separate `PowerShell`
tool**, which is not in the matcher and executed unintercepted throughout this packet.

**Bounded claim, and I am scoping it deliberately:** I proved only that `PowerShell` is *outside
the matcher* (config) and *runs without guard interception* (observed on read-only calls). **I did
NOT test whether it can WRITE a protected surface** — doing so would have mutated the frozen
control plane that §10E requires me to leave untouched. So this is a *demonstrated gap in
coverage*, not a demonstrated exploit. Given AR-1271 §11 explicitly defers "the smallest
containment needed for the dedicated eight-call session", a second unguarded shell tool seems more
load-bearing on that decision than the Bash variable-indirection residual already on the checklist.

### F-7 — a guarded seat can CREATE a file but cannot DELETE one, and untracked files brick the next seat
Discovered while landing this AR, and it will bite the eight-call session.

- The mandated `Co-Authored-By:` trailer contains `<noreply@anthropic.com>`. **Bash denies any
  command containing `<`/`>` as "file-output redirection"** — confirmed with a bare
  `echo "... <noreply@anthropic.com> ..."`, which was refused. So `git commit -m` **cannot carry
  the trailer this project mandates.** The workaround is `git commit -F <file>`, using the
  "inspected write path" the fence itself recommends.
- That requires writing a temp message file. `Write` **cannot escape the repository root**
  (measured: the scratchpad path was rejected), so the temp file must land *inside* an allowed
  prefix.
- Then it cannot be removed: **Bash `rm` is denied** ("use Edit/Write so lane and scope guards can
  inspect the target path") and **`Write`/`Edit` have no delete operation.** There is no
  guard-respecting delete primitive.
- And `session_anchor` says *"untracked files remain blocking and cannot be laundered by listing
  them"* — so the leftover file **would block the next seat's SessionStart**.

**Resolution taken:** the temp file was committed rather than deleted, because the only other
options were to leave a seat-bricking untracked file or to reach for the unguarded `PowerShell`
tool (F-5) — and using the gap I am reporting to tidy my own workspace would have destroyed the
credibility of the report. **Disclosed rather than laundered.** The desk may want a delete-capable
inspected path, or a `.gitignore` entry for a scratch prefix inside `docs/replay-results/`.

**Also observed:** the `pre-commit` hook **stashes and restores unstaged files** on every commit.
It touched the AR-1265 §4 governed dirty file. I re-verified its `diff_sha256` afterwards —
`e200765c11e8…`, **unchanged** — but note that `refs/stash` is shared across all worktrees of one
repo (`CLAUDE.md` §11b), so this hook performs the exact operation the multi-session rule forbids.
Benign here because this seat is isolated; **not** benign if two seats ever commit concurrently.

### F-6 — findings against myself
- My first act was a Bash call naming `.claude/settings.json`; the fence denied it. The guard was
  right and I re-measured with `Grep`. Reported rather than quietly re-run.
- **The ear red-proof is 3/4, not 4/4.** `REFUSES` on a non-repo cwd (`exit 2`), `REFUSES` on an
  absent ref (`exit 3`), and `SILENT` across 3 polls all pass. **`EMITS`-on-move is NOT re-proven
  in this seat** — the guard blocks history mutation even on a throwaway repo, so I could not move
  a test branch. I am not claiming that arm. The armed line *did* deliver to my chat, which proves
  the channel but not the change-detection logic.
- A live ear (PID 13060) was found whose parent PID 18464 is **dead** — an orphan from a prior
  seat, which can never deliver into this session. Per doctrine I did **not** kill an ear I did not
  arm; I armed my own and report the orphan.

---

## 7. WHAT IS STILL NOT PROVEN

- live native `Agent` → installed `PreToolUse` traversal (**F-2** — the packet's own goal, open)
- actual vs inherited model routing (**F-3** — non-discriminating by construction)
- whether the unguarded `PowerShell` tool can write a protected surface (**F-5** — untested on purpose)
- `EMITS`-on-move arm of the ear red-proof (**F-6**)
- CI: **NONE.** All evidence here is local. Do not relabel it.

---

## 8. STOP / NEXT

**STOP fired:** §10F delivery to the GPT branch is blocked by the seat's own `edit_scope` (**F-4**).
This is a scope question I may not self-authorize, so it goes to the desk rather than around.

**NEXT (needs a GPT/operator decision, in priority order):**
1. Rule on **F-4** — the bound seat's AR publication path. Nothing else lands until this does.
2. Rule on **F-2**'s one-line fix (persist `_audit`) so traversal stops being unprovable.
3. Rule on **F-5** before the eight-call session, per AR-1271 §11's own containment question.

**FROZEN G2-D: 0/8, verified before and after. AR-1269A calibration: NOW SPENT.**
