# GPT EXTERNAL ADVISOR RULING — AR-1284A

## VERDICT

**AR-1284 PRE-FLIGHT STOP: PASS AS A SAFE STOP. THE WORKER CORRECTLY REFUSED TO START THE IRREVERSIBLE FROZEN-G2 SPEND. THE EIGHT FROZEN CONDITIONS REMAIN READY AND UNSPENT. AR-1283A'S ONE-SHOT G2 AUTHORIZATION IS NOW SUSPENDED AT THE EXECUTION BOUNDARY UNTIL THE DEDICATED G2 SEAT IS REPAIRED AND PROVEN.**

Worker head graded: `ee912092cdcc49c6f650f87461aaafa653aa7b88`.

Execution-start head: `96aefd4e9e82b2fe7a6d9c18877174d81f51bc7b`.

Prior GPT ruling: `81c9ca1c6ac29dd2721d11acd2297b7858adb158` (`AR-1283A`).

This is **not** a failure of the AR-1283 identity seam and it is **not** a failed G2 experiment. The model experiment never started. This is a control-plane executability/proof failure discovered before call 1.

## 1. INDEPENDENT REPOSITORY CHECK — THE STOP PRESERVED THE ONE-SHOT BUDGET

PASS.

Independent GitHub inspection confirms Worker head `ee912092...` is exactly one commit ahead of `96aefd4e...`, and the only changed files are:

```text
docs/replay-results/AR-1284-WORKER-PREFLIGHT-STOP-FROZEN-EIGHT-UNSPENT-2026-08-17.md
docs/replay-results/AR-1284-commit-message.txt
```

No queue, receipt, native-call manifest, guard manifest, settings, toolbox, extraction, certification, compiler, backtest, paper, broker, or live-money file changed in AR-1284.

The real frozen queue still contains exactly:

```text
queued unresolved = 8
excluded accepted = 4
max_attempts_per_condition = 1
attempts = {}
```

The real isolated receipt directory still contains only `README.md`.

Therefore:

```text
FROZEN G2 READY = 8
FROZEN G2 SPENT = 0
MODEL CALLS IN AR-1284 = 0
```

The worker did the right thing by stopping before call 1.

## 2. B-1 — LIVE `Agent -> PreToolUse` TRAVERSAL

### RULING: BLOCKER UPHELD, BUT WORD IT PRECISELY

This is a **proof gap**, not a proven fail-open implementation bug.

Repository inspection confirms all of the following:

1. `.claude/settings.json` registers `PreToolUse` for:

```text
Edit|Write|NotebookEdit|Bash|Agent|Task
```

2. The pinned `claude-hook-bridge.mjs` contains the G2 pre-call block for `Agent`/`Task` and fails closed if it is actually invoked.

3. The pinned runner also converts an internal `PreToolUse` exception into an explicit JSON `permissionDecision: deny`.

4. The Worker-1 doorway passes the pinned runner's decision through and independently fails closed when the runner cannot execute or returns no decision on a non-zero exit.

So the repository does **not** support the stronger claim "the Agent hook is known to fail open."

However, AR-1272 already established the decisive unresolved fact: one real `Agent` call was allowed, but that observation cannot distinguish:

```text
A. Agent -> PreToolUse fired and the guard allowed the benign call
B. Agent -> PreToolUse never fired and the model call bypassed the guard entirely
```

The guard computes `_audit` data but the runner deliberately removes `_audit` from visible output; no durable traversal witness exists.

That is enough to block these eight one-shot calls because **the trusted claim -> dispatch transition lives inside the PreToolUse guard itself**. If runtime traversal did not occur, the first real Opus call could leave no pre-call attempt/dispatch receipt at all. That uncertainty is unacceptable against an irreversible one-attempt budget.

Correct statement going forward:

```text
Agent -> PreToolUse implementation path = PRESENT and fail-closed if invoked
live Agent -> installed PreToolUse traversal = STILL NOT DISCRIMINATINGLY PROVEN
frozen-G2 consequence = BLOCK UNTIL PROVEN
```

Do not relabel this proof gap as a measured hook failure.

## 3. B-2 — DEDICATED STRICT G2 SESSION IS NOT ARMED

### RULING: CONFIRMED BLOCKER

The real Worker-1 guard manifest says:

```text
g2_precall.enabled = true
g2_precall.strict_session = false
```

and its own authority text says `strict_session=true` is reserved for the dedicated eight-call execution session.

The pinned `evaluateG2PreCall()` confirms why this matters:

```text
strict_session = true
-> EVERY Agent/Task dispatch is classified G2 and requires a valid permit

strict_session = false
-> a subagent payload that does not look G2 is classified benign and can pass
```

The exact intended frozen calls should be G2-shaped when constructed correctly because their description carries the permit marker and condition identity. Therefore `strict_session=false` is **not evidence that those exact eight frozen calls would bypass the guard**.

But AR-1284 is supposed to run as a reserved eight-call seat where no helper subagent call can accidentally escape the one-shot law. The current manifest does not satisfy that execution-session precondition.

The worker also correctly refused to flip it: the guard manifest is a `SELF_PROTECTED` control surface and the pinned lane law explicitly says self-protection is evaluated before packet scope and cannot be overridden by `.claude/` being an allowed prefix.

Therefore a bound Worker-1 seat may not self-arm its own strict execution law.

## 4. B-3 — EXACT FROZEN PROMPT DELIVERY IS NOT EXECUTABLE FROM THIS SEAT

### RULING: CONFIRMED BLOCKER

The native-call manifest does not contain the 25k-character prompt bytes. It contains the frozen identity:

```text
condition_ref
model = opus
subagent_type = general-purpose
permit_path
native_prompt_sha256
native_prompt_char_count
native_call_sha256
```

The guard then hash-matches the actual `Agent` tool input against that frozen call identity before performing the trusted claim -> dispatch transition.

That architecture is correct.

The execution path is not currently usable from this bound seat. `scripts/g2d_freeze_native_calls.py` is listed by the pinned lane law as a `SELF_PROTECTED` surface (`the freezer of the native-call execution identity`), and the Bash protected-surface fence deliberately denies **any** Bash command that references a self-protected surface, including read-only invocation.

Therefore the instruction "run `g2d_freeze_native_calls.py --emit-prompt` and paste the result into Agent" conflicts with the currently enforced seat boundary.

The worker was correct not to:

```text
hand-reconstruct ~26 KB prompts
use the unguarded PowerShell surface to route around the Bash fence
weaken the frozen hashes
edit native_call_manifest_t1.json
```

A byte transport mismatch would be denied by the existing pre-call hash gate, but deliberately relying on manual transcription is unnecessary engineering risk.

## 5. ADDITIONAL EXECUTION-SEAT GAP — `PowerShell`

AR-1272 reported that the live seat exposes a separate `PowerShell` tool while `.claude/settings.json` only registers:

```text
Edit|Write|NotebookEdit|Bash|Agent|Task
```

AR-1284 correctly did not exploit that gap.

For the dedicated G2 seat, this cannot remain merely a gentleman's agreement. A shell surface able to touch self-protected queue/receipt/manifest paths while sitting outside the hook matcher defeats the point of the protected-surface fence.

Before the frozen eight run, either:

```text
A. register and guard PowerShell with the same protected-surface/lane semantics as Bash
```

or

```text
B. make PowerShell unavailable in the dedicated G2 execution seat and prove that absence from the live tool registry
```

Do not solve B-3 by using PowerShell as a side door.

## 6. TEST / CI EVIDENCE

The AR-1284 packet is a preflight-stop packet, not an implementation packet.

GitHub exposes:

```text
combined status checks = none
workflow runs = none
```

for Worker head `ee912092...`.

The worker's preflight observations remain local-run evidence. The durable queue and receipt state have been independently confirmed from the repository.

## 7. STATUS OF AR-1283 / CERTIFICATION WORK

Nothing in AR-1284 reopens AR-1283A.

Still accepted:

```text
AR-1283 identity seam = PASS
known accepted current rows = 4
current accepted rows at Tier 1 = 0/4
current true Tier-3 residuals = 4/4
frozen unresolved route rows = 8
```

Still prohibited:

```text
Tier-3 semantic rater dispatch
compiler authorization
backtest execution
paper execution
broker / Topstep execution
live-money execution
```

The pre-existing system-map registry debt also remains parked off this money path.

# AR-1285 — AUTHORIZED: G2 EXECUTION-SEAT CLOSEOUT

## Actor

**A guard-repair / control-plane-authorized seat, NOT the currently bound Worker-1 seat granting itself permission.**

The existing bound Worker-1 may inspect and report but must not modify self-protected guard/toolbox/manifest/settings surfaces.

## Spend authority for AR-1285

```text
frozen G2 Opus calls = 0 authorized
Tier-3 calls         = 0 authorized
ordinary engineering subagents = 0 authorized
one dedicated live traversal calibration = conditionally authorized below
```

No frozen condition may be claimed, dispatched, or marked spent in AR-1285.

## A. Constitute the dedicated strict execution seat

Create/repair the dedicated G2 seat so the effective manifest used by its live hook has:

```text
g2_precall.enabled = true
g2_precall.strict_session = true
```

Do this through an authority capable of changing the self-protected control plane. Do not let bound Worker-1 self-modify the manifest that governs itself.

If the toolbox/manifest is deliberately re-pinned, preserve the existing law:

```text
one immutable toolbox pin
bundle hash covers the exact pinned files
manifest pin == activator pin
no copied second guard implementation
member diff recorded
```

## B. Close mutable-shell coverage before the dedicated run

Measure the live tool registry in the execution seat.

Every shell-like tool capable of writing the repository/control plane must either be hook-covered or unavailable.

At minimum, resolve the reported `PowerShell` gap. If it is present, its protected-surface behavior must discriminate:

```text
protected queue / receipt / manifest / guard path -> DENY
ordinary read-only non-protected command           -> allowed according to existing lane law
```

Do not widen the Bash fence by ad-hoc command spelling exceptions.

## C. Provide exact prompt bytes without weakening the frozen authority

Preferred fast/robust route:

1. Outside the bound G2 seat, while the frozen eight are still 0/8, use the existing canonical freezer/emitter to materialize **transport-only prompt artifacts** for the eight frozen conditions.
2. Each artifact must be regenerated from the already-authoritative frozen inputs, not hand-authored.
3. For every row require:

```text
sha256(materialized prompt bytes) == native_call_manifest_t1.json.native_prompt_sha256
character/byte contract agrees with the canonical emitter
condition_ref maps to exactly one prompt artifact
```

4. The existing self-protected `native_call_manifest_t1.json` remains the authority. The transport artifacts are not authorization and may not alter:

```text
queue_artifact_sha256
task_input_sha256
model
subagent_type
native_prompt_sha256
native_call_sha256
```

5. The real PreToolUse guard must still hash the actual `Agent` tool input and refuse if transport changed one byte.

Do **not** weaken the protected-surface fence merely to make `--emit-prompt` callable from the bound seat if a transport artifact removes that need.

## D. Close `Agent -> PreToolUse` with one discriminating live control

The old AR-1272 calibration is not sufficient because it was an ALLOWED call and therefore did not discriminate traversal.

After A-C are complete, authorize exactly **one** new control-plane calibration call with these properties:

```text
purpose: prove live Agent -> installed PreToolUse traversal
G2 relation: NONE
frozen queue condition: NONE
frozen permit: NONE
requested model: cheap non-Opus route (use Haiku if available in the live Agent schema)
strict_session: TRUE
prompt: trivial calibration-only text; no strategy/evidence work
expected result: PreToolUse DENY BEFORE model execution because strict session has no permit
```

This calibration has a bounded failure mode:

```text
if hook traversal works -> tool is denied; zero model call occurs
if hook traversal does NOT work -> at most the one explicitly authorized cheap calibration model call occurs; frozen G2 remains untouched
```

A returned model answer is therefore a **RED control**, not useful work. Discard it and STOP.

A valid PASS requires a discriminating witness that the native `Agent` invocation was denied by the installed G2 `PreToolUse` law before model execution. If the guard repair adds an append-only traversal audit, that audit may strengthen the proof, but do not treat an editable worker-authored log as authority merely because it says `DENY`.

No second calibration retry is authorized.

## E. Zero-model controls required alongside the live control

Before/with the live calibration, prove through the real pinned implementation that:

```text
strict session + Agent without permit                         -> DENY
missing/unreadable frozen queue                               -> DENY
missing/unreadable native-call manifest                       -> DENY
actual model omitted/inherited where explicit Opus required   -> DENY
wrong model                                                   -> DENY
wrong prompt / changed native-call hash                       -> DENY
already-spent/claimed condition                               -> DENY
outstanding uncaptured dispatch                               -> DENY
transition failure                                            -> DENY
valid frozen-shaped call with STUB transition                 -> ALLOW in pure control only; NO real model
protected PowerShell path (if PowerShell exists)              -> DENY
```

The allow control must inject/stub the transition. It may not create a real frozen `.attempt` or `.dispatch` receipt.

## F. Re-run the REAL frozen-queue preflight after all control-plane work

The terminal AR-1285 report must prove the real queue still says exactly:

```text
queued_count       = 8
excluded_count     = 4
claimed_refs       = []
unclaimed_refs     = all 8 frozen refs
crash_shaped_refs  = []
ready_for_dispatch = true
attempts           = {}
receipt directory  = README.md only
```

Any deviation means STOP.

## G. AR-1285 STOP / HANDOFF

**Even if AR-1285 is fully green, DO NOT SPEND THE FROZEN EIGHT YET.**

Return to GPT with:

```text
exact toolbox/control-plane commit(s)
exact manifest/settings changes
live tool-registry measurement
PowerShell disposition
prompt-artifact hashes vs existing native_prompt_sha256 rows
zero-model guard-control results
one live traversal calibration result
proof that calibration did not touch the frozen queue
final real-queue/receipt preflight
CI status separately from local tests
```

GPT will independently inspect those changes and then either:

```text
RELEASE AR-1284 frozen-eight execution again
```

or

```text
KEEP G2 FROZEN and name the remaining defect
```

## 8. WHY THIS IS THE FAST PATH

Do not redesign the extraction system, identity seam, certification assembler, or isolated law.

The money path is already waiting on exactly eight calls. The only remaining blocker discovered here is that the seat that would issue those calls has not yet mechanically earned the right to do so.

The shortest robust sequence is:

```text
AR-1284 safe stop PASS
-> AR-1285 execution-seat repair + one discriminating traversal control
-> GPT grade
-> frozen eight exactly once
-> rebuild 12-row route
-> GREEN + identity seam
-> Tier-1 measurement
-> only then decide Tier-3 spend
```

Do not turn this into a broad guard-platform project.

## OPERATOR DIRECTIVE

**ACCEPT AR-1284 AS A CORRECT SAFE STOP. DO NOT COUNT IT AS A FAILED G2 RUN; ZERO FROZEN ATTEMPTS WERE SPENT. SUSPEND THE AR-1283A FROZEN-EIGHT RELEASE AT THE EXECUTION BOUNDARY. B-1 IS AN UNRESOLVED LIVE-TRAVERSAL PROOF GAP, NOT A PROVEN FAIL-OPEN BUG; B-2 AND B-3 ARE REAL EXECUTABILITY BLOCKERS. AUTHORIZE AR-1285 ONLY: BUILD/REPAIR THE DEDICATED STRICT G2 SEAT THROUGH A CONTROL-PLANE-AUTHORIZED ACTOR, CLOSE OR REMOVE THE UNGUARDED POWERSHELL MUTATION SURFACE, MATERIALIZE HASH-VERIFIED TRANSPORT PROMPTS WITHOUT WEAKENING THE FROZEN MANIFEST, AND RUN EXACTLY ONE NON-G2 CHEAP-MODEL TRAVERSAL CALIBRATION THAT STRICT MODE MUST DENY BEFORE MODEL EXECUTION. KEEP THE FROZEN EIGHT AT 8 READY / 0 SPENT AND RETURN FOR GPT GRADING BEFORE ANY G2 OR TIER-3 CALL.**