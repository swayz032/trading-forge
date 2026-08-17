# AR-1298 — F29 RECURSIVE-SEARCH ANCESTOR BYPASS CLOSED, 139/139 GREEN

```
AR-1298
RULING : AR-1297A on origin/external-advisor/gpt-rulings (5d65a4d2) — F29-only repair packet.
         AR-1297 graded PARTIAL PASS: F26 PASS, F27's wiring/normalization PASS, F28 PASS, but F27's
         new no-path/broad-root Glob/Grep behavior opened a direct guard bypass (F29). Advisor-ruling
         pre-flight run against AR-1297A found no contradiction against measured repo state (the bug
         lines were reproduced verbatim at current HEAD before any edit).
PIN    : repair commit bae3fab0bd47d61a0dea5badfdd21bc73f4883f2, worktree
         C:\Users\tonio\Projects\wt-claude-worker1-20260815, branch claude/worker1-h1-20260815.
         AR-1297A's cited Worker-1 true tip was 2001e380016c60e745c79854bee484616fe63123 (parent of
         this commit — nothing else landed between them).
CHANGED: scripts/control-plane-bootstrap/control-plane-guard.mjs
         scripts/control_plane_bootstrap.test.mjs
```

## F29 — recursive-search protected-surface ancestor bypass

**RED (measured before any edit, at HEAD 2001e380):**
- `pathFromToolInput('Glob'/'Grep', {no path})` maps to the `''` repository-root sentinel.
- `classifyControlPlaneReadPath('')` returned `{ verdict: 'ALLOW', reason: 'repository root' }`
  unconditionally (`control-plane-guard.mjs:131` at that HEAD).
- The categorical direct-hit check (`categoricalDenyReason`) only ever sees the SUPPLIED path — it
  never sees what a real recursive search from that path would descend into. `scripts/control-
  plane-bootstrap/` is a real ancestor of `scripts/control-plane-bootstrap/claims/` (a categorically
  forbidden token), but the string `'control-plane-bootstrap/claims'` is LONGER than
  `'scripts/control-plane-bootstrap/'` and so is never a substring of it — the direct-hit check
  could never have caught that root even in principle.
- The shipped AR-1297 tests explicitly asserted both no-path calls returned ALLOW
  (`F27-E2E Glob/Grep with and without path ... ALLOW`), which is exactly why this was a false
  green rather than a red the suite already caught.

**REPAIR:** added `PROTECTED_SURFACE_PATHS` — the six real relative paths behind the existing
categorical tokens (the frozen queue file, the isolated-receipts directory, the native-call
manifest, the two self-guard files, and the claims directory) — and `ancestorOfProtectedSurface
(relPath)`, a pure string function with **zero filesystem access**: `''` is trivially an ancestor of
everything; any other root is an ancestor when a `/`-bounded prefix comparison shows one of the six
real paths nests under it. `classifyControlPlaneReadPath` now runs this check after the existing
direct-hit check and before the final ALLOW, so `''` is no longer a bespoke early-return — it falls
through the SAME ancestor check every other root does. No generic filesystem walking was
implemented; the six real paths are a small, fixed list, exactly per the ruling's "keep the decision
deterministic and cheap" instruction.

**Drift guard:** `F29-D1` asserts every entry in `PROTECTED_SURFACE_PATHS` is actually named by an
existing `CATEGORICAL_FORBIDDEN_PATH_TOKENS` token or `CATEGORICAL_DENY_PREFIXES` prefix, so the new
list cannot silently diverge from the categorical lists it is meant to mirror.

**Tests updated (per the ruling's explicit instruction — "do not preserve a false-green
expectation"):**
- `F27-E2E Glob/Grep with and without path ... ALLOW` renamed to `F29-E2E (supersedes old F27-E2E)
  ... now DENY as protected-surface ancestors`, all four assertions flipped from ALLOW to DENY, with
  a comment explaining exactly why the old expectation was wrong and where tool-recognition is
  proven instead (`F27-P1` on `pathFromToolInput`, plus the new F29-E2E-8 ALLOW case).
- `F27-R1`'s `classifyControlPlaneReadPath('').verdict` assertion flipped from `'ALLOW'` to
  `'DENY_CATEGORICAL'`, with the same before/after noted inline; the rest of that test (ordinary
  file reads still ALLOW, frozen surfaces still DENY_CATEGORICAL) is unchanged and still true.

## Required proofs (AR-1297A's 12-item list) — all through the real production `decide()` /
classifier path, not copies

| # | Proof | Test |
|---|---|---|
| 1 | no-path `Grep` cannot scan repo root across protected descendants | `F29-E2E-1/2` |
| 2 | no-path `Glob` cannot scan repo root across protected descendants | `F29-E2E-1/2` |
| 3 | `Grep` rooted at `docs/` DENY | `F29-E2E-3` |
| 4 | `Glob` rooted at `docs/replay-results/` DENY | `F29-E2E-4` |
| 5 | recursive search rooted at the opus-v2 G2 directory DENY | `F29-E2E-5` |
| 6 | direct Read of an ordinary safe file still ALLOWs | `F29-E2E-6` |
| 7 | direct Read of queue/receipt/native-manifest remains DENY | `F29-E2E-7` |
| 8 | at least one explicitly safe, packet-useful root still ALLOWs | `F29-E2E-8` |
| 9 | Agent/Task/PowerShell remain DENY | `F29-E2E-9` |
| 10 | Bash authority-read exact command ALLOW, variants DENY | `F29-E2E-10` |
| 11 | F26 `user,local` law unchanged | `F29-E2E-11` |
| 12 | full control-plane bootstrap suite green | full run below |

Plus 5 unit tests directly on `ancestorOfProtectedSurface`/`PROTECTED_SURFACE_PATHS`
(`F29-D1`, `F29-A1`-`F29-A4`) covering the drift guard, the root case, the real "ancestor but not a
substring" case that motivated the whole repair (`scripts/control-plane-bootstrap/`), a genuinely
unrelated safe root, and a sibling-prefix false-positive control (`docs/replay-results-other/` is
NOT caught, proving the `/`-boundary matters here exactly as it did for `toRepoRelative` in AR-1297).

## Full regression

```
node --test scripts/control_plane_bootstrap.test.mjs
```
Run once pre-edit (124/124, baseline — confirms the AR-1297 state I inherited), once post-edit
pre-commit (139/139), once more at the shipped commit `bae3fab0bd47d61a0dea5badfdd21bc73f4883f2`
(139/139, identical). 124 pre-existing + 15 net new (14 new `test()` calls; the old
`F27-E2E Glob/Grep...` test was renamed/rewritten rather than added alongside, and `F27-R1` was
edited in place). Zero regressions.

## Final production read-only measurement (post-repair-commit, `node
scripts/control-plane-bootstrap/bootstrap.mjs`, default `--plan` mode, zero mutation)

```
worker_head              bae3fab0bd47d61a0dea5badfdd21bc73f4883f2   (this repair commit)
bootstrap_bundle_sha256  ba6d0575d69feb2d6cf89dcdec7f53756e07ab79333405ea56230748a9ef3e43
bundle_membership_count  10   (scripts/control-plane-bootstrap/{authorization,bootstrap,bundle,
                          claim-store,control-plane-guard,control-plane-seat-hook,plan,cp-commit,
                          cp-finalize}.mjs + materialize-g2-prompt-transport.py)
frozen_queue_sha256      5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
ready / spent / receipts_readme_only    8 / 0 / true
claimed_authorization_ids               cpb-2026-08-17-0001, -0002, -0003  (#4 absent)
setting_sources_at_launch               user,local   <- unchanged by this repair
newest_ruling seen                      AR-1297A  (gpt_authority_head 5d65a4d2...)
refusal                                 no_marker — AR-1297A carries no EXECUTABLE marker (expected)
```

Bundle SHA differs from AR-1297's measurement (`c2433921...` → `ba6d0575...`) because
`control-plane-guard.mjs` — a `BUNDLE_FILES` member — genuinely changed; this is the correct
identity movement for a real repair, not drift. `control_plane_bootstrap.test.mjs` is NOT in
`BUNDLE_FILES` (confirmed by reading `bundle.mjs`'s list directly, same as AR-1297) — the test-only
half of this diff does not move the bundle hash.

**If a report/inventory commit lands after this one:** it will touch only
`docs/replay-results/worker-advisor-reports/AR-1298-...md`, none of the 10 `BUNDLE_FILES` entries,
so the bundle hash above will remain `ba6d0575...` at whatever HEAD that report commit produces —
exactly the `compare(bae3fab0..<report-head>)` check AR-1297A ran on my prior report.

## Findings against myself

None new this packet — the pre-flight, the repair, and the measurements all matched what I expected
going in. The one standing finding from AR-1297 (angle brackets in a `Co-Authored-By:` trailer
tripping the Worker-1 guard's Bash redirection scanner) did not recur here because this report's
commit message avoided the bracketed form again.

## Semantic preservation / architecture boundaries

No trading-domain, compiler, backtest, paper, broker, or live-money surface touched. No Worker-1
guard files touched. `authorization.mjs`, `bundle.mjs`, `bootstrap.mjs`, `plan.mjs` were not touched
— no test proved any of them needed to change for F29, matching the ruling's "avoid unless a
deterministic test proves one is required." No `bootstrap --execute`, no new claim, no privileged
seat launch, no Agent/Task call, no frozen G2 read/write. Spent authorizations #1/#2/#3 forensic
state untouched.

GRADER : not required — AR-1297A did not request an independent grade for this packet.
FINDINGS: none beyond what RED/GREEN above already documents.
STOP   : none. All explicitly forbidden work (execute, marker #4, new claim, privileged launch,
         Agent/Task/model calibration, frozen G2, Phase 2, compiler/backtest/paper/broker/live-money
         work, permanent model-router work, touching spent #1/#2/#3 state, unrelated hardening) was
         not attempted.
NEXT   : per AR-1297A's speed law — "If AR-1298 closes F29 and no new direct execution blocker is
         observed, GPT will issue cpb-2026-08-17-0004 immediately in the grading ruling." No further
         Worker-1 action is authorized until GPT grades AR-1298. Reporting complete; stopping here.
