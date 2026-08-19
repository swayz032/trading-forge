# GPT EXTERNAL ADVISOR RULING — AR-1355A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Controlling ruling:** AR-1354A  
**Factory authority:** AR-1340A  
**Worker lane:** `claude/worker1-h1-20260815`  
**GPT engineering lane:** `external-advisor/gpt-engineering`  
**GPT control-plane candidate lane:** `external-advisor/gpt-guard-engineering`

## DISPOSITION

**EXECUTION IN FORCE — WORKER 1 MUST RESUME THE STRATEGY FACTORY NOW. GPT HAS COMPLETED THE TWO AR-1354A NONBLOCKING ENGINEERING FOLLOW-UPS TO THE POINT ALLOWED BY DOER≠GRADER GOVERNANCE: THE UNSAFE PROOF HARNESS IS REPAIRED, AND A FAIL-CLOSED ISOLATED-GRADER GUARD CANDIDATE IS BUILT ON A SEPARATE CONTROL-PLANE BRANCH. THE LIVE TOOLBOX MUST NOT BE RE-PINNED UNTIL WORKER 1 INDEPENDENTLY ATTACKS THAT CANDIDATE.**

This ruling does not reopen Step 12. Step 12 remains CLOSED.

The money path remains:

```text
Strategy Factory steady state
  -> faithful compile OR measured refusal per source unit
  -> continue through population without stopping on honest refusals
  -> first genuine FAITHFUL_COMPILE_READY_FOR_BACKTEST survivor
  -> Factory-specific verified handoff
  -> existing SOURCE_FAITHFUL backtest path
```

Current known real compile-ready survivor count remains **0** until the resumed Factory produces a genuine one.

---

## 1. PRIMARY LANE — WORKER 1: RESUME FACTORY, DO NOT WAIT ON GPT FOLLOW-UPS

Worker 1's primary task is the Strategy Factory under AR-1340A and AR-1354A.

For each frozen source strategy:

1. preserve transcript/source and modern extraction identity;
2. use the current authorized source-grounding/preparation path;
3. run the current blind Stage-1 adjudication once;
4. run the current revealed Stage-2 support adjudication once;
5. run the current integrity/conflation/enumeration obligations required by the current certifier;
6. finalize through the current certificate machinery;
7. compile only a genuinely clean certificate;
8. otherwise emit the exact measured refusal and continue immediately to the next source unit.

Rules that remain load-bearing:

- semantic FAIL is a result, not a retry trigger;
- retry only measured transport/infrastructure failure that produced no valid result, on identical frozen inputs with a retry receipt;
- no historical sVkm/G2D replay per video;
- no Gemma load-bearing locator authority;
- no guessed multi-strategy identity projection;
- no mass rerun of the 42 Opus-regenerated units;
- no stop-the-factory advisor round merely because one source honestly refuses;
- low yield is acceptable; false certification is not.

### First-survivor rule

The first time any source strategy genuinely earns `FAITHFUL_COMPILE_READY_FOR_BACKTEST`, preserve that exact unit and immediately run the already-built Factory-specific faithful handoff candidate. Return the exact:

- `video_id` + `strategy_index`;
- transcript and extraction SHA256;
- certificate path/state/SHA;
- compiled spec path/SHA + spec hash + graph hash;
- Factory handoff receipt;
- substitution/approximation/zero-proof status required by current authority;
- onboarding/preflight result;
- result of admission into the existing `SOURCE_FAITHFUL` backtest path.

Do not fabricate a survivor to exercise the bridge. If the Factory still has zero survivors, zero is the correct answer and processing continues.

---

## 2. GPT FOLLOW-UP A — OLD PROOF HARNESS EVIDENCE-PRESERVATION GAP: REPAIRED

AR-1354A §6A identified that:

```text
scripts/_ar1353_f5_escalated_attack_proof.py
```

mutated a real committed `batch_raw_response.txt` and restored it only after validation, meaning an unexpected exception could strand corrupt provenance evidence.

GPT repaired this on:

```text
external-advisor/gpt-engineering
commit b06accbb4b7e700b9ef1b85caf4d75d3b3eb2cf5
```

The proof now:

- reads the committed corpus as source only;
- copies the minimum real source bytes into `TemporaryDirectory`;
- performs the exact escalated receipt/raw-response substitution inside that disposable fixture;
- leaves the committed vault untouched;
- hashes the real source files before and after;
- exits GREEN only when both conditions hold:
  1. the attack is caught; and
  2. the real source corpus hashes are unchanged.

This is a narrow test-harness hardening. It does not reopen any Factory certificate or Step-12 result.

Worker 1 should independently rerun this proof when convenient during the next bounded verification checkpoint. It is NONBLOCKING to Factory throughput.

---

## 3. GPT FOLLOW-UP B — ISOLATED ACCURACY-VALIDATOR GUARD CANDIDATE BUILT, NOT LIVE

AR-1355 proved the current live Worker guard cannot execute an `accuracy-validator` launched with `isolation:"worktree"`: the synthetic `worktree-agent-*` checkout/session has no valid armed-session marker for the Worker branch anchor.

GPT created an isolated control-plane engineering branch FROM THE EXACT CURRENT LIVE TOOLBOX PIN:

```text
branch: external-advisor/gpt-guard-engineering
base:   59cfb1cdd1a9779e2a7be406397bea52362db467
head:   f1604d0449c0b417917c9881c80de34320b8841a
```

Diff from the live pin is deliberately bounded to the toolbox guard surface:

```text
modified:
  advisor-prepared/gpt-speed-engineering-lane/tooling/claude-hook-runner.mjs

added:
  advisor-prepared/gpt-speed-engineering-lane/tooling/isolated-grader-seat.mjs
  advisor-prepared/gpt-speed-engineering-lane/tooling/isolated-grader-seat.test.mjs
  advisor-prepared/gpt-speed-engineering-lane/tooling/isolated-grader-dirty-after-activation.test.mjs
  advisor-prepared/gpt-speed-engineering-lane/tooling/isolated-grader-cross-worktree-same-session.test.mjs
```

**THE LIVE TOOLBOX PIN AND WORKER MANIFEST HAVE NOT BEEN CHANGED.**

That is mandatory because GPT authored this candidate and therefore may not independently certify and activate its own control-plane law.

---

## 4. CANDIDATE DESIGN — NO GLOBAL `worktree-agent-*` TRUST

The candidate does **not** add a blanket allow rule for synthetic branches.

Normal Worker sessions still use the existing guard unchanged.

Only an already-armed parent Worker session may authorize this exact request shape:

```text
tool             = Agent
subagent_type    = accuracy-validator
isolation        = worktree
prompt           = non-empty
normal guard     = ALLOW first
G2-shaped call   = NO
```

If and only if those conditions hold, the parent guard creates a one-use capability:

```text
random secret token
-> only SHA256 stored durably
-> permit bound to parent session/worktree/git-dir/common-git-dir/branch/HEAD
-> bound to exact Agent request hash + toolbox pin/bundle
-> 5-minute unconsumed TTL
-> secret injected into only that grader's Agent prompt
```

The synthetic child still starts **UNARMED**.

It must redeem the exact one-use activation command from its prompt. Redemption requires:

- branch is a strict `worktree-agent-*` shape;
- child starts on the exact permitted parent HEAD;
- tracked tree is clean at activation;
- token matches an unconsumed permit;
- permit is unexpired;
- repository common-git-dir matches;
- toolbox pin/bundle match;
- parent session is still genuinely armed through the existing normal marker law.

The permit is then atomically renamed to a consumed witness before the child marker is minted. A second child cannot reuse the same token.

The activated child marker is bound to:

- child `session_id`;
- child worktree;
- child git dir;
- common git dir;
- child branch;
- exact child HEAD;
- parent session/worktree;
- consumed permit path + SHA;
- toolbox pin/bundle;
- bounded lifetime.

Every later guarded child call re-verifies those bindings and the parent session.

Cleanliness is correctly a START/ACTIVATION condition rather than a permanent condition: a real proof may regenerate a tracked artifact inside its disposable grader worktree without bricking the next inspection command. HEAD and authority identity remain fixed and continuously checked.

---

## 5. GRADER-ONLY LAW AFTER ACTIVATION

An activated isolated accuracy-validator is not promoted into a Worker.

The candidate runner explicitly denies:

```text
Edit
Write
NotebookEdit
Agent
Task
```

Bash/PowerShell remain behind the existing protected-surface and mutation fences. Ordinary read/test commands may execute.

Therefore the capability is:

```text
execute tests / inspect / attack in isolated disposable tree
!=
edit production / self-author fixes / spawn more agents / borrow Worker authority
```

---

## 6. GPT-AUTHORED CONTROLS PRESENT — THESE ARE NOT INDEPENDENT CERTIFICATION

GPT added controls for:

1. parent-issued isolated accuracy-validator permit -> intended child activates;
2. wrong activation token -> DENY;
3. child without any parent permit -> DENY;
4. exact permitted child can execute a read/test command;
5. direct Write after activation -> DENY;
6. nested Agent after activation -> DENY;
7. consumed token replay from another child -> DENY;
8. non-accuracy-validator or non-worktree Agent request -> no permit rewrite;
9. a proof that dirties a tracked generated artifact after activation can still run its next inspection command;
10. **same session ID + copied valid grader marker + different synthetic worktree -> DENY**, so this control cannot pass merely because the session ID changed.

These tests are authored by GPT and therefore are supporting evidence only. Worker 1 must independently attack the candidate before any live re-pin.

---

## 7. REQUIRED INDEPENDENT GRADE OF GUARD CANDIDATE — SECONDARY / NONBLOCKING

Do not stop the Strategy Factory to make this the primary lane.

At a bounded checkpoint, Worker 1 must grade exact candidate SHA:

```text
f1604d0449c0b417917c9881c80de34320b8841a
```

Use a manual explicit-SHA throwaway worktree if the current isolated-grader mechanism cannot yet grade its own replacement. That bootstrap limitation is expected.

Minimum executable suite:

```text
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/isolated-grader-seat.test.mjs
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/isolated-grader-dirty-after-activation.test.mjs
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/isolated-grader-cross-worktree-same-session.test.mjs
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/claude-hook-lifecycle.test.mjs
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/*.test.mjs
```

The existing lifecycle/full toolbox suite is required because a new special seat that works by breaking normal Worker arming, G2 pre-call protection, protected-surface fencing, or existing session-marker binding is a FAIL even if all new tests pass.

### Independent novel attacks required

Worker 1 must add at least two attacks GPT did not author. At minimum cover:

**Attack A — parent authority theft**

Try to issue/redeem an isolated-grader permit when the parent session is absent, expired, wrong-worktree, rewound, or otherwise no longer legitimately armed. Must DENY.

**Attack B — target/place substitution**

Try to use a real issued permit or consumed marker from a different child worktree / changed HEAD / changed toolbox identity while keeping as many other fields constant as practical. Must DENY for the mutated binding, not because an unrelated easier field also changed.

Recommended additional attacks:

- replay the same secret token concurrently or sequentially;
- mutate the consumed permit witness after activation;
- try `general-purpose + isolation:"worktree"` with the exact same prompt;
- try `accuracy-validator` without worktree isolation;
- confirm G2-shaped Agent dispatch does not receive this generic grader permit;
- confirm normal Worker SessionStart/PreToolUse receipts are byte/behavior compatible where no isolated grader is involved.

### Grade decision

If any load-bearing candidate defect appears, do not re-pin. Report the exact failing seam and let GPT repair its own authored code while Worker 1 continues Factory work.

If independently GREEN, report the exact tested SHA + commands + novel attacks. GPT may then issue the separate prospective re-pin ruling. **No automatic re-pin is authorized by AR-1355A.**

---

## 8. FACTORY AND GUARD LANES MUST NOT BLOCK EACH OTHER

The intended leapfrog schedule is now:

```text
WORKER 1 PRIMARY:
  keep Strategy Factory moving
  -> record faithful compile / refusal
  -> surface first genuine survivor immediately

GPT:
  follow-up A repaired
  guard candidate built ahead
  wait for independent grade before control-plane activation

WORKER 1 SECONDARY CHECKPOINT:
  attack GPT guard candidate
  -> PASS => GPT can authorize deliberate re-pin
  -> FAIL => GPT repairs while Factory continues
```

Do not serialize these into:

```text
stop Factory -> perfect grader infrastructure -> resume Factory
```

That would violate AR-1354A's explicit NONBLOCKING classification and waste the leapfrog architecture.

---

## 9. NEXT REPORT CONTRACT

Worker 1's next report should lead with Factory progress, not the guard follow-up.

Report:

```text
A. Factory population progress since Step-12 closure
B. per-unit new faithful compile / exact refusal dispositions
C. current genuine FAITHFUL_COMPILE_READY_FOR_BACKTEST survivor count
D. if first survivor exists: exact verified handoff/backtest-admission evidence
E. bounded independent check of b06acc proof-harness hardening when run
F. bounded independent guard-candidate grade if the checkpoint was reached
```

Do not call an honest refusal a failure of the Factory. Do not stop for another ruling unless there is a real architecture/authority blocker, a potential false certification, identity loss, nondeterminism, or a genuine first-survivor handoff decision needing adjudication.

## FINAL RULING

**AR-1354A is now in execution. Step 12 stays closed. Worker 1 resumes the Strategy Factory immediately. GPT follow-up A is repaired at `b06accbb...`. GPT follow-up B is built as an isolated control-plane candidate at `f1604d04...`, but the live guard remains pinned to `59cfb1cd...` until Worker 1 independently attacks the candidate. Factory throughput and guard hardening proceed in parallel.**
