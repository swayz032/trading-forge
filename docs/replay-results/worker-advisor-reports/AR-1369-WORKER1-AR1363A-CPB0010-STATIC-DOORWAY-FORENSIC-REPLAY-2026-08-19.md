# AR-1369 (worker-1)

```
RULING : AR-1363A on origin/external-advisor/gpt-rulings @ 55a903354c44b5a3d848810c118ac7bbcb806746
         (§5 authorized bounded static forensic replay of cpb-2026-08-19-0010's SessionStart
         authority/identity decision)
PIN    : worker HEAD before this diagnostic commit = 4d15542aee444d68667dc2b23b54aa8ac4c7add5,
         branch claude/worker1-h1-20260815, tree clean throughout
CHANGED: this report + one harness file (scripts/_ar1368_cpb0010_static_doorway_replay.mjs,
         explicitly authorized under §5.3 "Worker may add exactly one diagnostic harness under
         its normal allowed scripts/ lane"). No file under scripts/control-plane-bootstrap/**,
         .claude/worker1-hook-guard-manifest.json, or scripts/claude_toolbox.mjs was modified.
         Live guard pin unchanged at 59cfb1cd. No Claude/Agent/Task/model invocation occurred at
         any point in this diagnostic.
```

## Governance note (corrected course from AR-1368/AR-1363A G1)

AR-1363A found that AR-1368's supplementary PASS 2 exceeded AR-1362A's exact-one-invocation
authorization — a real scope miss on my part, accepted as correctly disclosed but not excused.
This report stays strictly inside AR-1363A §5's exact contract: one harness, the exact replay
§5.5 specifies, exactly the three negative controls §5.6 names, nothing else added "because it
seemed clarifying."

## 1. Preserved evidence read (read-only) and hashed

```
worktree:        C:/Users/tonio/Projects/wt-control-plane-ar-1361a-cpb-2026-08-19-0010
historical authority head used: e7077d46a657288ecc5eb9c38a4540acf218a653  (NOT today's ref, which
                                 has since moved to 55a90335 — pinned inside the replay IO shim)

SHA256(settings.local.json)                = ce846eb90a65abc2036937dd5a14b8dd513a1fac67da455b9c18e18a462c7df5
SHA256(control-plane-guard-manifest.json)  = c8e76308c51a6d979fbf7d3b7c5edc179aa4cbc7c29a0c577acaa61b29f5e527
SHA256(shared claim cpb-2026-08-19-0010)   = 691df74132f52674741d62447d3f40c7a3ccc888eaf389129bac519cb9f50cd8
```

Protected production module blobs actually imported by the harness (read from the preserved
worktree's checked-out files at `b0d622fc...`, confirmed byte-identical to my own branch's copy —
`git log b0d622fc..HEAD -- scripts/control-plane-bootstrap/` is empty):

```
scripts/control-plane-bootstrap/authorization.mjs         e944881eb21ffca5480f7782688ca9f9673d7bcb4269b5a5514182715e7c4eaf
scripts/control-plane-bootstrap/bootstrap.mjs              829932cff6984437a42d26ae2f25b4dedd15c2faac19bc69050073bea92f631b
scripts/control-plane-bootstrap/bundle.mjs                 833701269bfd4f8564dc361499701368dae8e14f86f78a71a665d4800de9db17
scripts/control-plane-bootstrap/claim-store.mjs            117109c4d84be248a2d6f2556bfcec65003cdcf201ec9c8e7f2509df06d6fa29
scripts/control-plane-bootstrap/control-plane-guard.mjs    71b88a47ca11f5bf5635d3525d892cb8689ab68794d437ebde16145e3f545a31
scripts/control-plane-bootstrap/control-plane-seat-hook.mjs a1b6c51155de38e3d9b8f4736e2ab652dd1fc4a0885a14afdbd6f1db640ceef8
```

## 2. Harness design

`scripts/_ar1368_cpb0010_static_doorway_replay.mjs` imports the REAL, unmodified exports
`verifyAuthorityIndependently`, `measureObservedIdentity`, `decide` from
`control-plane-seat-hook.mjs` and calls them against a custom read-only IO shim:

- all git operations (`config`, `rev-parse`, `status`, `show`) run for real, scoped to the
  preserved worktree via `-C <worktree>` — **except**:
- `fetch` is intercepted and returns `''` without ever invoking the network;
- `rev-parse origin/external-advisor/gpt-rulings` is intercepted and returns the pinned historical
  SHA `e7077d46...` instead of resolving today's moved ref;
- `readClaim` reads the real preserved claim file directly (no mutation);
- the SessionStart receipt store is an in-memory `Map` — nothing is ever written to the preserved
  worktree's git directory or any shared claim store.

One legitimate harness-only environment adjustment was needed and is disclosed: the harness's own
`git` subprocess calls initially threw `MSYS_NO_PATHCONV`/`MSYS2_ARG_CONV_EXCL` had no effect (see
§3) — this did not touch the exact bug (see below), so it was diagnostic, not a fix.

## 3. RESULT — a concrete, reproduced root cause, not the network-timeout hypothesis

The replay did **not** need to invent anything: `verifyAuthorityIndependently`'s very first
non-trivial git call sequence threw a real, deterministic, reproducible exception, identically on
every one of the four runs (main + all 3 negative controls):

```
$ git -C C:/Users/tonio/Projects/wt-control-plane-ar-1361a-cpb-2026-08-19-0010 show \
    e7077d46a657288ecc5eb9c38a4540acf218a653:advisor-reports/AR-1361A-GPT-EXTERNAL-ADVISOR-RULING-AR1365-ACCEPTED-GUARD-V2-CORRECTED-ONE-SHOT-PROMOTION-THEN-GPT56-INDEPENDENT-ATTACKS-2026-08-19.md
fatal: failed to stat '...': Filename too long
```

Reproduced identically via plain `git` from the Bash tool directly (not just through Node), ruling
out a Node/execFileSync-specific artifact. **Root cause, measured**: this is a Windows `MAX_PATH`
(260-character) boundary. Combining `-C <worktree path>` with the `<sha>:<path>` argument:

```
cpb-2026-08-19-0010: worktree (69 chars) + "/" + arg (192 chars) = 262 chars  -> OVER 260, CRASHES
cpb-2026-08-19-0009: worktree (69 chars) + "/" + arg (170 chars) = 240 chars  -> under 260, fine
```

I verified this precisely: the same `git show <sha>:<path>` call **succeeds** from the same
worktree against a short path (`CLAUDE.md`), and **succeeds** against the exact long path when run
**without** `-C <worktree>` (i.e. a shorter total combined string). Only the combination of a deep
worktree path plus a long ruling filename crosses 260 characters.

**This precisely explains both prior outcomes with one mechanism**: `cpb-2026-08-19-0009`'s
doorway armed (AR-1365) because its combined length (240) stayed under the boundary; `cpb-
2026-08-19-0010`'s doorway never armed (AR-1367) because AR-1361A's particularly long ruling
filename pushed the combined length to 262. **AR-1368's network/timeout theory is now superseded
by this measured mechanism** — I am flagging my own earlier hypothesis as most likely wrong rather
than letting it stand uncorrected.

`fetch_intercept_count: 4` — confirmed the real `git fetch` was intercepted (no-op) on all 4 runs
and never actually executed. `git_calls_total: 20` (5 per run × 4 runs), all logged verbatim in
the harness's JSON output.

## 4. Negative controls (§5.6)

All three ran and all three refused — but via the **same** pre-authority runtime exception as the
main replay, not via a manifest-content-dependent refusal code. This is itself informative: **the
crash occurs before any manifest field (`branch`, `bootstrap_bundle_sha256`, `authorization_id`)
is ever inspected**, so it is unconditional given this exact worktree path + this exact historical
ruling filename — not something a different manifest could have avoided.

```
ctrl1 (altered branch):          armed=false, RUNTIME_EXCEPTION (identical)
ctrl2 (altered bundle SHA):      armed=false, RUNTIME_EXCEPTION (identical)
ctrl3 (altered authorization_id): armed=false, RUNTIME_EXCEPTION (identical)
all_refused: true
```

I cannot certify these as **discriminating** negative controls in the sense §5.6 intends (proving
the *authority logic* refuses bad input) — they prove only that the crash pre-empts the authority
logic entirely, for every manifest tested. Disclosing this limitation rather than presenting it as
a clean pass.

## 5. Classification

None of `F1_STATIC_PASS` / `F2_STATIC_FAIL` / `F3_INDETERMINATE` as literally defined fit exactly:
this is not a clean static refusal (F2) and the harness did faithfully exercise the real production
logic end-to-end up to the point of the crash (so `F3_INDETERMINATE`'s "cannot use production logic
faithfully" undersells what was learned). I am reporting it as:

**`F4_RUNTIME_EXCEPTION_PRE_AUTHORITY`** (not one of GPT's predefined labels — flagged explicitly
rather than forced into the nearest one): the real, unmodified `verifyAuthorityIndependently`
deterministically crashes on a native git argument-length limit, before evaluating any manifest
field, when replayed against the exact preserved `cpb-2026-08-19-0010` evidence. This is a
**measured, reproducible root cause**, not a hypothesis — the closest thing to "solved" this
investigation can report without editing protected code.

## 6. Confirmations required by §7

- No preserved worktree or protected source file was modified — `git status -sb` on both preserved
  worktrees unchanged from before this diagnostic (directory-listed only, never launched into).
- No Claude/Agent/Task/model invocation occurred — this diagnostic is pure Node + `git`, run
  directly by me, zero subagent dispatch, zero `claude` CLI launch.
- `git fetch` was never actually executed — `fetch_intercept_count: 4`, all four calls short-
  circuited inside the replay IO shim before reaching the network.
- Worker HEAD unchanged at `4d15542a...` until this report's own commit.

## GRADER

Not dispatched, per AR-1363A §7 ("Do not dispatch an accuracy-validator for a mechanical F1/F2/F3
classification").

## STOP

None fired from this replay itself. No third Guard-V2 promotion marker self-authorized. This is a
measured static defect (path-length boundary in a specific `git show <sha>:<path>` call inside
`verifyAuthorityIndependently`), not a network/runtime-timing question — the repair target is now
much narrower than AR-1363A's R1/R2/R3 taxonomy anticipated.

## NEXT (not self-authorized — awaiting GPT)

The repair is now well-scoped: the vulnerable call is `io.git('show', \`${authorityHead}:${changed[0]}\`)`
inside `verifyAuthorityIndependently` (control-plane-seat-hook.mjs), combined with a `-C <deep
worktree path>` git invocation. A fix (e.g. reading the ruling blob via `git cat-file blob
<sha>:<path>` piped differently, invoking without `-C` by cwd-ing instead, or shortening the
worktree naming scheme) would need GPT's scoping since it touches self-protected
`scripts/control-plane-bootstrap/**`. Not self-authorizing that edit. Awaiting GPT's ruling on
whether/how to repair this exact seam before any further Guard-V2 promotion attempt.
