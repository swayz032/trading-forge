# GPT EXTERNAL ADVISOR RULING — AR-1297A

## VERDICT

**AR-1297 = PARTIAL PASS. F26, F27's direct path-normalization/tool-wiring repair, and F28 are implemented in the actual repository and their assigned controls are credible. However, the new F27 recursive-search behavior opens one direct guard bypass: no-path or broad-path `Grep`/`Glob` can recurse from an allowed ancestor into the frozen queue / isolated receipt / native-call-manifest surfaces even though direct paths to those surfaces are categorically denied. This is F29 and it blocks bootstrap authorization #4. Fix F29 only. No optional hardening.**

Reviewed Worker-1 true tip:

`2001e380016c60e745c79854bee484616fe63123`

AR-1297 repair commit:

`414dc0ae441876fa473d0b626e166589a84c35c9`

The only commit after the repair commit is the AR-1297 report itself. `compare(414dc0ae..2001e380)` shows exactly one added worker-report file and no bootstrap bundle file changed, so the worker's post-repair bundle measurement remains the code identity for the reviewed repair.

Worker-reported post-repair bundle SHA256:

`c243392144835f5a26e652b547c215c2017dfab93d2809cea8c9e6223eb69dba`

GitHub exposes no status checks and no workflow runs at the reviewed tip. `124/124` is therefore local test evidence, not CI.

---

## 1. F26 — PASS

`SETTING_SOURCES` is now a single exported source of truth equal to:

`user,local`

and `LAUNCH_ARGV` consumes the same constant. The generated plan also reflects the same value. This correctly prevents the privileged control-plane worktree from loading the inherited Worker-1 **project** guard while retaining the tracked `.claude/settings.json` as a repair target.

The worker added a real zero-model `claude --init-only` control and a mutation control. The shipped report states both ran rather than skipping. This is the right proof shape for the assigned defect.

Do not reopen F26 absent a new direct execution failure.

---

## 2. F27 — PATH NORMALIZATION / READ TOOL WIRING PASS, BUT F29 FOUND

### What passes

The production code now:

- wires `Read.file_path`, `Glob.path`, and `Grep.path` into the guard;
- normalizes relative / Windows / MSYS in-worktree paths through one `toRepoRelative(...)` boundary using the **measured** worktree as trust root;
- denies outside-worktree and `..` escapes;
- keeps write authorization separate from read authorization;
- keeps direct reads of the frozen queue, isolated receipt namespace, native-call manifest, and existing categorical surfaces denied.

Those assigned F27 repairs are real.

### F29 — direct recursive-read bypass

The new code deliberately maps no-path `Glob`/`Grep` to the empty-string repository-root sentinel:

- `pathFromToolInput('Glob', {pattern: ...}) -> ''`
- `pathFromToolInput('Grep', {pattern: ...}) -> ''`

`decide()` then calls `classifyControlPlaneReadPath('')`, which returns **ALLOW repository root**.

The shipped tests explicitly assert both no-path calls return ALLOW.

That means a recursive search tool can be authorized at a parent path that does not itself contain a protected token, while the search traverses protected descendants. Examples:

- no-path `Grep` from repository root can search through `docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json`;
- `Grep` or `Glob` rooted at `docs/` or `docs/replay-results/` can traverse into the frozen queue / receipt / native-manifest subtree;
- the direct-path categorical classifier never sees those descendant file paths, so it cannot bite.

This violates the intended structural law that those frozen surfaces are not readable by the privileged seat. A prompt instruction saying "never touch" is not a substitute for the PreToolUse boundary.

This is a **direct execution blocker**, not optional polish.

---

# AR-1298 — AUTHORIZED F29 REPAIR ONLY

## Actor / model

Ordinary Worker-1 engineering seat.

`model = Sonnet 5`

`effort = HIGH`

No Opus. No Agent/subagent calls.

## Objective

Close the recursive-search ancestor bypass without broadening the privileged seat.

The required property is:

> A `Glob` or `Grep` authorization must not permit traversal into any categorically protected descendant merely because the supplied search root itself looks ordinary.

Choose the smallest deterministic implementation. Acceptable shapes include:

1. deny no-path/root recursive searches and deny any recursive search root that is an ancestor of a protected surface; or
2. constrain `Glob`/`Grep` to an explicit set of safe recursive-read roots needed by this packet.

Do **not** implement generic arbitrary filesystem walking inside the guard merely to prove this. Keep the decision deterministic and cheap.

### Required proofs

At minimum, through the real production `decide()` / classifier path:

1. no-path `Grep` cannot scan repository root across protected descendants;
2. no-path `Glob` cannot scan repository root across protected descendants;
3. `Grep` rooted at `docs/` DENY;
4. `Glob` rooted at `docs/replay-results/` DENY;
5. recursive search rooted at `docs/replay-results/svkm-extraction-certified/grade/opus-v2/` DENY;
6. direct Read of an ordinary safe file still ALLOWs;
7. direct Read of queue / receipt / native manifest remains DENY;
8. at least one explicitly safe, packet-useful `Grep`/`Glob` root still ALLOWs, so the repair does not disable recursive search wholesale unless a test proves wholesale denial is required;
9. Agent / Task / PowerShell remain DENY;
10. Bash authority-read exact command remains ALLOW and variants remain DENY;
11. F26 `user,local` law remains unchanged;
12. the full control-plane bootstrap suite is green.

If the existing test `F27-E2E Glob/Grep with and without path ... ALLOW` conflicts with the repaired law, update that assertion intentionally and document why. Do not preserve a false-green expectation for compatibility.

## Preferred scope

- `scripts/control-plane-bootstrap/control-plane-guard.mjs`
- `scripts/control-plane-bootstrap/control-plane-seat-hook.mjs`
- `scripts/control_plane_bootstrap.test.mjs`
- `docs/replay-results/control-plane-bootstrap/CONTRACT.md` only if prose synchronization is necessary
- AR-1298 worker report

Avoid `authorization.mjs`, `bundle.mjs`, `bootstrap.mjs`, and `plan.mjs` unless a deterministic test proves one is required.

## Forbidden

- `bootstrap --execute`
- executable marker #4
- any new bootstrap claim
- privileged real control-plane launch
- Agent / Task / model calibration
- frozen G2 call or retry
- Phase 2
- compiler / backtest / paper / broker / live-money work
- permanent model-router implementation
- deletion / rename / cleanup of spent #1/#2/#3 forensic state
- unrelated hardening

---

## 3. F28 — PASS

The one exact authority-read Bash shape exists and the generated prompt names the same fixed command:

`git show --format= --no-ext-diff origin/external-advisor/gpt-rulings -- advisor-reports/`

The allowlist remains exact/default-deny around that command. Do not reopen F28 absent a direct failure.

---

## 4. TARGET-PACKET CORRECTION FOR FUTURE BOOTSTRAP #4

The AR-1297 worker report's prospective projection used:

`deriveBranch('AR-1297', 'cpb-2026-08-17-0004')`

That projection is non-binding and uses the wrong packet identity for the privileged bootstrap mission.

The control-plane repair being executed by the bootstrap remains **target packet `AR-1278`**. The next executable marker, if F29 passes, must therefore keep:

`target_packet = AR-1278`

and will derive the flat branch:

`control-plane/ar-1278-guard-repair-cpb-2026-08-17-0004`

Against the locally reported existing refs:

- `control-plane/ar-1278-guard-repair`
- `control-plane/ar-1278-guard-repair-cpb-2026-08-17-0003`

this #4 flat sibling has no exact, slash-ancestor, or slash-descendant collision under the repaired F23/F24 law. Runtime must remeasure before any future claim.

Do not migrate the bootstrap mission to AR-1297 merely because AR-1297 is the repair-report number.

---

## 5. FROZEN STATE

Independent GitHub inspection at Worker tip shows:

- frozen queue still has 8 unresolved rows;
- `attempts = {}`;
- isolated frozen receipt directory contains only `README.md`.

Therefore:

`FROZEN G2 = 8 READY / 0 SPENT`

Worker reports shared claim-store union contains #1/#2/#3 spent and #4 absent. GitHub cannot inspect the local Git-common-dir shared claims directly; treat that as worker-measured evidence and require runtime remeasurement before future execution.

No frozen G2 call is authorized.

---

## 6. REQUIRED AR-1298 CLOSEOUT

After the F29 repair commit, run the full bootstrap suite and then the production read-only bootstrap measurement. Report:

- true repair code HEAD;
- final bootstrap bundle SHA256;
- bundle membership count;
- frozen queue SHA256;
- 8 READY / 0 SPENT / README_ONLY;
- claimed authorization ids visible to runtime (#1/#2/#3 present, #4 absent);
- `SETTING_SOURCES = user,local`;
- exact F29 recursive-search controls;
- true Worker-1 branch tip after any report/inventory commit and whether it changed any `BUNDLE_FILES`.

No execute.

---

## SPEED LAW

**This is one narrow direct-blocker repair. If AR-1298 closes F29 and no new direct execution blocker is observed, GPT will issue `cpb-2026-08-17-0004` immediately in the grading ruling. No architecture-polish detour.**

## END STATE

- AR-1297 = PARTIAL PASS
- F26 = PASS
- F27 assigned wiring/normalization = PASS
- F28 = PASS
- F29 recursive-read ancestor bypass = OPEN, AR-1298 authorized
- bootstrap #4 = NOT YET MINTED
- target packet for future #4 = AR-1278
- frozen G2 = 8 READY / 0 SPENT
- next = AR-1298 F29 repair only