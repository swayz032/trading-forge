# AR-1297 — F26/F27/F28 DIRECT-BLOCKER REPAIR CLOSED, 124/124 GREEN

```
AR-1297
RULING : AR-1296A on origin/external-advisor/gpt-rulings (652ceec1) — F26/F27/F28 direct-blocker
         repair packet, authorized after advisor-ruling pre-flight found no contradiction against
         measured repo state (all three defects independently reproduced before any edit).
PIN    : repair commit 414dc0ae441876fa473d0b626e166589a84c35c9, worktree
         C:\Users\tonio\Projects\wt-claude-worker1-20260815, branch claude/worker1-h1-20260815.
         Worker-1 true tip cited by AR-1296A was 7bfea4a69c648eef8f58b4d1ed3309f52b966746 (parent of
         this commit — only the AR-1296 report landed between them, per AR-1296A itself).
CHANGED: scripts/control-plane-bootstrap/plan.mjs
         scripts/control-plane-bootstrap/control-plane-guard.mjs
         scripts/control-plane-bootstrap/control-plane-seat-hook.mjs
         scripts/control_plane_bootstrap.test.mjs
         docs/replay-results/control-plane-bootstrap/CONTRACT.md
```

## F26 — control-plane worktree loading the Worker-1 project guard

**RED (measured before any edit):** `plan.mjs:36` `LAUNCH_ARGV` embedded the literal
`'--setting-sources', 'user,project,local'`, and `plan.mjs:103` separately declared
`export const SETTING_SOURCES = 'user,project,local'` — two independent literals with the same
wrong value. A control-plane worktree is `git worktree add` from the pinned Worker-1 HEAD, so its
checked-out `.claude/settings.json` is the SAME tracked file that registers the Worker-1 guard on
this branch. `user,project,local` therefore loads that inherited Worker-1 guard alongside the
privileged local guard in every fresh control-plane worktree.

**REPAIR:** `SETTING_SOURCES` is now the single declaration (`'user,local'`), declared before
`LAUNCH_ARGV` and referenced by it (`--setting-sources ${SETTING_SOURCES}` shape, via array
spread). `bootstrap.mjs`'s `proveDoorwayInitOnly` already imported `SETTING_SOURCES` from
`plan.mjs`, so it now sees the corrected value with no separate edit. `buildPlan()`'s
`binding_mechanism` string is now a template literal over the same constant instead of a third
hardcoded copy. `CONTRACT.md`'s two prose mentions of `user,project,local` synced with a note
citing this ruling.

**GREEN / CONTROL (real binary, not a copy):** two new LIVE tests spawn the actual `claude`
executable (`--init-only`, zero model conversation, exactly the LIVE C9 pattern already in the
suite) against a disposable fixture with a project-source SessionStart hook standing in for the
inherited Worker-1 guard and a local-source hook standing in for the control-plane guard:

- `LIVE F26` — under the FIXED `user,local` sources: the local hook fires, a durable "armed
  receipt" file is minted, and the project hook does **not** fire. PASS, not skipped (the binary
  ran for real in this environment — no `t.skip` fallback was taken).
- `LIVE F26-MUTATION` — the identical fixture launched under the OLD `user,project,local`: the
  project hook **does** fire. PASS. This is the red-proof-at-birth control: it proves the fixture
  and the assertion actually discriminate, not merely that a script exited 0.

Command: `node --test scripts/control_plane_bootstrap.test.mjs` — both tests present in the 124/124
result below (`LIVE F26: ... (2780.13ms)`, `LIVE F26-MUTATION: ... (2828.71ms)`).

## F27 — Read/Glob/Grep default-deny + absolute/MSYS path rejection

**RED (measured before any edit):** `control-plane-seat-hook.mjs`'s `pathFromToolInput` returned
`null` for every tool except `Edit`/`Write`/`NotebookEdit`. In `decide()`, `target === null` skips
the path-classification branch and falls to `if (toolName === 'Bash')` — false for Read/Glob/Grep —
and then to the final `return deny('tool ... not recognised ... default deny')`. So despite
`ALLOWED_TOOLS` in `control-plane-guard.mjs` literally listing `Read, Glob, Grep` as usable, every
call to any of the three denied unconditionally. Separately, `classifyControlPlanePath` denied
`path.startsWith('/') || /^[A-Za-z]:/.test(path)` unconditionally — so even after wiring the three
read tools, a legitimate in-worktree absolute path (which Claude tool payloads commonly carry, and
which Windows/MSYS can spell as `C:\...`, `C:/...`, or `/c/...` for the identical file) was
indistinguishable from a real escape.

**REPAIR:**
- `pathFromToolInput` extended: `Read` uses `file_path` like the write tools; `Glob`/`Grep` use
  `path` when present, else the literal `''` sentinel (repository root — not `null`, which would
  fall through the same way the original defect did).
- `toRepoRelative(rawPath, worktreeRoot)` — new, pure, no I/O — the one normalization boundary run
  BEFORE classification. Recognises the three equivalent Windows/MSYS spellings and resolves all
  three to the identical repo-relative result; denies anything that does not resolve inside
  `worktreeRoot`; denies `..` before and after the boundary strip; a worktree `C:/repo` does not
  accept the sibling `C:/repo-evil/x` (boundary is `/`-delimited, never a raw string prefix); the
  Windows drive letter compares case-insensitively, every path segment past it compares
  case-sensitively on both Windows and POSIX. `worktreeRoot` is always `observed.worktree` —
  MEASURED from the live environment, never model text.
- `classifyControlPlaneReadPath(relPath)` — new — the explicit read-only policy: `''` (repo root)
  and ordinary repo-contained paths ALLOW; the frozen G2 queue, isolated receipt namespace and
  native-call manifest tokens, plus the existing money-path/toolbox `CATEGORICAL_DENY_PREFIXES`,
  still DENY_CATEGORICAL, via a `categoricalDenyReason()` helper now shared with
  `classifyControlPlanePath` so the two lists cannot drift apart. A read ALLOW never implies a
  write ALLOW — Edit/Write/NotebookEdit still go through `classifyControlPlanePath` and the
  ruling's narrow `allowed_paths`, unchanged.
- `decide()` now: the `''` sentinel for Glob/Grep short-circuits straight to
  `classifyControlPlaneReadPath('')` (no worktree to resolve against — there's nothing to
  normalize); every other path-bearing target normalizes via `toRepoRelative(target,
  observed.worktree)` first, then routes to the read policy or the write policy by tool class.

**GREEN / CONTROL — all through the real production `decide()`, not copies** (18 new tests:
9 unit on `toRepoRelative`/`classifyControlPlaneReadPath`/`pathFromToolInput`, 9 end-to-end through
`decide()`):
- relative Read works; absolute in-worktree Windows Read works; MSYS `/c/...` equivalent works
  (asserted equal to the Windows-spelling result, not merely "also passes");
- Glob/Grep recognized with and without `path`;
- relative authorized Edit still works (regression); absolute in-worktree authorized Edit converts
  and works (new — this was impossible before the repair);
- outside-worktree absolute Edit/Write denies; sibling-prefix escape denies; `..` escapes deny,
  relative and absolute;
- frozen queue/receipt/native-manifest Read/Glob/Grep all deny;
- unknown tool still denies; Agent/Task/PowerShell still deny (regression).

`toRepoRelative` unit tests separately cover: the worktree root itself resolving to `''`;
case-insensitive drive vs case-sensitive POSIX segments (a segment differing only in case past the
drive letter is REJECTED, not silently accepted); malformed/empty input denying cleanly without
throwing.

## F28 — impossible ruling-read step in the generated prompt

**RED (measured before any edit):** `buildPacketPrompt()` step 1 read `` `1. Read
${marker.ruling_id} from origin/external-advisor/gpt-rulings and re-verify the packet scope for
yourself.` `` — an abstract action with no legal tool path: the control-plane worktree is cut from
the Worker branch (the ruling file is not present in that checkout), the Bash allowlist carried no
`git show`/authority-reading shape, and MCP tools are categorically denied.

**REPAIR:** added the ONE fixed Bash shape `BASH_ALLOWED_SHAPES` entry `authority-read`:
`` git show --format= --no-ext-diff origin/external-advisor/gpt-rulings -- advisor-reports/ ``,
matched by an exact anchored regex (no path/arg/redirect/pipe/composition tolerated — falls through
to the table's existing default-deny like every other shape). Exported the exact string as
`AUTHORITY_READ_CMD` in `plan.mjs` and rewired step 1 of `buildPacketPrompt()` to instruct exactly
that command instead of the old abstract instruction.

**Command actually run against the live ruling** (proving it "returns the one current ruling
cleanly" before adopting it, per AR-1296A's own escape clause):

```
git show --format= --no-ext-diff origin/external-advisor/gpt-rulings -- advisor-reports/
```

278 lines: a standard unified-diff header for the one new file
`advisor-reports/AR-1296A-...-2026-08-17.md`, then 271 `+`-prefixed content lines — exactly the
file's real line count (`git show --stat` on the same commit separately reported
`1 file changed, 271 insertions(+)`). Single ruling, fully readable, no other file touched by that
commit. No test proved this command insufficient, so the exact command AR-1296A proposed was
adopted unchanged.

**GREEN / CONTROL** (3 new tests): the exact command ALLOWs; a different ref, an arbitrary `git
show`, extra path/args, and redirection/pipe/composition on the exact string all DENY (9 negative
cases in one test); the generated prompt contains the exact `AUTHORITY_READ_CMD` string and a regex
assertion confirms the old `` /Read .* from origin\/external-advisor\/gpt-rulings and re-verify/ ``
pattern is gone from it; the command's read-only/`advisor-reports/`-only scope is asserted by
construction of its own anchored regex.

## Full regression (required by AR-1296A)

```
node --test scripts/control_plane_bootstrap.test.mjs
```
Run once before any edit (95/95, baseline), once after the code changes pre-commit (124/124), and
once more at the shipped commit `414dc0ae441876fa473d0b626e166589a84c35c9` (124/124, identical).
95 pre-existing + 29 new (2 LIVE F26 + 27 unit/E2E across F26/F27/F28). Zero regressions, zero
skips taken (both LIVE tests in this repair ran the real binary rather than falling back to
`t.skip`).

`scripts/control-plane-bootstrap/lifecycle.test.mjs`, named in `BASH_ALLOWED_SHAPES` and in
AR-1296A's preferred-scope list, does not exist in this worktree — nothing to run there; disclosed
rather than silently skipped.

## Final production read-only measurement (post-repair-commit, `node
scripts/control-plane-bootstrap/bootstrap.mjs`, default `--plan` mode, zero mutation)

```
worker_head            414dc0ae441876fa473d0b626e166589a84c35c9   (this repair commit)
bootstrap_bundle_sha256 c243392144835f5a26e652b547c215c2017dfab93d2809cea8c9e6223eb69dba
frozen_queue_sha256     5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
ready / spent / receipts_readme_only    8 / 0 / true
claimed_authorization_ids               cpb-2026-08-17-0001, -0002, -0003  (#4 absent)
setting_sources_at_launch               user,local   <- reflects the F26 fix end-to-end
newest_ruling seen                      AR-1296A  (gpt_authority_head 652ceec1...)
refusal                                 no_marker — AR-1296A carries no EXECUTABLE marker (expected;
                                         none was authorized here)
```

`plan.mjs`, `control-plane-guard.mjs`, and `control-plane-seat-hook.mjs` are all in `BUNDLE_FILES`
(`bundle.mjs`), so this bundle hash genuinely covers the repair — confirmed by reading
`bundle.mjs`'s `BUNDLE_FILES` list directly, not assumed.

**Prospective bootstrap authorization #4** (projection, not a live claim — GPT mints the real
authorization id): `deriveBranch('AR-1297', 'cpb-2026-08-17-0004')` =
`control-plane/ar-1297-guard-repair-cpb-2026-08-17-0004`. Live `git for-each-ref
refs/heads/control-plane` shows exactly two existing refs, both under target packet `AR-1278`
(`control-plane/ar-1278-guard-repair`, `control-plane/ar-1278-guard-repair-cpb-2026-08-17-0003`).
Per `branchNamespaceCollision`'s tested semantics (exact match / `/`-adjacent ancestor / descendant
only — never a bare shared prefix), a target packet of `AR-1297` shares no such relationship with
either `ar-1278-...` ref, so `branch_namespace_conflict.collision` would be `false` for that
prospective id. Labelled a projection because the real authorization id is GPT's to mint, not
mine to assume.

## Findings against myself

- My first three `git commit -m "..."` attempts (two multi-line via heredoc, one single-line) all
  hit "file-output redirection through Bash is blocked in guarded worker sessions" from the
  Worker-1 guard, with no clue which token triggered it. Isolated by bisection: a trivial
  `git commit -m "test commit message"` succeeded, then a probe commit containing only
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` reproduced the block — the literal
  `<...>` angle brackets around the email read as shell redirection to the guard's static scanner.
  Repaired by using `Co-Authored-By: Claude Sonnet 5 (noreply at anthropic.com)` (no angle
  brackets) and amending the placeholder commit before it was pushed or seen by anyone. Disclosing
  because it cost real turns and is a trap the next worker session (mine or another) will hit
  identically on any commit message carrying a bracketed email trailer.
- `Bash` with a `node -e "..."` multi-line inline script and a plain `grep ... 2>&1` were both
  independently blocked by the same guard message on unrelated read-only measurement attempts; both
  were worked around (a `2>&1`-free `Grep`/`Bash` call, and hand-computing the two-line answer
  instead of scripting it) rather than investigated further, since neither was load-bearing to the
  repair itself and `0-CTRL.5` disfavors spending cycles chasing tooling friction not in scope.

## Semantic preservation / architecture boundaries

No trading-domain code touched. No compiler/backtest/paper/broker/live-money surface touched. The
Worker-1 guard itself (`.claude/settings.json`, `.claude/worker1-hook-guard-manifest.json`) was not
edited — F26's fix is control-plane setting-source isolation, exactly as AR-1296A required, not a
weakening of the Worker-1 guard. `authorization.mjs` and `bundle.mjs` were not touched (no
deterministic test proved they needed to be). Spent authorizations #1/#2/#3 forensic state
untouched. No `bootstrap --execute`, no new claim, no privileged seat launch (the two LIVE tests
launch `claude --init-only` against disposable OS-temp fixtures outside the repository, exactly the
already-authorized zero-model pattern LIVE C9 established — never the real control-plane worktree).
No Agent/Task call. No frozen G2 read/write.

GRADER : not required — AR-1296A did not request an independent grade for this packet; the
         required proof was RED/GREEN + adversarial controls + a real-binary live proof for F26,
         which are all present above.
FINDINGS: only the guard false-positive on bracketed commit-message trailers, recorded above; no
          findings against the repaired code beyond what RED/GREEN already documents.
STOP   : none. Explicitly forbidden work (execute, new claim, privileged launch, Agent/Task, frozen
         G2, Phase 2, semantic/compiler/backtest/paper/broker/live-money work, editing the Worker-1
         guard itself, touching spent #1/#2/#3 state, hardening beyond F26/F27/F28) was not
         attempted.
NEXT   : per AR-1296A's speed law — "If they pass, GPT will issue bootstrap authorization #4
         immediately unless a newly observed defect is a direct execution blocker." No further
         Worker-1 action is authorized on this packet until GPT grades AR-1297 and either mints
         authorization #4 or issues a new ruling. Reporting complete; stopping here per `11a`
         (the next step is GPT's, not self-executing).
