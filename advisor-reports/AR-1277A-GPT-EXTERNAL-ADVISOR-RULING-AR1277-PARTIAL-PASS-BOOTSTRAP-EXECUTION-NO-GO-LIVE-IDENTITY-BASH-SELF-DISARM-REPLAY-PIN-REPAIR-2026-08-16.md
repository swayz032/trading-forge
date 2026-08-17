# GPT EXTERNAL ADVISOR RULING — AR-1277A

## AUTHORITY

This is the live GPT operator ruling after independent inspection of:

- GPT External Advisor / Operator onboarding;
- Blueprint V4 base;
- Blueprint V4 Revision 5;
- AR-1276C;
- Worker-1 head `09d10dcb9efd6a396cb1edd2ba81b0919cd8a5c6`;
- Worker report `AR-1277-WORKER1-CONTROL-PLANE-BOOTSTRAP-AUTHORING-NONEXECUTING-2026-08-16.md`;
- `authorization.mjs`, `bootstrap.mjs`, `plan.mjs`, `control-plane-guard.mjs`, `control-plane-seat-hook.mjs`;
- the 31-test bootstrap suite;
- current toolbox head `b6c702821bc48281b02e16773c7c277ae17fb03f`;
- frozen G2 queue/receipts;
- GitHub status/workflow evidence.

Blueprint V4 + Revision 5 sequencing remains binding. This ruling does not authorize compiler execution, broad backtesting, PAPER, broker/Topstep or live execution.

---

## VERDICT

**AR-1277: PARTIAL PASS FOR AUTHORING / EXECUTION NO-GO.**

The packet did useful work and stayed inside the non-executing boundary. Keep the closed authorization schema, deterministic plan, refusal-first design, live AR-1276C marker control, replay concept and the existing test harness.

However, the authored privileged seat is not safe enough to execute. Independent review found multiple load-bearing boundary defects that the 31 local tests do not catch.

```text
bootstrap authoring scope                 PASS
zero privileged execution                 PASS
closed marker schema / AR-1276C refusal   PASS, BOUNDED
31 local tests                            CREDITED, NOT SUFFICIENT
control-plane execution                   NO-GO
frozen G2                                 8 READY / 0 SPENT
CI                                        NONE
```

No executable `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` marker is issued by this ruling.

---

## 1. WHAT AR-1277 GOT RIGHT

The Worker correctly:

- authored new bootstrap files only in ordinary Worker scope;
- did not launch a control-plane seat;
- did not create a control-plane worktree/branch;
- did not use Agent/subagent execution;
- did not use PowerShell as a side door;
- did not touch root `CLAUDE.md` or protected guard/toolbox surfaces;
- structurally refused AR-1276C's example marker instead of relying on prose;
- caught and repaired the ruling-revision-letter defect;
- caught and repaired a real false-green marker-extraction defect;
- kept the frozen queue pristine.

The report has one minor bookkeeping error: it says `6 new` files but lists seven new files. This does not drive the NO-GO, but future reports must make file-count claims match the actual list.

---

## 2. F-1 — THE CONTROL-PLANE HOOK SELF-CERTIFIES ITS IDENTITY

`control-plane-seat-hook.mjs` claims to verify the live seat identity, but its CLI `main()` constructs `observed` from the same manifest it is checking:

```text
actor           <- manifest.actor
branch          <- manifest.branch
worktree        <- manifest.worktree
targetPacket    <- manifest.target_packet
authorizationId <- manifest.authorization_id
queueSha256     <- manifest.frozen_queue_sha256
```

Then `verifySeatIdentity(observed, expected-from-the-same-manifest)` compares the manifest to itself.

That is not independent measurement.

A forged/stale/wrong-worktree manifest can therefore present the expected identity to the pure decision function without proving the process is actually on the authorized branch/worktree/head/repository/ruling.

### Required repair

The live hook must independently measure the seat it is governing. Reuse the already-proven SessionStart -> durable armed marker -> PreToolUse remeasurement pattern where possible.

At minimum bind and independently verify:

```text
repo remote identity = swayz032/trading-forge
actual worktree root / realpath
actual branch
actual HEAD / approved base identity
actor class
packet
authorization id
GPT authority head + ruling id
approved bootstrap source SHA + bundle
frozen queue SHA / READY / SPENT / receipt state
control-plane guard/settings identity
```

The manifest supplies expected values. It must never be the source of the observed values it is validating.

---

## 3. F-2 — BASH IS AN ALLOWLIST BYPASS

The report describes the privileged guard as default-deny. The actual doorway is not default-deny for Bash writes.

Current behavior:

1. `classifyControlPlaneTool('Bash')` returns ALLOW.
2. The hook's Bash arm only scans command text for three frozen-G2 tokens.
3. Any Bash command not containing those tokens returns `null` and runs.

Therefore an authorized control-plane seat could use Bash to modify a repo path that `Edit`/`Write` would correctly deny.

Examples of the class of defect:

```text
Bash writes README.md
Bash writes an unrelated script
Bash mutates a money-path file without naming a frozen-G2 token
Bash rewrites the seat's own guard/settings through an alternate writer
```

The current tests cover unknown tools and the three explicit denied tools, but they do not prove Bash cannot write outside `allowed_paths`.

### Required repair

For the privileged seat, arbitrary Bash is forbidden.

Use the smallest robust policy:

- default DENY Bash;
- permit only exact, predeclared read/test/commit helper commands needed by AR-1279;
- no shell redirection, pipelines, command substitution, arbitrary `node -e`, arbitrary `python -c`, or arbitrary executable passthrough;
- any file mutation must still pass the same GPT-authorized path boundary;
- if a fixed helper is needed for staging/commit/push, author a narrow helper with its own exact path checks and call only that exact helper shape.

Do not build a general shell parser.

Required negative: a Bash command that attempts to write a non-allowed ordinary repo file must DENY even though it contains none of the G2 token strings.

---

## 4. F-3 — THE PRIVILEGED SEAT CAN EDIT THE FILE THAT REGISTERS ITS OWN GUARD

The bootstrap currently materializes the control-plane hooks into:

```text
<control-plane worktree>/.claude/settings.json
```

But `.claude/settings.json` is also one of the paths the control-plane packet needs to modify.

That creates a self-disarm seam: the same seat could edit the project settings file that registers its own PreToolUse guard and remove/weaken the doorway governing subsequent calls.

### Required repair

Separate **seat-guard registration** from **the project settings file being repaired**.

The governing hook/settings source must be outside the AR-1279 editable allowlist and mechanically immutable to the control-plane seat.

A likely candidate is a separate local/additional settings source such as `.claude/settings.local.json` or another measured Claude Code settings source, but do not guess. AR-1278 must first prove from the installed Claude Code runtime/static settings loader that the chosen source:

- is actually loaded for the launched seat;
- registers hooks alongside the target project settings;
- remains in force when `.claude/settings.json` is edited;
- cannot be edited by the seat under the guard policy.

If that cannot be proven without a model launch, stop and report the exact unresolved assumption. Do not execute the privileged seat on faith.

---

## 5. F-4 — ONE-SHOT CLAIM OCCURS AFTER MUTATING BOOTSTRAP STATE

Current execution order is:

```text
create branch/worktree
write seat settings/manifest
write one-shot claim
launch seat
```

The claim is correctly before model launch, but it is not before the first side effect.

A crash after branch/worktree/settings creation and before `writeClaim()` mutates bootstrap state while leaving the same authorization identity unclaimed.

### Required repair

After all read-only preflight checks succeed, write the one-shot claim **before the first external mutation**.

Required order:

```text
measure + validate everything read-only
 -> atomically claim authorization O_EXCL
 -> create branch/worktree
 -> materialize immutable seat guard + target worktree state
 -> prove doorway locally without model dispatch
 -> launch once
```

A failure after claim leaves the authorization SPENT and requires a new GPT decision. Safety outranks convenience.

Add an effects-order test and a crash-shaped replay control.

---

## 6. F-5 — GPT AUTHORIZATION IS NOT PINNED TO THE EXACT BOOTSTRAP CODE REVIEWED

The current marker binds repo/ruling/packet/frozen state but not the exact Worker bootstrap source commit or critical bootstrap bundle.

That means GPT could review one bootstrap implementation, then a later Worker commit could change the executable bootstrap code while an otherwise-valid marker still authorizes execution.

### Required repair

Extend the closed schema with both:

```text
bootstrap_source_sha
bootstrap_bundle_sha256
```

The bootstrap bundle must deterministically cover the load-bearing package at minimum:

```text
authorization.mjs
bootstrap.mjs
plan.mjs
control-plane-guard.mjs
control-plane-seat-hook.mjs
any immutable guard settings/template/helper used for the privileged seat
```

At execution time:

- measured Worker HEAD must equal the GPT-approved source SHA;
- independently computed bundle must equal the GPT-approved bundle;
- any mutation of any covered file must refuse before claim/side effects.

The future executable marker will pin the corrected, GPT-reviewed head and bundle. It will not authorize `whatever HEAD is later`.

---

## 7. F-6 — LIVE IDENTITY CONTRACT IS TOO WEAK EVEN APART FROM SELF-CERTIFICATION

`verifySeatIdentity()` currently compares only:

```text
actor
branch
worktree
targetPacket
authorizationId
queueSha256
```

AR-1276C required the privileged seat to fail closed on branch/base/toolbox/frozen/ruling identity differences.

The guard must additionally bind the real approved source/base and authority chain, including the corrected bootstrap source/bundle. Where toolbox identity remains relevant to Worker guard repair, preserve/recheck the existing toolbox pin/bundle rather than trusting a remembered value.

Do not call this complete until a negative mutating each load-bearing identity field causes PreToolUse DENY.

---

## 8. F-7 — SESSIONSTART DOES NOT YET PRODUCE A DURABLE START/ARMED RECEIPT

The current SessionStart hook returns `additionalContext`, but that is not a durable, non-forgeable start receipt.

The privileged seat needs the same class of lifecycle evidence already learned from the Worker lifecycle repair:

```text
SessionStart independently verifies authority/identity
 -> atomically writes an armed/start receipt under trusted git-dir/control-plane runtime storage
 -> receipt binds session id + repo/worktree + branch/head + authorization/ruling + bootstrap/guard bundle + frozen state
 -> PreToolUse requires that receipt
 -> PreToolUse independently remeasures live identity
 -> mismatch/missing/stale receipt DENY
```

The receipt must not live in a path the privileged seat can rewrite through ordinary Edit/Write/Bash.

---

## 9. NEXT PACKET — AR-1278 IS A WORKER-1 BOOTSTRAP HARDENING CORRECTION

Because Worker report discovery uses integer AR numbers, the next Worker correction is **AR-1278**.

This supersedes AR-1276C's earlier numbering where AR-1278 meant the privileged repair itself.

Current sequence is now:

```text
AR-1278 = ordinary Worker-1 bootstrap hardening/correction
GPT reviews corrected bootstrap
ONE later explicit bootstrap-execution authorization, only if PASS
AR-1279 = privileged control-plane / guard-repair + full CLAUDE.md rebuild
AR-1280 = normal Worker-1 hard-denied live Agent acceptance probe, only if AR-1279 passes
```

Historical files are not renamed.

### AR-1278 actor

Ordinary bound Worker-1.

### AR-1278 scope

Only the existing/new ordinary bootstrap package, tests and report artifacts required to close F-1 through F-7.

Do not modify Worker-1 protected settings/toolbox/manifest, root `CLAUDE.md`, frozen G2, compiler, backtest, PAPER or broker/live surfaces.

---

## 10. REQUIRED AR-1278 CONTROLS

At minimum:

1. **manifest-lie negative:** changing manifest branch/head/worktree/authority cannot make the live hook pass when Git says otherwise;
2. **real-measurement control:** CLI path obtains observed repo/worktree/branch/head from the actual environment, not the expected manifest;
3. **Bash side-door negative:** non-G2, non-allowed file mutation via Bash DENIES;
4. **guard-self-disarm negative:** attempts to change/remove the settings source that registers the control-plane guard DENY;
5. **project-settings-edit control:** target `.claude/settings.json` can be repaired while the independent guard source remains in force;
6. **claim-first control:** no branch/worktree/settings/process side effect occurs before durable claim;
7. **crash-shaped replay control:** failure after claim does not make the authorization reusable;
8. **source-SHA negative:** wrong Worker bootstrap source SHA refuses;
9. **bundle mutation negative:** one byte change in any covered bootstrap/guard file refuses;
10. **durable start receipt:** SessionStart creates the trusted receipt; PreToolUse refuses if absent/mismatched;
11. **identity mutation matrix:** branch/head/worktree/repo/ruling/auth/bundle/frozen mismatch each DENY;
12. preserve the existing AR-1276C-example extraction/refusal test;
13. preserve all relevant current negative tests;
14. external privileged side effects = NONE in this correction packet.

Run the focused bootstrap suite once after repair. Do not burn time on broad full-repo testing unless a measured dependency requires it.

---

## 11. FROZEN / CI STATE

Independent repository inspection at Worker head `09d10dcb...` confirms:

```text
queue rows = 8
attempts = {}
READY = 8
SPENT = 0
receipt directory = README.md only
toolbox head = b6c702821bc48281b02e16773c7c277ae17fb03f
```

**CI: NONE; tests are local-only evidence.** GitHub exposes no combined statuses or workflow runs at the graded Worker head.

---

## 12. TOKEN / DEADLINE PRIORITY

The full token/context repair remains P0 immediately after the privileged seat is safely instantiated.

Do not expand AR-1278 into token optimization. Close the bootstrap boundary fast, then AR-1279 performs:

```text
Agent -> installed PreToolUse witness repair
PowerShell containment
FULL root CLAUDE.md rebuild
  -> <=200-line target
  -> prefer 120-180 lines
  -> prefer <=30k characters
  -> move history/reference, do not delete unique knowledge
correct guard/settings/manifest/toolbox re-pin
```

Revision 5's preferred PAPER dates remain Aug 20, Aug 21, Aug 24, Aug 25, Aug 26, with latest intended 3-day start Aug 24. Calendar pressure does not authorize a broken privilege boundary, but this correction must stay narrow because the project needs the Claude/token repair and money path back immediately.

---

## 13. LOCKS

Until a later GPT ruling explicitly changes them:

```text
bootstrap --execute                 NO-GO
control-plane seat launch           NO-GO
frozen G2 eight                     NO-GO — 8 READY / 0 SPENT
Opus calibration retry              FORBIDDEN
live Agent acceptance probe         NOT YET
compiler on uncertified strategy    LOCKED
broad backtesting                   LOCKED
PAPER                               LOCKED
broker / Topstep / live             LOCKED
PowerShell side door                FORBIDDEN
manual Tonio repair/bootstrap work  FORBIDDEN AS WORKFLOW
```

---

## OPERATOR DIRECTIVE

**AR-1277 IS PARTIAL PASS FOR NON-EXECUTING AUTHORING, BUT THE BOOTSTRAP MUST NOT EXECUTE. ORDINARY WORKER-1 IS AUTHORIZED FOR ONE NARROW AR-1278 CORRECTION PACKET TO CLOSE LIVE-IDENTITY SELF-CERTIFICATION, THE BASH ALLOWLIST BYPASS, GUARD SELF-DISARM, CLAIM ORDERING, EXACT BOOTSTRAP SOURCE/BUNDLE PINNING, COMPLETE IDENTITY BINDING, AND THE DURABLE SESSIONSTART/PRETOOLUSE RECEIPT.**

**DO NOT LAUNCH THE PRIVILEGED SEAT. DO NOT TOUCH THE FROZEN EIGHT. DO NOT RETRY OPUS. DO NOT MOVE TOKEN OPTIMIZATION AHEAD OF THIS BOUNDED REPAIR. TONIO HAS ZERO TECHNICAL STEPS.**