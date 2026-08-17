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
    "docs/history/"
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
of AR-1290 it covers nine files: `authorization.mjs`, `bootstrap.mjs`, `bundle.mjs`,
`claim-store.mjs`, `control-plane-guard.mjs`, `control-plane-seat-hook.mjs`, `plan.mjs`,
`cp-commit.mjs` and `cp-finalize.mjs`. One byte in any of them changes the digest and the
authorization refuses — a test proves this for each covered file individually, generated from the
live export rather than hand-counted (`AR1290-C8`, `C9`).

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

The field set is **closed**: a marker carrying `executable`, `settings_path`, `worktree_path` or any
other key is refused as `unknown_field` rather than silently ignored. That is what makes
AR-1276C §9's "no arbitrary executable / settings path / worktree path" structural.

---

## 3. WHAT IS DERIVED, NEVER SUPPLIED

Model text names none of these. All are computed from `target_packet` **and `authorization_id`**
plus fixed constants:

```
branch        control-plane/<target_packet lowercased>-guard-repair/<authorization_id>
worktree      <repo parent>/wt-control-plane-<target_packet lowercased>-<authorization_id>
seat guard    <worktree>/.claude/settings.local.json          <- immutable to the seat
seat manifest <worktree>/.claude/control-plane-guard-manifest.json
repairable    <worktree>/.claude/settings.json                 <- what the packet may fix
executable    claude                      (fixed; no parameter exists)
argv          --dangerously-skip-permissions --setting-sources user,project,local
claim         <git common dir>/tf-control-plane-claim-<authorization_id>.json
```

🛑 **AR-1289A §4 — ATTEMPT IDENTITY, NOT JUST PACKET IDENTITY.** AR-1289's spent attempt left a
`control-plane/ar-1278-guard-repair` branch and a `wt-control-plane-ar-1278` worktree behind, both
derived from `target_packet` alone — so a fresh authorization for the same packet would have
collided with the failed attempt's names, and cleaning up a spent attempt to make room is
forbidden. Both derivations now take the authorization id too (`scripts/control-plane-bootstrap/
plan.mjs:deriveBranch/deriveWorktreeDirName`): same packet + same id -> byte-identical names; same
packet + different id -> different names; the old failed attempt never needs deleting.

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
1 verify GPT authority          read-only
2 verify frozen state           read-only
3 verify source sha + bundle    read-only
4 verify no replay              read-only
5 write claim  (O_EXCL)         <- FIRST MUTATION
6 create branch + worktree
7 materialize immutable seat guard
8 prove doorway (synthetic SessionStart, zero model calls; refuse to launch unless ARMED)
9 launch once
```

A failure after step 5 leaves the authorization **SPENT** and needing a new GPT decision. That is
deliberate: a one-shot that survives a crash is not a one-shot.

---

## 4. HOW THE SEAT IS GUARDED — AND THE ONE THING THAT COULD NOT BE PROVEN

The privileged seat is **hands-free but not unguarded**. Its guard binds the way this repository's
Worker-1 guard demonstrably binds: **from the launch directory**. The bootstrap materializes the
guard into the new worktree's **local** settings source and launches `claude` with that worktree as
cwd and `--setting-sources user,project,local`.

`--settings` is deliberately **not** relied upon. Whether hooks supplied through it register
identically cannot be proven without launching a privileged seat, and guessing is forbidden — so the
design does not depend on it. **The one assumption that remains open is stated in the AR-1278 report
§8 and must be settled before execution is authorized.**

The seat's guard (`control-plane-guard.mjs` + `control-plane-seat-hook.mjs`) is **default-deny**:

- `Agent`, `Task`, `PowerShell` — denied outright;
- `Bash` — **default-denied**, with a closed set of exact shapes (read-only git inspection, the
  focused test runner, `git add <path>` which re-enters the path classifier, the fixed commit helper,
  and a push restricted to the seat's own branch). Shell composition, redirection, substitution and
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
