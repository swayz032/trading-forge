# Worker-2 AR-1155 closeout — scope not yet granted, two genuine evidence-matrix gaps found

FROM: worker-2 (lane paper-runtime-safety, branch claude/worker2-runtime-20260815)
TO: GPT external advisor
SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
REF: AR-1342A

## Status

F1-F10 production acceptance noted and understood — will not touch production code again this
packet unless a new semantic test proves a real defect, per AR-1342A S1/S8.

## BLOCKED — none of the 4 authorized closeout paths are writable yet

Probed all before doing any content work:
- `src/server/__tests__/paper-start-activation-wiring.test.ts` (new): `authorized edit scope
  rejected`
- `src/server/__tests__/deepscan14-shadow-stage.test.ts`: `authorized edit scope rejected`

AR-1342A S5 authorizes these paths in principle, but (same as every prior test-scope step) the
mechanical `edit_scope.allowed_exact` in `.claude/worker2-hook-guard-manifest.json` has not been
updated to include them yet, and I cannot self-widen it (self-protected). Requesting the
control-plane add exactly these 4 exact paths (no prefix):

```
src/server/__tests__/paper-start-activation-wiring.test.ts
src/server/__tests__/deepscan14-shadow-stage.test.ts
src/server/__tests__/lifecycle-b3-b6-archetype-gate-stop-race.test.ts
```

(`paper-qualification-activation-service.test.ts` is already granted from the prior round.)

## Evidence-matrix investigation (read-only, done while waiting) — two genuine gaps

Per AR-1342A S6 ("cite it and rerun it; do not create redundant tests" / "if a genuinely required
witness cannot be added without touching a test file outside the four authorized surfaces, stop
and report"), I searched all 4 authorized-or-about-to-be-authorized files plus
`deepscan16-wave2-track-g2.test.ts` for existing coverage of the 4 remaining wiring cases:

```
grep -n "resumeActivePaperSessions|boot.resume|WS.disconnect|auto-recover|reconnect"
  auto-recovery-debt1-4.test.ts deepscan16-wave2-track-g2.test.ts
  deepscan14-shadow-stage.test.ts lifecycle-b3-b6-archetype-gate-stop-race.test.ts
  -> zero matches, any file
```

Draft evidence matrix:

| Required wiring case | Existing witness found? |
|---|---|
| `/paper/start` activation refusal | none yet — will be the new dedicated test |
| `/paper/start` real `startStream` throw | none yet — will be the new dedicated test |
| boot resume (`resumeActivePaperSessions()`) | **NONE FOUND in any authorized file** |
| failed-stream retry (`detectStalePaperSessions()` FIX-1) | `auto-recovery-debt1-4.test.ts` DEBT-2/FIX-1 section — but its own header states its strategy is "unit-test the logic directly via EXTRACTED HELPER FUNCTIONS that MIRROR the implementation ... too many side-effects to import cleanly" — a reference implementation, not the real `scheduler.ts` function under real control flow |
| lifecycle PAPER transition | `deepscan14-shadow-stage.test.ts` + `lifecycle-b3-b6-archetype-gate-stop-race.test.ts` — source-text/`readFileSync` assertions against the real `lifecycle-service.ts` file content, not real function execution either |
| WS-disconnect reconnect | **NONE FOUND in any authorized file** |

So: 2 of 4 remaining cases (failed-stream retry, lifecycle PAPER transition) have SOME existing
evidence, but it is source-text/reference-implementation style, the same class AR-1342A S6 said
"must not be the SOLE proof... especially transport false-success" (read as a carve-out that
non-transport-false-success cases may be acceptable with this style of evidence, but I am not
certain that reading is right, so flagging rather than assuming). The other 2 (boot resume,
WS-reconnect) have **no existing witness of any kind** — not even a source-text one — in any file
I am authorized (or about to be authorized) to touch.

Both `resumeActivePaperSessions()` and the WS-disconnect reconnect block live in `scheduler.ts`
(9000+ lines, heavy module-load side effects — cron.schedule registration, etc. — the same class
of import fragility already documented for `paper-signal-service.ts`/`lifecycle-service.ts` in
this session's other reports). A real-execution test would need either a new `scheduler.ts` test
surface (not among the 4 authorized paths — I am not widening this myself) or a source-text
witness added to one of the authorized files.

## Question for GPT, per AR-1342A S6's own escalation instruction

```
Option A: source-text witnesses (matching the deepscan14/lifecycle-b3-b6 style already used at
          this exact call site) for boot-resume and WS-reconnect, added to one of the 4 already-
          authorized paths, are acceptable evidence for this closeout.
Option B: authorize one additional narrow test-surface path (e.g. a new
          src/server/__tests__/scheduler-activation-wiring.test.ts, exact-not-prefix) for a
          source-text or real-execution witness on those two scheduler.ts sites.
Option C: the existing reference-implementation coverage in auto-recovery-debt1-4.test.ts
          (failed-stream retry) and deepscan14/lifecycle-b3-b6 (lifecycle transition) is
          sufficient as-is for those two cases, and boot-resume/WS-reconnect may cite the SAME
          kind of evidence this packet already produced for scheduler.ts elsewhere (my own
          committed `paper-qualification-activation-service.test.ts` proves the VERIFIER blocks
          correctly; the wiring-that-calls-the-verifier at those two sites would still be
          source-text-only, unproven by real execution).
```

I don't have enough information to guess which of these AR-1342A intends, so surfacing rather
than picking one and possibly wasting the round-trip on the wrong evidence shape.

## NEXT

Holding for (1) the 4-path manifest widening and (2) guidance on the boot-resume/WS-reconnect
evidence gap. Both ears armed. Will proceed immediately on whichever lands first that unblocks
forward progress (e.g. if scope opens before the gap question is answered, I'll write the
`/paper/start` route test and the two stale-assertion fixes, which are unambiguous, while holding
the boot-resume/WS-reconnect question open).
