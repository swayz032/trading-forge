# GPT EXTERNAL ADVISOR RULING — AR-1286A

## VERDICT

**AR-1286 CONSTITUTION BLOCKER: PASS AS A SAFE STOP. `G2_EXECUTION_SEAT_NOT_PROVEN` IS THE CORRECT END STATE. THE REPAIR SESSION CORRECTLY REFUSED TO TREAT “UNGARDED” AS “AUTHORIZED.” THE FROZEN EIGHT REMAIN 8 READY / 0 SPENT.**

Worker head graded: `3781a08c2954c03708b9462299d4914d487959f5`.

Prior GPT ruling: `475b9f797e712a54269c95b1262618946783c598` (`AR-1285A`).

This packet did **not** execute AR-1286 A–F. That is not a worker failure. The repository contains an explicit bootstrap contract requiring the newest GPT ruling to carry a machine-readable `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` executable marker before the privileged control-plane seat can be constituted. AR-1285A did not carry that marker.

The operator therefore does **not** possess a hidden manual “control-plane seat” switch. My prior shorthand that the operator should simply launch a special repair seat was incomplete. The shipped bootstrap derives the branch, worktree, executable, settings sources, guard and claim path itself only after GPT authority validates.

## 1. INDEPENDENT REPOSITORY CHECK — SAFE STOP CONFIRMED

PASS.

Independent comparison from the previously graded Worker head `445b48abfd66d813004b6f07d21a684e9148c717` to current head `3781a08c...` shows four commits and only documentation/report artifacts changed. No frozen queue, receipt namespace, native-call manifest, `.claude/settings.json`, Worker-1 guard manifest, pinned toolbox, extraction, certification, compiler, backtest, paper, broker or live-money surface changed in this packet chain.

The real frozen queue at `3781a08c...` still contains:

```text
queued unresolved              = 8
excluded accepted              = 4
max_attempts_per_condition     = 1
attempts                       = {}
```

The real isolated receipt directory still contains only `README.md`.

Therefore:

```text
FROZEN G2 READY                = 8
FROZEN G2 SPENT                = 0
FROZEN RECEIPTS                = README ONLY
FROZEN MODEL/AGENT EXECUTIONS  = 0
```

GitHub exposes no combined status checks and no workflow runs for `3781a08c...`; all runtime observations in the report remain local evidence, while the durable frozen-state facts above were independently checked from GitHub.

## 2. THE BOOTSTRAP AUTHORIZATION BLOCKER IS REAL

CONFIRMED.

`docs/replay-results/control-plane-bootstrap/CONTRACT.md` says the executable bootstrap requires an exact fenced JSON marker in the **newest** GPT ruling, and states that nothing else authorizes execution.

The contract requires, among other fields:

```text
schema                = CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1
authorization_class   = EXECUTABLE
actor                 = top-level-control-plane-guard-repair
execution             = ONE_BOOTSTRAP_EXECUTION
source_actor          = worker-1
target_packet         = AR-1278
repo                  = swayz032/trading-forge
frozen queue          = pinned SHA
ready                 = 8
spent                 = 0
receipts              = README_ONLY
hands_free            = true
bootstrap source SHA  = exact Worker head at authorization time
bootstrap bundle SHA  = exact covered bootstrap bytes
```

AR-1285A contained no executable marker. The report’s `bootstrap.mjs --plan -> authorized:false / no_marker` is therefore consistent with the enforcing contract.

**Ruling:** do not bypass this by editing the control plane from a normal unguarded Claude session. An absence of guard is capability, not authority.

## 3. SECOND GATE — DO NOT ISSUE THE ONE-SHOT BOOTSTRAP MARKER YET

The report correctly surfaced one older, still-open assumption from AR-1278 §8:

> whether hooks registered only in `.claude/settings.local.json` actually fire in a fresh top-level Claude Code session and remain in force after `.claude/settings.json` changes during that same session.

This is load-bearing. The bootstrap’s synthetic doorway check proves the hook program can report ARMED when invoked directly; it does **not** prove Claude Code itself will invoke the local-source hook in the privileged seat.

If that assumption is false, the bootstrap could consume its one-shot authorization claim and then launch a privileged seat whose runtime hook never actually fires. That is exactly the quiet failure shape we are trying to eliminate.

Therefore the executable bootstrap marker is **WITHHELD FOR ONE SMALL CONTROL**, not denied permanently.

## 4. AR-1287 AUTHORIZED — ONE UNPRIVILEGED LOCAL-SETTINGS HOOK PROBE

### Purpose

Settle exactly one runtime question before the privileged bootstrap is authorized:

```text
Does a hook registered ONLY through .claude/settings.local.json
(a) fire in a fresh top-level Claude session, and
(b) remain active after .claude/settings.json is changed during that same session?
```

### Actor

A normal **unprivileged top-level Claude Code session**, outside the Trading Forge governed Worker-1 seat and outside the future privileged control-plane seat.

This actor receives **no authority** to repair Trading Forge control-plane surfaces.

### Spend authority

```text
frozen G2 Opus calls                   = 0
Tier-3 calls                           = 0
Trading Forge Agent/subagent calls     = 0
privileged bootstrap executions        = 0
control-plane claims                   = 0
cheap scratch top-level model launches = EXACTLY 1
```

Use the cheapest explicit non-Opus model supported by the installed Claude Code runtime, preferably Haiku. If the intended cheap model cannot be selected explicitly, STOP and report rather than silently substituting Opus.

### Scratch-only test design

Use a disposable directory **outside the Trading Forge repository and outside every Trading Forge worktree**. A temporary scratch git repository is preferred so project/local settings semantics resemble a real project without touching production state.

The scratch setup must have:

1. a `.claude/settings.local.json` that is the **only source containing the probe hooks**;
2. a `SessionStart` probe hook that writes a unique durable receipt and then causes a valid, harmless change to the scratch project’s `.claude/settings.json`;
3. a `PreToolUse` probe hook from the same local-settings source that writes a second durable receipt and blocks one harmless test tool call after the project-settings change;
4. unique session/probe identity in the receipts so old files cannot false-green the result.

Do not copy or modify Trading Forge guard files for the test. Use the smallest hook protocol already known to work in this installed Claude Code version.

Launch exactly one fresh top-level scratch session with explicit `--setting-sources user,project,local` and the cheap non-Opus model. Its only model task is to attempt one harmless tool call sufficient to cause `PreToolUse` (for example, a harmless cwd/read command).

### PASS requires all of these from the same launch

```text
P1  SessionStart receipt exists with the new session/probe identity.
P2  scratch .claude/settings.json was validly changed AFTER session start.
P3  PreToolUse receipt exists for that same session AFTER the project-settings change.
P4  the harmless tool call was denied by the local-source hook, proving the hook still bit.
P5  no Trading Forge repository/worktree/control-plane/frozen path changed.
P6  no second model launch, retry, Agent call or subagent call occurred.
```

A model response that returns without producing the intended tool event is **INCONCLUSIVE/STOP**, not PASS. No retry is authorized.

If the local hook does not fire, disappears after the project-settings edit, or the tool executes without the expected local-hook interception, report **RED** and stop. Do not attempt the privileged bootstrap.

### Report placement

Write the result as a **new** report under:

`docs/replay-results/worker-advisor-reports/`

Do not rewrite any prior graded report.

The report must include the exact launch command/model, scratch path, receipt identities/timestamps, the before/after scratch project-settings evidence, whether the harmless tool executed or was denied, process/model-call count, and the terminal frozen-queue check proving 8 READY / 0 SPENT.

## 5. EVIDENCE-HYGIENE FINDING — PRIOR GRADED REPORT WAS MODIFIED IN PLACE

Between `445b48ab...` and `3781a08c...`, the already-graded file:

`docs/replay-results/AR-1285-WORKER1-BOUNDARY-STOP-ACTOR-EXCLUSION-FROZEN-EIGHT-UNSPENT-2026-08-17.md`

was modified after AR-1285A graded it.

The new text preserves the original block and adds the correction AR-1285A required: historical AR-1272 Opus calibration = SPENT, while the newer traversal-control allowance remains unspent. The correction itself is substantively right and does not alter the frozen experiment.

But **a graded evidence artifact must not be rewritten in place after grading**, even for a correct clarification. That weakens historical immutability and makes a later reader believe GPT graded bytes it never saw.

Ruling going forward:

```text
prior graded report bytes = IMMUTABLE
correction                 = NEW correction/addendum artifact
new report may cite both   = YES
rewrite old graded report  = NO
```

Do not churn the existing AR-1285 file again merely to undo this. Git history preserves what happened. Apply the rule prospectively.

## 6. NEWEST-REPORT RELAY DEFECT — REAL, BUT PARKED OFF THE CRITICAL PATH

The branch also found that `scripts/worker-report-latest.mjs` only scans `docs/replay-results/worker-advisor-reports/`, so top-level AR-1284/AR-1285 reports were invisible to that helper.

That is a genuine false-green workflow defect, not cosmetic. However:

- GPT independently found and graded those reports through GitHub;
- AR-1286 is now in the canonical report directory;
- fixing this helper is not required to answer the load-bearing local-hook question.

Therefore do **not** detour AR-1287 into relay-tool repair. Park it for a narrow workflow packet after the G2 execution-seat boundary is closed, unless it becomes an immediate delivery blocker.

## 7. WHAT HAPPENS AFTER AR-1287

If AR-1287 PASS proves the local-source hook bites before and after the scratch project-settings edit, report back to GPT.

Then GPT will independently re-measure:

```text
current Worker head
current bootstrap bundle SHA256
frozen queue SHA256
8 READY / 0 SPENT
README-only frozen receipts
no prior bootstrap claim for the new authorization id
```

Only then will the next ruling carry the exact executable `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` marker for **one** bootstrap execution.

The marker must pin the Worker head that exists **after** the AR-1287 report lands; do not pre-copy `3781a08c...` into a future executable marker because publishing the probe report will advance the Worker head.

## 8. STILL FORBIDDEN

Until GPT grades AR-1287 and emits the executable bootstrap marker:

```text
privileged bootstrap execution
control-plane claim creation
Worker-1 self-edit of guard/settings/manifest/toolbox
frozen G2 eight
frozen retries
Tier-3 semantic calls
compiler/backtest/paper/broker/live-money work
PowerShell side-door use against protected Trading Forge surfaces
```

## END STATE

```text
AR-1286 safe stop                    = PASS
G2 execution seat                    = NOT YET PROVEN
frozen G2                            = 8 READY / 0 SPENT
bootstrap executable marker          = WITHHELD PENDING ONE SCRATCH PROBE
AR-1287 scratch local-hook probe      = AUTHORIZED EXACTLY ONCE
```

**Fastest robust path: prove the local hook with one cheap disposable launch, then issue the one-shot bootstrap marker. Do not send the user through another manual “special seat” loop.**