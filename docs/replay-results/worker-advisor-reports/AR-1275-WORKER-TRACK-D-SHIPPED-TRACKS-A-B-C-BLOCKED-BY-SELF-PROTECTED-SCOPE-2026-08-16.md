# AR-1275 — WORKER

```
RULING : AR-1274 §9 (A-E). Executed §9D in full. §9A/§9B/§9C BLOCKED — see STOP.
PIN    : branch claude/worker1-h1-20260815 @ ef2d14d2da6dcdaa494ac2841c41c92c115254d4 (parent)
         worktree C:\Users\tonio\Projects\wt-claude-worker1-20260815
         toolbox pin b6c702821bc48281b02e16773c7c277ae17fb03f / bundle c8b7cec4…894e (unchanged)
CHANGED: scripts/worker-report-latest.mjs                                  (new)
         docs/replay-results/worker-advisor-reports/README.md              (new)
         docs/replay-results/worker-advisor-reports/AR-1275-….md           (this file)
         — no other file touched; toolbox, manifest, settings.json, queue, receipts all UNCHANGED
```

## REQUIRED RUNTIME STATEMENT (AR-1274 §H)

```
Agent/subagent model executions in this packet: 0
Opus calibration retries:                       0
Frozen G2 calls executed:                       0
```

Positive witness that these are real zeros rather than an unexercised path: the `Agent` tool was
never invoked in this session, and the `PreToolUse` matcher covering `Agent|Task` was verified
present and enforcing (see CONTROL — the fence denied live tool calls in this seat).

## FROZEN PRESERVATION (AR-1274 §G) — before AND after, identical

```
queue  docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json
       queue[] entries          = 8        -> READY 8
       "attempts": {}           (line 116) -> SPENT 0
       excluded[]               = 4        (ACCEPTED_PENDING_CERTIFICATION, never escalate)
       derived_from.condition_count = 12   = 8 + 4  (internally consistent)
receipts isolated-receipts-t1/  = README.md ONLY
       .attempt/.dispatch/.raw/.completion = 0/0/0/0
```

Read via the inspected `Read`/`Glob` path. **`sha256sum` of the queue could not be taken** — Bash
is fenced from that surface (see FINDINGS #2). The stronger evidence is structural: this seat has
no write path to the queue, no read path via Bash, and executed zero Agent dispatches.

## RED

`§9D` — worker-report discovery before the canonical location existed:

```
$ node scripts/worker-report-latest.mjs
WORKER REPORT DISCOVERY REFUSED: canonical worker-report directory absent: docs/replay-results/worker-advisor-reports
exit=1
```

## REPAIR

Established the canonical worker-report landing location **inside** the governed write scope
(`docs/replay-results/worker-advisor-reports/`) rather than widening the scope outward to the GPT
branch, plus a discovery helper (`scripts/worker-report-latest.mjs`) and a written contract
(`README.md`). The GPT branch remains the home of GPT rulings; the worker needs no write access
there to report. No operator relay step exists in this path.

## GREEN

```
$ node scripts/worker-report-latest.mjs
docs/replay-results/worker-advisor-reports/AR-1275-WORKER-TRACK-D-SHIPPED-TRACKS-A-B-C-BLOCKED-BY-SELF-PROTECTED-SCOPE-2026-08-16.md
exit=0
```

## CONTROL

1. **Numeric-vs-lexical rank (discriminating).** Lexical sort ranks `AR-999` above `AR-1275`
   (`'9' > '1'`). Fixture `['AR-999-old.md','AR-1275-new.md','AR-1138-mid.md','README.md','notes.txt']`:

   ```
   [{"name":"AR-1275-new.md","ar":1275},{"name":"AR-1138-mid.md","ar":1138},{"name":"AR-999-old.md","ar":999}]
   ```

   Correct order, and `README.md` + `notes.txt` excluded by construction.

2. **Ear red-proof, all four legs, on a throwaway remote — never the real branch:**

   | leg | result |
   |---|---|
   | REFUSES from non-repo cwd | `EAR REFUSED: … is not a git repository`, exit 2 |
   | REFUSES on missing dir | `EAR REFUSED: cannot cd to …`, exit 2 |
   | REFUSES on absent ref | `EAR REFUSED: … resolves to NOTHING`, exit 3 |
   | SILENT with no move | `EAR ARMED` + `EAR EXIT after 3 polls`, no MOVED line |
   | EMITS on a real move | `GPT BRANCH MOVED: cb306146 -> 36ecacb4`, move independently confirmed |

3. **Guard is enforcing, not merely registered** — live denials in this seat, unprompted:
   `.claude/settings.json` via Bash → protected-surface DENY; the frozen queue via Bash →
   protected-surface DENY; the pinned toolbox path via Bash → protected-surface DENY.

## GRADER

Not dispatched. AR-1274 §10 forbids **any** Agent/subagent model dispatch in AR-1275, and
`accuracy-validator` is an Agent dispatch. The prohibition outranks §11c's standing grader
authorization for this packet. **Grade owed on the §9D repair and not taken** — flagging rather
than silently skipping.

## FINDINGS

1. **§9A / §9B are mechanically unreachable from this seat.** Both require changing guard **law**,
   which lives only in the pinned toolbox at `advisor-prepared/gpt-speed-engineering-lane/tooling/`.
   Measured, on a read-only `git ls-tree`:

   ```
   Bash is not a side door to the protected control plane: this command references
   `advisor-prepared/gpt-speed-engineering-lane/tooling/` (the pinned guard toolbox).
   Denied REGARDLESS of what the command would do — the boundary is the surface.
   ```

   Activation additionally requires a **two-file re-pin**, and `scripts/claude_toolbox.mjs:85-92`
   states the failure modes itself: *"A RE-PIN IS TWO FILES. CHANGE ONE AND YOU HAVE EITHER A
   BRICK OR A LIE."* I can reach exactly one half — `scripts/claude_toolbox.mjs` (in scope). The
   other half, `.claude/worker1-hook-guard-manifest.json`, is self-protected; the manifest says so
   in its own body: *"this manifest, .claude/settings\*.json, .claude/hooks/ and the pinned toolbox
   all DENY regardless of what this list says."* ⇒ **I can only produce a brick or a lie, so I
   produced neither.**

2. **§9C is outside the declared edit scope.** Root `CLAUDE.md` matches no `allowed_prefixes`
   (`src/engine/extraction/`, `src/engine/tests/`, `scripts/`, `docs/replay-results/`, `.claude/`)
   and is not the single `allowed_exact` (`docs/designs/SYSTEM-INVENTORY.md`).
   ⚠ **Honest limit: this one is scope-derived, not empirically probed.** I did not test it,
   because the only probe available is a real mutation of a 205 KB authority file on a guess.
   Measured before-size, which §9C requires regardless: **205,646 bytes / 1,096 lines**
   (corroborates AR-1274's ~203.5k chars; the delta is multibyte ★/🛑 glyphs).

3. **Finding against myself — I used the unguarded `PowerShell` tool.** The §2a census mandates
   `Win32_Process` + parent walk and forbids `TaskList`, so the census ran through PowerShell. It
   was read-only and not a §8 workaround of a guard restriction — but it is exactly the AR-1274 §4
   gap, and it re-demonstrates it independently: **PowerShell executed with zero guard
   interposition.** Treat as fresh evidence for §9B, and as a reason §9B should land before this
   seat does further census work.

4. **Guard false-positives on read-only verbs (low severity, real friction).** `git branch -a
   --contains` and a batch containing `git cat-file`/`git merge-base` were both refused as
   *"branch/worktree/history mutation"*. Neither mutates. Per AR-1274 §8 I did **not** build a
   shell parser and did **not** route around it via PowerShell; I re-expressed the queries. Also
   confirmed: `>` redirection is blocked in Bash (`file-output redirection through Bash is
   blocked`) while `mkdir` is permitted — so the §8 constraint is specifically redirection, and
   `Write` is repo-root-fenced, which together made a throwaway git fixture buildable only via
   `git commit --allow-empty` (no file writes). That is how CONTROL #2 was obtained.

5. **The AR-1274 §9 work order and the AR-1265/§7A protection model contradict each other.**
   §9A/§9B/§9C assign this seat work on surfaces the guard denies, while §I forbids assigning the
   operator any command, cwd, approval, relay, or hook-inspection step. As written, three of five
   tracks have **no permitted actor**. Raising it now per `worker-execution` §5/§9 — before the
   run, where it costs nothing.

## STOP

```
§9D  SHIPPED
§9A  BLOCKED — guard law is a protected surface (measured DENY); re-pin needs the self-protected manifest
§9B  BLOCKED — same; and §4.4 explicitly forbids the matcher-only fix, and the matcher lives in
                the self-protected .claude/settings.json
§9C  BLOCKED — root CLAUDE.md is outside declared edit_scope (scope-derived, unprobed)
§9E  HELD    — no regression: toolbox pin, bundle, manifest, settings, queue, receipts all unchanged
```

## NEXT

One decision from GPT, then this seat proceeds without further input:

**Name the permitted actor for the control-plane half.** Either (a) authorize this seat to author
the toolbox change on the toolbox branch and to update **both** re-pin halves — which means an
explicit, bounded exception to §7A self-protection for the manifest's `_toolbox_pin` /
`_toolbox_bundle_sha256` fields only; or (b) route §9A/§9B to the guard-repair seat that holds
that authority, and re-scope AR-1275 for this seat to §9C + §9D.

For **§9C**, the smallest unblock is adding root `CLAUDE.md` to `edit_scope.allowed_exact` — one
line, in the self-protected manifest, so it needs the same actor decision.

**CI: NONE.** Local-only evidence; no GitHub status at this pin. Not relabelled as CI.
