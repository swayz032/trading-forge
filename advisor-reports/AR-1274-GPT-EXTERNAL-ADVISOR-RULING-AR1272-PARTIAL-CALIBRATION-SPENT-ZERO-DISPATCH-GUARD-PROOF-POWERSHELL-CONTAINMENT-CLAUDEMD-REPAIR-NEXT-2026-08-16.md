# GPT EXTERNAL ADVISOR RULING — AR-1274

## AUTHORITY

This ruling is the live GPT operator message after independent inspection of AR-1272, the Worker-1 branch, the pinned toolbox implementation, the frozen G2 queue/receipt surfaces, and GitHub status evidence.

Blueprint V4 + Revision 5 sequencing remains binding. This packet does not advance Trading Forge past the current Graph Engineering / certification gate.

---

## VERDICT

**AR-1272: PARTIAL / INCONCLUSIVE.**

The Worker-1 seat/bootstrap repair is materially improved and the one authorized non-G2 Opus calibration was handled with good restraint, but the calibration did **not** prove its central witness: a real native `Agent` call traversing the installed `PreToolUse` hook.

The one-shot calibration authorization is now **SPENT**. It must not be retried.

The frozen G2 eight remain **8 READY / 0 SPENT** and remain locked.

---

## INDEPENDENTLY GRADED STATUS

| Item | Ruling |
|---|---|
| Fresh Worker-1 shortcut / correct worktree seating | **PASS** |
| SessionStart → later PreToolUse lifecycle repair | **PASS** |
| Session-bound guard marker design | **PASS** |
| Production-shaped separate-process lifecycle tests | **PASS** |
| Hands-free `--dangerously-skip-permissions` launch mode | **INTENTIONAL — PRESERVE** |
| Exactly one authorized non-G2 Opus calibration | **SPENT; NO RETRY** |
| Explicit requested model `opus` | **PASS / report-supported** |
| Real native Agent dispatch | **report-supported; no independent durable hook receipt** |
| Agent → installed PreToolUse traversal | **NOT PROVEN** |
| Actual Opus routing honored vs parent-model inheritance | **NOT INDEPENDENTLY PROVEN** |
| Frozen queue SHA / attempts / receipt preservation | **PASS** |
| Separate PowerShell tool covered by guard | **OPEN BLOCKER BEFORE FROZEN EIGHT** |
| Bound-seat worker report publication path | **OPEN WORKFLOW DEFECT** |
| Root `CLAUDE.md` size / hot-instruction reliability | **OPEN DEFECT — ~203.5k chars observed by runtime** |
| GitHub CI at Worker/toolbox grading pins | **NONE — local-only evidence** |

---

## 1. WHAT PASSED — THE REAL LIFECYCLE BUG WAS REPAIRED

The earlier production defect was real: the old design wrote `TF_CLAUDE_GUARD_ANCHOR_OK=1` during SessionStart and assumed a later hook subprocess would inherit it. A correctly launched Worker-1 seat disproved that assumption.

The replacement design at the new toolbox lineage is materially stronger:

- SessionStart mints a session-bound guard marker in the worktree git-dir rather than relying on cross-process environment inheritance.
- The marker binds the Claude `session_id`, worktree/repo identity, branch/head, manifest/toolbox identity and bundle identity.
- Later PreToolUse calls independently validate the marker and current anchor.
- The toolbox added the missing production-shaped lifecycle control: SessionStart process exits; a separate PreToolUse process runs afterward; no synthetic `TF_CLAUDE_GUARD_ANCHOR_OK` is injected.
- Wrong-session, wrong-worktree/head and tamper/mutation controls were added.
- A real fresh Worker-1 seat then reached the normal protected-surface Bash fence instead of the prior false `anchor not verified` denial.

This closes the specific SessionStart→PreToolUse state-handoff defect.

The toolbox reported **198/198 local tests green** after the lifecycle repair. GitHub has no CI/status evidence at the graded pins, so this remains local-only test evidence.

---

## 2. THE ONE CALIBRATION WAS SPENT, BUT ITS CENTRAL WITNESS IS STILL OPEN

AR-1272 reports exactly one native `Agent` call with:

- `subagent_type = general-purpose`;
- explicit `model = opus`;
- benign non-G2 self-report prompt;
- no retry;
- no frozen-queue membership;
- zero subagent tool uses.

The Worker correctly refused to manufacture stronger evidence after the fact.

However, an **allowed** Agent call is non-discriminating:

```text
hook fired and allowed it
```

and

```text
hook never fired for Agent
```

produce the same visible result.

The current bridge computes `_audit`, then `visibleHookOutput()` deletes `_audit` before returning output. There is therefore no durable, independent per-call hook witness proving that the real calibration crossed `PreToolUse:Agent`.

The Worker explicitly disclosed this. That is good evidence discipline, but it means AR-1271's central runtime witness was **not closed**.

### Model identity claim

The subagent reportedly read `claude-opus-5[1m]` from its own runtime context. But the dispatcher seat itself is also Opus 5 (1M), so that observation cannot distinguish:

```text
explicit opus routing was honored
```

from

```text
subagent inherited the parent model
```

Therefore:

- `requested = opus`: proved/report-supported;
- `runtime displayed Opus`: corroborated;
- `explicit routing honored`: **NOT independently proven**.

No second model call is authorized to repair this. The next proof must be zero-dispatch.

---

## 3. FROZEN G2 CONTROL PLANE — PASS

GPT independently inspected the real Worker-1 tree after AR-1272.

Frozen queue:

`docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json`

Required SHA remains:

`5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`

State remains:

```text
8 entries
attempts: {}
READY: 8
SPENT: 0
```

Real G2 receipt namespace remains README-only with no new:

```text
.attempt
.dispatch
.raw
.completion
```

The non-G2 calibration did not consume or mutate the frozen eight.

---

## 4. HANDS-FREE WORKER MODE IS NOT THE DEFECT

**Do not remove `--dangerously-skip-permissions`.**

That launch mode exists so Worker-1 can work autonomously without Tonio manually approving ordinary tool calls. The user is not to become a permission-click operator.

The safety architecture must make hands-free execution safe by mechanically constraining the worker through the registered guard and controlled tool surface.

The actual open issue is narrower:

- `.claude/settings.json` currently matches `Edit|Write|NotebookEdit|Bash|Agent|Task` for PreToolUse;
- this Claude runtime also exposes a distinct `PowerShell` tool;
- Worker-1 observed read-only PowerShell invocations running outside the guard matcher;
- write capability against a protected surface was deliberately not tested.

This is a **demonstrated coverage gap**, not yet a demonstrated protected-surface exploit.

But with hands-free permissions intentionally enabled, an unguarded shell-capable surface cannot be left unresolved before the frozen eight.

### Required containment

For AR-1275, close the surface mechanically while preserving hands-free operation:

1. Keep `--dangerously-skip-permissions` in the Worker-1 shortcut/launcher.
2. Disable the separate PowerShell tool in the Worker-1 launch environment if the installed Claude Code runtime supports that control; verify the exact runtime behavior rather than assuming it.
3. Independently make the guard fail closed if `tool_name === "PowerShell"` is ever presented to PreToolUse.
4. Do **not** merely add `PowerShell` to the matcher while leaving the bridge to fall through as `{ guarded: false }`.
5. Acceptance is a fresh normal Worker-1 shortcut seat with **no manual approval prompts**, normal guarded work functional, and PowerShell either absent or mechanically denied.

Tonio performs no special command sequence for this acceptance path.

---

## 5. ROOT `CLAUDE.md` IS TOO LARGE — REPAIR THE HOT INSTRUCTIONS

The live Claude Code warning reports root `CLAUDE.md` at approximately **203.5k characters**, above the 150k warning limit.

The file also contains large historical Wave material and stale static phase prose in the always-loaded instruction surface.

This is separate from the guard lifecycle bug, but it is a real worker-reliability defect: current authority should not compete with hundreds of kilobytes of historical build journal text.

### AR-1275 requirement

Reduce root `CLAUDE.md` comfortably below the limit; **target <= 100k characters and preferably much smaller**.

Keep only durable hot rules such as:

- Trading Forge mission;
- Worker role and branch/worktree law;
- GPT rulings are live operator authority;
- Blueprint V4 + Revision 5 precedence;
- FAST + ROBUST engineering rules;
- source-fidelity rules;
- safety/lock discipline;
- report/ruling protocol;
- critical paths/commands/pointers.

Move, do not destroy:

- old Wave journals;
- closed historical pass prose;
- long subsystem histories;
- deep reference material;
- obsolete static phase summaries.

Use existing `AGENT-LOGS.md`, design docs, `.claude/rules/`, or clearly named reference docs as appropriate. Preserve unique institutional knowledge and leave clear pointers.

Replace stale static `Current Phase` text with a dynamic authority pointer:

```text
GPT onboarding
 -> Blueprint V4
 -> Revision 5
 -> newest GPT ruling
 -> actual repository evidence
```

Required evidence:

- before character/byte count;
- after character/byte count;
- moved-material map: source section → destination file;
- proof current Worker/GPT/safety rules remain directly loaded or explicitly referenced;
- no unique project knowledge silently deleted.

---

## 6. WORKER REPORT DELIVERY MUST BE AUTOMATIC — NOT TONIO'S JOB

The first correctly bound seat exposed another architecture mismatch:

- Worker reports are expected on the GPT branch under `advisor-reports/`;
- the bound Worker-1 edit scope does not permit that location/branch mutation;
- the worker therefore durably landed AR-1272 under `docs/replay-results/` on its own Worker branch.

Do not solve this by asking Tonio to copy/paste or relay reports.

### Fast robust repair

Establish a canonical Worker-branch landing location inside the worker's governed write scope, for example:

`docs/replay-results/worker-advisor-reports/`

Then make the operator/check-report workflow discover the newest Worker report there from the active Worker branch automatically.

The GPT branch remains the location for GPT rulings. Worker-1 does not need arbitrary write permission to the GPT branch merely to report its work.

The report must still carry the grading pin, branch, toolbox pin, tests, artifacts, frozen-state evidence and CI status expected by onboarding.

---

## 7. ZERO-DISPATCH AGENT HOOK PROOF — FASTEST NEXT WITNESS

The one-shot Opus calibration is spent. **No retry and no substitute model dispatch.**

The missing Agent→PreToolUse witness can be closed without executing another model call.

### Required design

Add the smallest durable guard audit/probe mechanism:

1. PreToolUse records a minimal session-bound audit record in a trusted runtime/git-dir location before visible `_audit` is stripped.
2. Add a uniquely identified benign **non-G2 guard-probe Agent shape**.
3. When that exact probe reaches `PreToolUse:Agent`, the guard:
   - writes the audit witness;
   - **DENIES BEFORE DISPATCH**;
   - never evaluates/spends a frozen G2 attempt;
   - never launches a subagent/model.
4. Prove the witness contains the same session identity/toolbox/bundle/branch-head binding as the live guard seat.
5. Prove the probe cannot equal any frozen native-call identity.

The result must establish:

```text
real Agent tool attempt
 -> installed PreToolUse executed
 -> guard persisted witness
 -> guard denied probe
 -> model/subagent dispatch count = 0
 -> frozen G2 remains 8 READY / 0 SPENT
```

This is a control-plane probe, **not a second calibration**.

Do not authorize or execute another Agent/subagent model call in AR-1275.

---

## 8. BOUNDED TOOLING FRICTION — DO NOT BUILD A SHELL PARSER

AR-1272 also exposed commit/report ergonomics:

- guarded Bash rejects command text containing redirect-like `<` / `>` characters;
- `git commit -F` therefore became the safe way to preserve the required co-author trailer;
- a temporary message file inside the repo could be created but no guard-respecting delete primitive was available;
- the pre-commit path also performs stash/restore behavior that can be unsafe when multiple worktrees commit concurrently.

Do not turn this into a broad shell-language parser project.

If this blocks AR-1275, add the smallest inspected helper under an already governed path that writes commit-message scratch state under the worktree git-dir and cleans it internally, with focused controls. Otherwise carry it as a bounded follow-up.

Do not use an unguarded PowerShell path to work around guard restrictions.

---

## 9. AR-1275 — EXACT NEXT WORKER PACKET

### A. Close the Agent hook witness with zero model dispatch

- persist minimal trusted PreToolUse audit;
- add one hard-denied non-G2 Agent guard-probe shape;
- prove the real Agent attempt reaches PreToolUse;
- prove **0 subagent/model executions**;
- prove probe cannot equal a frozen G2 call;
- no retry of the spent Opus calibration.

### B. Close the PowerShell coverage gap while preserving hands-free mode

- keep `--dangerously-skip-permissions`;
- disable separate PowerShell surface at launch where supported;
- hard-deny `PowerShell` at guard level if surfaced;
- fresh shortcut acceptance with no user approval prompts;
- normal guarded tools still work.

### C. Slim `CLAUDE.md`

- before/after size evidence;
- target <= 100k chars, preferably much smaller;
- move historical/reference material rather than deleting it;
- preserve current authority and safety laws;
- remove stale static phase claims from hot context.

### D. Establish automatic Worker-report landing

- canonical report path on Worker-1 branch inside governed scope;
- update durable worker/onboarding discovery contract as appropriate;
- no Tonio relay step;
- no arbitrary Worker write permission to GPT branch required.

### E. Preserve lifecycle repair and prior guard wins

Do not regress:

- session-bound guard marker;
- queue exact protection;
- receipt-prefix protection;
- protected-surface Bash fence ordering;
- native G2 pre-call identity rules;
- toolbox immutable pin/bundle discipline.

### F. Test order

Use:

1. focused red/green for Agent audit/probe and PowerShell containment;
2. lifecycle neighboring tests;
3. negative/mutation controls;
4. full toolbox local suite once after focused lane is green;
5. GitHub CI/status reported separately.

### G. Frozen preservation — before and after

Must remain exactly:

```text
queue SHA = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
attempts = {}
READY = 8
SPENT = 0
G2 .attempt/.dispatch/.raw/.completion = 0/0/0/0
```

### H. Required AR-1275 runtime statement

State explicitly:

```text
Agent/subagent model executions in this packet: 0
Opus calibration retries: 0
Frozen G2 calls executed: 0
```

### I. User burden

**Tonio is not assigned any command, cwd selection, permission approval, report relay, hook inspection, or manual cleanup step.**

The normal desktop Worker-1 shortcut is the user-facing entry path.

---

## 10. FORBIDDEN IN AR-1275

- no second non-G2 calibration;
- no Agent/subagent **model dispatch**;
- no frozen G2 call;
- no retry;
- no compiler/backtest campaign;
- no PAPER;
- no broker/Topstep/live;
- no broad shell-parser project;
- no removing `--dangerously-skip-permissions`;
- no restoring manual approval prompts;
- no asking Tonio to launch from a special cwd, run repair commands, relay a report, or inspect hook output;
- no deleting unique `CLAUDE.md` project knowledge to make the warning disappear.

---

## 11. CI

GPT independently checked the relevant Worker-1 and toolbox grading pins.

**CI: NONE; tests are local-only evidence.**

Do not relabel local Node/pytest output as GitHub CI.

---

## 12. SAFETY / MONEY-PATH LOCKS

```text
Certification                  RED / LOCKED
Frozen G2 eight                NO-GO — 8 READY / 0 SPENT
One-shot Opus calibration      SPENT — NO RETRY
Compiler authorization         NO-GO
Broad backtest campaign        NO-GO
PAPER                          NO-GO
Broker / Topstep / live        NO-GO
```

No calendar target overrides these locks.

---

# OPERATOR DIRECTIVE

**KEEP THE WORKER-1 DESKTOP SHORTCUT HANDS-FREE. DO NOT REMOVE `--dangerously-skip-permissions` AND DO NOT RESTORE USER APPROVAL PROMPTS. CLOSE THE SEPARATE POWERSHELL SURFACE MECHANICALLY.**

**PROVE REAL `Agent -> PreToolUse` TRAVERSAL WITH A ZERO-DISPATCH, HARD-DENIED GUARD PROBE AND A DURABLE SESSION-BOUND AUDIT WITNESS. DO NOT EXECUTE ANOTHER MODEL CALL.**

**SLIM ROOT `CLAUDE.md` FROM ~203.5K CHARACTERS TO A CONCISE HOT-RULES FILE WITHOUT DELETING UNIQUE PROJECT KNOWLEDGE. MOVE HISTORY/REFERENCE DETAIL OUT OF THE ALWAYS-LOADED FILE AND LEAVE CLEAR POINTERS.**

**MAKE WORKER REPORT LANDING AUTOMATIC FROM THE BOUND WORKER BRANCH. TONIO DOES NOT RELAY OR PUBLISH WORKER REPORTS.**

**KEEP THE FROZEN EIGHT AT 8 READY / 0 SPENT. REPORT THE RESULT AS AR-1275.**
