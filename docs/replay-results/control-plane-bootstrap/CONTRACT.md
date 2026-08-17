# CONTROL-PLANE BOOTSTRAP — THE EXECUTION-AUTHORIZATION CONTRACT (AR-1277)

This is the exact block a later GPT ruling must carry to authorize **one** bootstrap execution.
Nothing else authorizes it. `scripts/control-plane-bootstrap/authorization.mjs` is the enforcing
implementation; this file is its human-readable contract.

---

## 1. THE MARKER GPT MUST EMIT

Place this as a fenced ```json block in the ruling that authorizes execution. It must be the
**newest** ruling on `origin/external-advisor/gpt-rulings` at the moment of execution.

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "authorization_class": "EXECUTABLE",
  "authorization_id": "cpb-<yyyy-mm-dd>-<nnnn>",
  "ruling_id": "<the AR number of THIS ruling, e.g. AR-1280 or AR-1280A>",
  "actor": "top-level-control-plane-guard-repair",
  "execution": "ONE_BOOTSTRAP_EXECUTION",
  "source_actor": "worker-1",
  "target_packet": "AR-1278",
  "repo": "swayz032/trading-forge",
  "frozen_queue_sha256": "5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939",
  "require_ready": 8,
  "require_spent": 0,
  "require_receipts": "README_ONLY",
  "require_agent_model_executions_before_launch": 0,
  "hands_free": true,
  "allowed_paths": [
    ".claude/settings.json",
    ".claude/worker1-hook-guard-manifest.json",
    "CLAUDE.md",
    "AGENT-LOGS.md",
    ".claude/rules/",
    "docs/history/",
    "docs/replay-results/g2d-prompt-transport/",
    "docs/replay-results/worker-advisor-reports/",
    "scripts/control-plane-bootstrap/.cp-commit-msg.tmp"
  ],
  "bootstrap_source_sha": "<the Worker-1 HEAD you reviewed, 40 hex>",
  "bootstrap_bundle_sha256": "<the bundle digest at that head, 64 hex>"
}
```

### The fields that differ from AR-1276C §7's example, and why

| field | why it exists |
|---|---|
| `authorization_class` | **The discriminator.** AR-1276C §7 prints a complete marker and then says it must be refused. Keying on the schema name alone would execute the ruling that forbade it. The example lacks this field, so its refusal is structural — not prose-recognition. |
| `authorization_id` | **Replay identity.** One authorization is one execution; the id is claimed O_EXCL **before the first mutation**. |
| `ruling_id` + `repo` | **Binding.** The marker is bound to the ruling that carried it and to one repository, so it cannot be lifted from a graded ruling into a later one. |
| `bootstrap_source_sha` + `bootstrap_bundle_sha256` | **AR-1277A F-5.** The authorization pins the exact code that will run. The SHA alone is insufficient (a dirty tree at the right HEAD runs different bytes); the bundle alone is insufficient (it says nothing about ancestry). Both, or neither. |

### How to obtain the two pins

```
$ node scripts/control-plane-bootstrap/bootstrap.mjs      # --plan is the default, read-only
  "worker_head":              <- bootstrap_source_sha
  "bootstrap_bundle_sha256":  <- bootstrap_bundle_sha256
```

🛑 **This prose has gone stale twice already (AR-1288A §2 caught the first drift) — the definitive
list is `BUNDLE_FILES` in `scripts/control-plane-bootstrap/bundle.mjs`, never this paragraph.** As
of AR-1291 it covers ten files: `authorization.mjs`, `bootstrap.mjs`, `bundle.mjs`,
`claim-store.mjs`, `control-plane-guard.mjs`, `control-plane-seat-hook.mjs`,
`materialize-g2-prompt-transport.py`, `plan.mjs`, `cp-commit.mjs` and `cp-finalize.mjs`. One byte in
any of them changes the digest and the authorization refuses — a test proves this for each covered
file individually, generated from the live export rather than hand-counted (`AR1290-C8`, `C9`).

`allowed_paths` is the exact protected-edit allowlist for AR-1278 (AR-1276C §9). The seat's guard is
**default-deny**: anything not listed is refused. Adjust the list to AR-1278's real scope before
issuing. Entries referencing the frozen G2 plane are refused categorically — no ruling can grant them.

---

## 2. WHAT REFUSES, AND WITH WHAT CODE

All fail-closed. Codes are stable and machine-readable.

```
not_an_object · wrong_schema · unknown_field · missing_field · not_executable · wrong_actor
wrong_source_actor · wrong_execution · wrong_repo · bad_target_packet · bad_authorization_id
ruling_id_mismatch · stale_authority · bad_queue_sha_format · frozen_queue_sha_mismatch
ready_not_8 · spent_not_0 · receipts_not_readme_only · agent_executions_not_0
hands_free_not_true · bad_allowed_paths · escaping_allowed_path · forbidden_g2_path
replayed_authorization
```

Two further refusal codes are returned by `run()` itself (in `bootstrap.mjs`), not by
`validateAuthorization` — both are still pre-mutation refusals except where §3a says otherwise:

```
branch_namespace_collision   AR-1295 F24, pre-claim, see §3a
doorway_not_armed            post-claim, see §4
```

The field set is **closed**: a marker carrying `executable`, `settings_path`, `worktree_path` or any
other key is refused as `unknown_field` rather than silently ignored. That is what makes
AR-1276C §9's "no arbitrary executable / settings path / worktree path" structural.

---

## 3. WHAT IS DERIVED, NEVER SUPPLIED

Model text names none of these. All are computed from `target_packet` **and `authorization_id`**
plus fixed constants:

```
branch        control-plane/<target_packet lowercased>-guard-repair-<authorization_id>
worktree      <repo parent>/wt-control-plane-<target_packet lowercased>-<authorization_id>
seat guard    <worktree>/.claude/settings.local.json          <- immutable to the seat
seat manifest <worktree>/.claude/control-plane-guard-manifest.json
repairable    <worktree>/.claude/settings.json                 <- what the packet may fix
executable    claude                      (fixed; no parameter exists)
argv          --dangerously-skip-permissions --setting-sources user,local  (AR-1296A F26)
claim         <git common dir>/tf-control-plane-claim-<authorization_id>.json
```

🛑 **AR-1289A §4 — ATTEMPT IDENTITY, NOT JUST PACKET IDENTITY.** AR-1289's spent attempt left a
`control-plane/ar-1278-guard-repair` branch and a `wt-control-plane-ar-1278` worktree behind, both
derived from `target_packet` alone — so a fresh authorization for the same packet would have
collided with the failed attempt's names, and cleaning up a spent attempt to make room is
forbidden. Both derivations now take the authorization id too (`scripts/control-plane-bootstrap/
plan.mjs:deriveBranch/deriveWorktreeDirName`): same packet + same id -> byte-identical names; same
packet + different id -> different names; the old failed attempt never needs deleting.

🛑 **AR-1295 F23/F24 — "DIFFERENT NAME" IS NOT "NO COLLISION". Bootstrap authorization #2**
(`cpb-2026-08-17-0002`) proved this the expensive way: `deriveBranch` used to join the
authorization id with `/` — `control-plane/ar-1278-guard-repair/<auth-id>` — and Git's ref storage
cannot hold a ref at `refs/heads/X` and a second ref at `refs/heads/X/Y` at once, so the moment
authorization #1's preserved forensic branch occupies the bare `control-plane/ar-1278-guard-repair`
name, EVERY later authorization for that packet nests underneath it and refuses with
`fatal: cannot lock ref`. "Same packet + different id -> different names" was true and did not
help; the names were different strings that still collided as Git refs. Two changes closed this:

1. **The separator is now `-`, not `/`** — every derived branch is a flat sibling under
   `control-plane/`, never nested under another real branch's own name (`control-plane/` itself is
   never a branch, only ever a namespace prefix — that invariant is what makes the flat form safe).
2. **A read-only pre-claim check, `branchNamespaceCollision` (`plan.mjs`) fed by
   `measured.existingControlPlaneBranches` (`bootstrap.mjs:measureState`, scoped to
   `refs/heads/control-plane/*` only — not a repo-wide ref scan)**, refuses `branch_namespace_collision`
   BEFORE `write_claim` whenever the derived branch would exact-match, nest under, or be nested
   under by any existing `control-plane/*` ref. This is deliberately general — it does not merely
   special-case the one bare-prefix pattern that has bitten twice; it holds for any future naming
   scheme this file might grow.

The old forensic branch/worktree are never renamed or deleted to make room — that stays forbidden.

🛑 **AR-1289A §3 — THE CLAIM LIVES IN THE SHARED GIT COMMON DIRECTORY, NOT ANY WORKING TREE.**
AR-1289 found the defect: the claim used to be written as an *uncommitted* file inside the source
worktree's own tracked tree, but the receiving seat reads its claim from **its own**
`git rev-parse --show-toplevel` — a brand-new `git worktree add` checkout, which can only ever
contain committed bytes at the ref it was cut from. An uncommitted file in a sibling worktree is
structurally invisible to it; repeating the claim would not have fixed this.

Every worktree of **one** repository shares exactly one Git *common* directory
(`git rev-parse --git-common-dir` resolves to the same physical folder from any of them — this is
the entire mechanism). `scripts/control-plane-bootstrap/claim-store.mjs` is the single place both
the bootstrap (writer, running in the source worktree) and the receiving seat (reader, running in a
brand-new sibling worktree) independently derive this path from Git itself — nothing passes it
through the marker, manifest, model prompt, environment variable, operator input, or any caller
parameter. The common directory already exists (git created it), so writing the claim there remains
exactly one `wx`/O_EXCL act — no `mkdir` reintroduces the AR-1278A F-10 window.

**The legacy committed directory (`docs/replay-results/control-plane-bootstrap/claims/`) is
immutable forensic history, never written to again.** `cpb-2026-08-17-0001.json` stays committed
there forever and stays recognised as spent — the replay check is a **union** of both stores
(`claim-store.mjs:unionClaimedIds`), so retiring the old storage mechanism can never silently
un-spend an old authorization.

The claim namespace is asserted disjoint from the frozen G2 receipt namespace at plan time, and a
test proves the assertion bites.

## 3a. EXECUTION ORDER — THE CLAIM IS THE FIRST MUTATION (AR-1277A F-4)

```
1 verify GPT authority                  read-only
2 verify frozen state                   read-only
3 verify source sha + bundle            read-only
4 verify no replay                      read-only
5 verify branch namespace available     read-only   <- AR-1295 F24
6 write claim  (O_EXCL)                 <- FIRST MUTATION
7 create branch + worktree
8 materialize immutable seat guard
9 prove doorway (synthetic SessionStart, zero model calls; refuse to launch unless ARMED)
10 launch once
```

A failure after step 6 leaves the authorization **SPENT** and needing a new GPT decision. That is
deliberate: a one-shot that survives a crash is not a one-shot.

🛑 **AR-1295 F25 — A SPENT AUTHORIZATION MUST NEVER CRASH INSTEAD OF REPORTING.** Steps 7-10 are
each wrapped individually (`bootstrap.mjs:runStage`); an exception from any one of them — the exact
shape `git worktree add`'s ref-namespace failure took against bootstrap #2 — is caught and returned
as a structured result, never left to crash the process: `authorized:true, authorization_spent:true,
executed:false, post_claim_failure_stage:"<the op that threw>", completion_verified:false,
completion_failure_reason:"post_claim_exception"`. Every return path from step 6 onward — this new
shape, the pre-existing `doorway_not_armed` refusal, and the final completion-verification result —
now carries `authorization_spent:true` unconditionally, and the CLI exit-code check keys on that
field (not `executed`) so a spent-but-unverified authorization can no longer exit 0.

---

## 4. HOW THE SEAT IS GUARDED — AND THE ONE THING THAT COULD NOT BE PROVEN

The privileged seat is **hands-free but not unguarded**. Its guard binds the way this repository's
Worker-1 guard demonstrably binds: **from the launch directory**. The bootstrap materializes the
guard into the new worktree's **local** settings source and launches `claude` with that worktree as
cwd and `--setting-sources user,local` (AR-1296A F26 — `project` was dropped from the sources list:
a fresh control-plane worktree checked out from the pinned Worker-1 head carries the tracked
Worker-1 project guard in its own `.claude/settings.json`, and `user,project,local` loaded it
alongside the privileged local guard. `user,local` never loads that project source at all).

`--settings` is deliberately **not** relied upon. Whether hooks supplied through it register
identically cannot be proven without launching a privileged seat, and guessing is forbidden — so the
design does not depend on it. **The one assumption that remains open is stated in the AR-1278 report
§8 and must be settled before execution is authorized.**

The seat's guard (`control-plane-guard.mjs` + `control-plane-seat-hook.mjs`) is **default-deny**:

- `Agent`, `Task`, `PowerShell` — denied outright;
- `Bash` — **default-denied**, with a closed set of exact shapes (read-only git inspection, the
  focused test runner, the fixed prompt-transport helper, `git add <path>` which re-enters the path
  classifier **except the one transient commit-message path, categorically refused for staging even
  though it is writable (AR-1291A F20)**, and the terminal finalize path — commit, push and the
  trusted completion receipt in one act. **The older commit-only `cp-commit.mjs` shape is RETIRED
  from this allowlist (AR-1292A F22): it commits locally but never pushes and never writes the
  completion receipt, so a legally-invoked commit-only route could strand a one-shot authorization
  in a local-only state. The file still exists (conservative/historical, still in `BUNDLE_FILES`);
  only its privileged Bash route is gone.** Shell composition, redirection, substitution and
  arbitrary `node -e` / `python -c` / `sh -c` / `npx` are refused before matching;
- writes — allowed only if they match `allowed_paths`;
- frozen G2 paths, the seat's own guard registration, the claim namespace, money-path and toolbox
  prefixes — denied categorically, allowlist or not;
- unrecognised tool — denied (no fallthrough);
- identity mismatch, missing manifest, internal error — denied;
- **`SessionStart` writes a durable armed receipt into the worktree's git directory, and every
  PreToolUse requires it and re-checks it against freshly measured identity.** The git dir is outside
  the working tree, so no Edit/Write (absolute paths are refused as escaping) and no allowed Bash
  shape can reach it.

### Identity is MEASURED, never taken from the manifest

The manifest supplies only the **expected** side. Observed values come from `git` and the filesystem:
repo remote, worktree realpath, branch, HEAD, plus the live frozen-queue digest and receipt state.
The first implementation built both sides from the manifest — so the check compared a file to itself
and could never fail (AR-1277A F-1). That is fixed, and a manifest-lie negative proves it.

---

## 4a. AR-1291 — WHAT MADE THE PLAN EXECUTABLE (F-16..F-19)

AR-1290A's pre-execution review found the plan the privileged seat would receive could not
actually be completed even after the AR-1289A claim-store repair: it told the seat to write a
report and a commit-message file into paths no marker authorized, told it to run a prompt-transport
command that did not exist, and left one seat doing two mutually exclusive jobs.

- **F-16 (report path)** — `buildPacketPrompt()` now names `docs/replay-results/worker-advisor-reports/`
  explicitly as the one report path, and that path is in the marker template above. The mechanism
  is the ordinary one: `classifyControlPlanePath` allows a write only when it matches
  `marker.allowed_paths` — nothing new was added to the guard itself.
- **F-17 (commit-message path)** — same mechanism, same fix: `scripts/control-plane-bootstrap/.cp-commit-msg.tmp`
  is now in the marker template, and the prompt tells the seat to write it as its own numbered step
  before staging.
- **F-18 (privileged seat vs. Agent traversal)** — architecturally resolved by GPT, not by this
  packet: the closeout is two phases. **Phase 1** (this privileged seat: repair/arm, run the fixed
  transport helper, materialize the report, finalize, exit — Agent/Task remain categorically denied)
  and **Phase 2** (a fresh *ordinary* Worker-1 seat, launched only after GPT grades Phase 1: the one
  cheap non-G2 Agent traversal calibration, the remaining zero-model G2 controls, re-check
  frozen 8/0, report back). `buildPacketPrompt()` states this split explicitly so the model does not
  have to infer it.
- **F-19 (exact prompt transport)** — `scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py`
  is the one fixed, no-argument CLI the guard allows (`control-plane-guard.mjs` BASH_ALLOWED_SHAPES,
  id `g2-prompt-transport`). It reuses `g2d_freeze_native_calls.py`'s canonical prompt construction
  BY IMPORT — `_SYSTEM_PROMPT`, `_build_user_message`, `PROMPT_JOINER` — never retypes a template,
  re-verifies every row against the frozen `native_call_manifest_t1.json` before any byte is
  written, and writes only under `docs/replay-results/g2d-prompt-transport/` (also now in the marker
  template). It is transport, not authority: it cannot select a condition, cannot accept a caller
  path, and refuses closed — before any output — on a missing/mismatched manifest row.

None of `bootstrap.mjs`, `authorization.mjs`, `cp-finalize.mjs`, `cp-commit.mjs`, `claim-store.mjs`
or `control-plane-seat-hook.mjs` needed to change to close F-16..F-19 — every fix is a marker-scope
addition, a prompt-content change, or one new file.

## 4b. AR-1292 — F20/F21: TWO CLOSEOUT-INTEGRITY DEFECTS AR-1290A'S PRE-EXECUTION REVIEW FOUND

- **F20 (transient commit-message file was stageable)** — `.cp-commit-msg.tmp` being in
  `allowed_paths` (required so Edit/Write can create it) also made `git add
  scripts/control-plane-bootstrap/.cp-commit-msg.tmp` a legal Bash command, and `cp-finalize.mjs`
  deleting the working-tree copy does not unstage an already-staged addition — so the transient file
  could ride into the final commit on a literal reading of "stage the allowed paths." Fixed
  categorically in the `git-add` Bash shape only (`control-plane-guard.mjs:NEVER_STAGEABLE_PATHS`):
  the exact path is still writable (Edit/Write unaffected) but can never be staged, whatever
  `allowed_paths` says. The generated prompt now says so explicitly.
- **F21 (a failed push could still verify as complete)** — the supervising bootstrap checked only
  `authorization_id`/`ruling_id`/`target_packet` on the completion receipt, never `pushed`,
  `commit_sha` shape, `branch`, or whether the supervised launch itself succeeded. A local-only
  commit (network blip, auth failure, wrong remote) could therefore report `completion_verified:
  true` while the repair sat unreachable in a worktree nobody reads, on an authorization already
  permanently spent. Fixed with one pure function, `bootstrap.mjs:verifyCompletion`, requiring launch
  success, receipt identity match, the derived branch, a real 40-hex commit SHA shape, and
  `pushed === true` — all conjunctive. `run()`'s result now also carries
  `completion_failure_reason` so `executed: true` can never be read as success on its own (G4); the
  CLI reports a distinct non-zero exit when execution happened but verification did not.

---

## 5. WHY THIS IS NEW CODE AND NOT THE PROVEN TOOLBOX GUARD

Measured in the pinned toolbox at `b6c70282`:

1. `lane-boundary-guard.mjs:175` — `classifyPath()` **throws** unless the worker is `worker-1` or
   `worker-2`. A control-plane actor cannot be expressed.
2. `SELF_PROTECTED_RULES` + `DENY_REGARDLESS_VERDICTS` deny `.claude/settings.json`,
   `hook-guard-manifest`, `.claude/hooks/` and the toolbox prefix regardless of scope — which is
   precisely AR-1278's work surface.

So a control-plane seat wearing the Worker-1 guard would be denied its entire packet. The choice was
never "new guard vs proven guard"; it was **new guard vs no guard**. This is the part of the package
most in need of GPT's line-by-line review.
