# Guard lifecycle repair — the SessionStart → PreToolUse wire

**Branch** `guardfix/ar1271a-lifecycle`, off `origin/claude/worker1-p1-toolbox-20260816` @ `18108039`
**Date** 2026-08-16
**Session** guard-repair seat. NOT Worker-1. The frozen eight were not touched; the Opus calibration
was not spent; no Worker-1 lane work was done.

**The re-pin is NOT applied here.** `_toolbox_pin` and `_toolbox_bundle_sha256` in the self-protected
manifest are still `18108039` / `1d12f612…`. Applying them is the operator's or GPT's act. Until
that happens the live Worker-1 seat continues to execute the OLD, broken toolbox.

---

## 1. The defect, confirmed at the pin

`claude-hook-bridge.mjs` @ `18108039`:

| line | what it did |
|------|-------------|
| `:110-112` | `persistAnchorOk()` appended `export TF_CLAUDE_GUARD_ANCHOR_OK=1` to the file at `CLAUDE_ENV_FILE` |
| `:139` | SessionStart called it when the anchor verified |
| `:150` | PreToolUse read `env.TF_CLAUDE_GUARD_ANCHOR_OK` from **its own process env** |
| `:236` | TaskCompleted did the same |

Nothing carried the value from the file to that environment.

### MEASURED HERE — from the shipped `claude.exe`, two independent facts

1. Hook-env construction:
   `if(!v&&(t==="SessionStart"||t==="Setup"||t==="CwdChanged"||t==="FileChanged")&&c!==void 0) D.CLAUDE_ENV_FILE=await Ump(t,c);`
   → **`CLAUDE_ENV_FILE` is placed only in SessionStart / Setup / CwdChanged / FileChanged hook
   children.** A PreToolUse hook is never even told the path.
2. The documented contract for that variable:
   *"CLAUDE_ENV_FILE is set — write bash exports there to apply env to **subsequent BashTool
   commands**."* The file is consumed to build the Bash tool's shell prefix, never applied to a
   later hook subprocess.

### MEASURED HERE — the wire, end to end, before the fix

Unchanged instrument (`red-proof-wire.mjs`): spawn the real runner for SessionStart, let it exit,
spawn it again for PreToolUse. Nothing injected.

```
--- PROCESS 1: SessionStart ---
{"...":"GPT worker guard: anchor verified on worker-one at 8cfa9e51..."}
CLAUDE_ENV_FILE contents: "export TF_CLAUDE_GUARD_ANCHOR_OK=1\n"

--- PROCESS 2: PreToolUse (owned, in-scope path; nothing injected) ---
{"...":{"permissionDecision":"deny",
        "permissionDecisionReason":"worker session anchor was not verified at SessionStart; edits are fail-closed"}}

VERDICT: deny
RED: a correctly-launched seat is denied its own first tool call.
```

**A correctly-launched Worker-1 seat was denied every tool call.** Fail-CLOSED, and therefore
invisible: a refused seat and a well-behaved seat produce the same receipts.

### Why the suite missed it

`claude-hook-bridge.test.mjs` @ `18108039`:
- `:69` asserted the PRODUCER by reading the env file's contents.
- `:55-57` `verifiedEnv()` handed the CONSUMER a fabricated `{TF_CLAUDE_GUARD_ANCHOR_OK:'1'}`.

Two green halves. Zero coverage of the wire. `TWO GREEN HALF-HANDSHAKES ARE NOT A HANDSHAKE.`

---

## 2. Second defect (higher severity): the marker was unbound

`TF_CLAUDE_GUARD_ANCHOR_OK=1` names no session, worktree, branch, commit, or toolbox pin. Its only
safety was that it never travelled. Repairing the transport WITHOUT binding it would have converted
a harmless fail-CLOSED bug into a fail-OPEN one: a later session, on a wrong branch, over a rewound
HEAD, under a re-pinned toolbox, would inherit an armed marker with every receipt green.

`AN UNBOUND MARKER IS SAFE ONLY FOR AS LONG AS IT IS BROKEN.`

---

## 3. Fix A — bound marker, and re-measure rather than remember

New module `tooling/guard-session-marker.mjs`.

**Removed, not rerouted:** `persistAnchorOk()` is deleted. `TF_CLAUDE_GUARD_ANCHOR_OK` is no longer
written anywhere. Writing it into the Bash tool's session env would leave exactly the bare unbound
"you are armed" constant this repair exists to eliminate.

**SessionStart** mints `<git-dir>/tf-claude-guard-session-<session_id>.json` recording
`session_id`, `worktree`, `git_dir`, `branch`, `head`, `expected_branch`, `toolbox_pin`,
`toolbox_bundle_sha256`, `armed_at`, `expires_at` (default TTL 12h, overridable via
`session_anchor.marker_ttl_seconds`). A **refused** SessionStart *revokes* any marker a previous
session left behind.

Location matters twice: `git status` never reports anything under the git directory (so the marker
cannot dirty the tree and block the next SessionStart — an untracked scratch file is precisely what
the anchor check refuses to start on), and for a linked worktree that directory is
`<repo>/.git/worktrees/<name>`, unique per worktree. **The storage location is itself part of the
binding.**

**PreToolUse / TaskCompleted** refuse unless all of the following hold, each with its own message:

| # | check | source |
|---|-------|--------|
| 1 | marker exists for this `session_id` | file |
| 2 | `marker.session_id === input.session_id` (filename is sanitized and can collide; the field cannot) | marker |
| 3 | not expired | marker |
| 4 | `marker.worktree` === live repo root | **re-measured** |
| 5 | `marker.git_dir` === live absolute git dir | **re-measured** |
| 6 | `marker.toolbox_pin` === manifest `_toolbox_pin` | manifest |
| 7 | `marker.toolbox_bundle_sha256` === manifest `_toolbox_bundle_sha256` | manifest |
| 8 | live branch === `expected_branch` (detached ⇒ deny) | **re-measured** |
| 9 | `marker.branch` === `expected_branch` | marker |
| 10 | live HEAD === resolved `expected_head` | **re-measured** |
| 11 | live HEAD descends from `marker.head` (`merge-base --is-ancestor`) | **re-measured** |

The marker is evidence of the ONE thing PreToolUse cannot re-measure: that the tree was clean when
the seat started. Everything else is re-derived from the live tree on every call.

**Cleanliness is deliberately NOT re-checked.** A working seat dirties its own tree. Re-running
`require_clean` per tool call would deny the seat's second edit — the shape of a guard that gets
switched off by whoever it annoys. Cleanliness is a START condition and stays one.

**HEAD is advance-only, not frozen** (#11). A seat is expected to commit while it works; freezing
HEAD would brick it after the first commit. What must never happen is HEAD going backwards or
sideways off the armed commit. With a manifest that pins `expected_head` to a SHA rather than a
ref, #10 denies after the first commit — which is what pinning a SHA is asking for.

### Fix A extra: the marker is self-protected

`lane-boundary-guard.mjs` gains one `SELF_PROTECTED` rule (`contains: tf-claude-guard-session`,
with the matching Bash fence token). The marker is now a control-plane artifact, and a worker able
to write one could manufacture the single fact PreToolUse cannot re-measure. Packet scope already
refuses it today, but that is a property of *this manifest*, not of the boundary — and "a broader
prefix in a future manifest" is precisely how AR-1269 §4 found the receipt gap.
`AN EDITABLE PROOF IS NOT A PROOF.`

---

## 4. Fix B — a real lifecycle test

New `tooling/claude-hook-lifecycle.test.mjs`. Every case spawns the REAL
`claude-hook-runner.mjs` as a REAL child process — exactly as `scripts/claude_guard_hook.mjs` does
— lets it exit, then spawns a SECOND real process. It constructs no `env`, calls
`evaluateHookEvent` in-process nowhere, and writes no marker itself. `TF_CLAUDE_GUARD_ANCHOR_OK`
and `CLAUDE_ENV_FILE` are explicitly *deleted* from the PreToolUse child's environment.

Positive: an armed seat is ALLOWED its in-scope edit; the same armed seat still DENIES a cross-lane
target (arming is not a blanket allow); TaskCompleted reaches the *finish* refusal rather than the
*anchor* refusal.

Negative (all must DENY): no SessionStart · different session id · marker copied onto another
session id · marker carried into another worktree · worktree field alone wrong · git-dir field
alone wrong · recorded-branch field alone wrong · HEAD rewound · branch switched · detached HEAD ·
toolbox re-pinned · toolbox bundle changed under an unchanged pin · SHA-pinned anchor left behind
by a commit · expired marker · forging the marker via Write or Bash.

### Fixtures that were lying, now corrected

- `claude-hook-bridge.test.mjs`: `verifiedEnv()` → `arm()`, which runs the real SessionStart event.
  Its `expected_head` fixture was a literal SHA; the live manifest uses a ref on purpose, and the
  SHA meant the finish tests were exercising a session whose anchor could never verify in
  production. The fabricated env hid that.
- `ar1270-control-plane-boundary.test.mjs`: the rig injected `TF_CLAUDE_GUARD_ANCHOR_OK=1` into the
  child env and used the unresolvable anchor `{expected_branch:'x', expected_head:'x'}`. It now
  builds a real commit on a real branch and arms via a real SessionStart child process.
- `lane-precedence-ar1263.test.mjs`: same fabrication, same repair.

---

## 5. Evidence

| instrument | before | after |
|---|---|---|
| `red-proof-wire.mjs` (unchanged across both runs) | **deny** — seat refused its own first tool call | **ALLOWED** |
| `node --test tooling/*.test.mjs` | 191 pass / 0 fail (exit 0) | **198 pass / 0 fail (exit 0)** |
| mutation red-proof sweep, 12 bindings + no-mutation control | n/a | **every binding goes RED when removed; control green** |
| live dry run vs the real Worker-1 worktree + real manifest | n/a | **ARMED, then ALLOW** |
| PreToolUse latency, real Worker-1 worktree, median of 12 | 56.5 ms | **75.8 ms (+19.3 ms)** |

The latency line is itself a measured repair: the first implementation asked four separate `git`
questions and cost **+81 ms per tool call**. Batching them into one
`git rev-parse --absolute-git-dir HEAD <expected>^{commit} --abbrev-ref HEAD` brought it to +19 ms.
`A GUARD THAT BECOMES SLOW BECOMES OPTIONAL.`

The mutation sweep runs a NO-MUTATION control first, so a sweep whose harness is silently broken
cannot report "all red" and look like a triumph.

The live dry run wrote its markers into the Worker-1 worktree's git directory and they were
removed afterwards; `git status` there is unchanged (`M docs/wave25-exit-engine-ab-report.md`, the
AR-1265 §4 governed path) and the frozen plane read **8 queued / 0 spent / receipts+0**.

---

## 5b. The re-pin — APPLIED, and the two defects it exposed

Applied on the operator's explicit instruction after this seat's brief had reserved it. Doing it
surfaced two defects that no amount of unit testing would have.

### A RE-PIN IS TWO FILES

`_toolbox_pin` / `_toolbox_bundle_sha256` in the self-protected manifest are the **expected**
identity. `TOOLBOX_PIN` in `scripts/claude_toolbox.mjs` is what actually gets **materialized**.
Editing only the manifest produced, at the live doorway:

```
Worker-1 guard doorway failed closed: materialized toolbox pin 18108039...
!= manifest _toolbox_pin a2d5942d...
```

Correct, fail-closed, and how the second half got found. **Editing only the constant would have
been far worse** — the new law executing while the self-protected manifest still attested to the
old one, with nothing anywhere disagreeing.
`A RE-PIN IS TWO FILES. CHANGE ONE AND YOU HAVE EITHER A BRICK OR A LIE.`

### THE ARM WITNESS REPORTED `ARMED` OFF A STOP

`worker1_seat_launch.ps1`'s C5 probe sent `{"hook_event_name":"SessionStart","source":"startup"}`
with **no `session_id`**. Under the bound-marker guard that cannot arm, so the guard answered
*"GPT worker guard STOP: the resume anchor verified but the session could not be armed…"*.

The launcher's detector was `if ($armedText -match 'anchor verified')`. **My own refusal wording
contained the success phrase.** The launcher printed `guard : ARMED` and `seat OK` while holding a
refusal — a false green in the one gate standing between the operator and an ungoverned seat, which
is the exact failure the launcher exists to prevent.
`A REFUSAL THAT SPELLS THE SUCCESS PHRASE IS A PASS.`

Fixed on **both** sides, because either alone leaves the trap armed for the next wording:

- **Guard** (`338dbd80`): refusal reworded to "the resume anchor **check passed** but this session
  could not be armed", plus a detector-collision control that sends the launcher's exact
  `session_id`-less probe shape and asserts STOP present, "could not be armed" present, `anchor
  verified` **absent** — then proves the session really is unarmed rather than merely worded so.
- **Launcher**: the probe now carries its own `session_id` (`seat-armprobe`, bound to nothing real,
  marker removed immediately after), and the verdict tests for **STOP first**, so a refusal wording
  nobody has written yet is caught by the marker every refusal carries rather than by the absence
  of a phrase somebody remembered to avoid.

Detector truth table, old vs new, over five real guard outputs — exactly one verdict changes:

| guard output | old | new |
|---|---|---|
| genuine arm | ARMED | ARMED |
| **historical false green** | **ARMED** | **REFUSE** |
| current arm failure | REFUSE | REFUSE |
| dirty-tree refusal | REFUSE | REFUSE |
| doorway failed closed | REFUSE | REFUSE |

### Applied values

```
_toolbox_pin            338dbd80abbe21648e58862cc00e6cee6a8a0b26
_toolbox_bundle_sha256  c8b7cec408b017ce6d2c04dcc4ad705726c3bfadbd9e9f4afb0a9d0c6aee894e
file_count              44   (was 42)
```

Two instruments agreed on the bundle (`materialize`'s own algorithm and
`git cat-file | sha256sum`). `git merge-base --is-ancestor 18108039 338dbd80` → 0.
`claude/worker1-p1-toolbox-20260816` fast-forwarded onto it, so `TOOLBOX_REF` reports no drift.

### Witnessed at the live doorway — real manifest, real worktree, real seat surface

| | at `18108039` | at `338dbd80` |
|---|---|---|
| SessionStart | "anchor verified" | "anchor verified" |
| PreToolUse `Read` | **DENY** — *worker session anchor was not verified at SessionStart* | **ALLOW** |
| PreToolUse cross-lane `Write` | deny | deny (`BLOCK:…paper-engine.ts`) |
| Bash naming the marker | n/a | deny (protected-surface fence) |
| TEMP cache stamp | `18108039` / `1d12f612`, 42 files | `338dbd80` / `c8b7cec4`, 44 files |

Seat pre-flight after the re-pin: `guard : ARMED` on a genuine arm, `seat OK`, exit 0, probe marker
cleaned up, `frozen : 8 queued / 0 spent | receipts+0`.

Launcher refusal path re-proved end to end after the edits: an untracked file in the worktree →
`WORKER-1 SEAT REFUSED TO START` / `[C5 arm] guard REFUSED to arm`, **exit 1**; control removed →
`ARMED` / `seat OK`, **exit 0**.

`materialize()` receipt at the final pin: `pin == branch_commit`, `drifted: false`, 44 files,
bundle `c8b7cec4`.

### One reported failure, disclosed rather than buried

Running the suite **from the flattened TEMP cache** gives 198/199, not 199/199. The failure is
`g2-precall-guard.test.mjs` → *REGISTRATION PARITY*, which does
`path.resolve(import.meta.dirname, '..', 'claude-hooks', 'settings.fragment.json')` — a sibling
directory that exists in the repo and not in the cache, where `materialize()` flattens every file
to a basename in one directory.

Measured as **pre-existing and layout-only**, not introduced here: the identical test fails the
identical way against the OLD 42-file toolbox at `18108039`, and passes in the repo at both pins.
It has no operational effect — the doorway executes `claude-hook-runner.mjs` from the cache and
never runs tests there. Recorded because an instrument that reported a failure must be reported,
and "199/199" without this line would be a claim broader than its evidence.

## 6. What is NOT done, and is not mine

- ~~**The re-pin.**~~ **APPLIED — see §5b.** The paragraph below is kept as the record of what was
  reserved and why, and of the values as first computed; the values actually in force are
  `338dbd80` / `c8b7cec4`, not `d4c96819` / `47dacc36`.

- **Witnessing the fix inside a live guarded Claude seat.** Everything in §5b drives the real
  doorway with the real manifest as a child process, which is the same executable path the seat
  uses — but it is not a Claude session with hooks bound. That last mile still needs a guarded
  seat, and repairing the guard needs an unguarded one.

- **The original reservation, kept for the record.** `_toolbox_pin` → this branch's commit and `_toolbox_bundle_sha256` → the
  recomputed bundle, in `.claude/worker1-hook-guard-manifest.json`. That file is self-protected and
  the bundle now covers **44** `.mjs` files, not 42 (`guard-session-marker.mjs` and
  `claude-hook-lifecycle.test.mjs` are new; `claude_toolbox.mjs` derives the file set from
  `git ls-tree`, so no list needs editing). Operator or GPT only.

  The two values are COMPUTED and supplied here so nobody has to hand-derive them, using
  `claude_toolbox.mjs materialize`'s own algorithm and cross-checked by a second, independent
  hasher (`git cat-file | sha256sum`), which agreed byte for byte:

  ```
  _toolbox_pin            d4c9681975f11a98d31b93bbef5c6448a4dba573
  _toolbox_bundle_sha256  47dacc36380a61b6118a26b168759b12d118b80455b009b7016287a17ad43bcb
  file_count              44   (was 42)
  ```

  `git merge-base --is-ancestor 18108039 d4c96819` → **0**, so the descendant invariant in
  `_toolbox_pin_history` holds.

  `d4c96819` is the commit carrying the toolbox change. The commit that adds *this document* sits
  on top of it and touches nothing under `tooling/`, so the bundle sha is identical at either
  commit — pin whichever you prefer; `d4c96819` is the one measured above.

  **These are values to apply, not an instruction to apply them, and re-verify them yourself before
  pinning — a supplied hash is still a RELAYED hash.** The commit currently lives on
  `guardfix/ar1271a-lifecycle`; the activator treats the pin as authority and the branch as a hint,
  but fast-forwarding `claude/worker1-p1-toolbox-20260816` onto it first is the tidier order.
- **Witnessing the fix inside a live guarded seat.** That needs the re-pin first. Until then the
  live seat runs the broken toolbox and will deny every tool call.
- Any Worker-1 lane work, the frozen eight, and the one-shot Opus calibration. Untouched.

## 7. Separate, at the operator's mid-turn request

`scripts/worker1_seat_launch.ps1` (Worker-1 seat worktree, branch `claude/worker1-h1-20260815`,
commit `f7962ce5`, pushed) now launches `claude --dangerously-skip-permissions`.

MEASURED in the shipped `claude.exe` before making the change: the PreToolUse hook generator
(`RIn`) skips only a static built-in tool allowlist and bare forks — no permission mode gates it —
and the resolver (`IDb`) reads the hook verdict FIRST
(`if (hookResult?.behavior === "deny") return { decision: hookResult }`), falling through to the
permission pipeline where `bypassPermissions` lives only when the hook did not deny. **The flag
removes the operator prompt; it does not remove the guard.** Safe only because C1–C5 already refuse
to reach the launch line unless the arm witness observed the guard arm.

RED→GREEN observed on that change: the launcher REFUSED while the edit was uncommitted
(`worktree is dirty at an ungoverned path: scripts/worker1_seat_launch.ps1`) and reported
`guard : ARMED` / `seat OK` after the commit.
