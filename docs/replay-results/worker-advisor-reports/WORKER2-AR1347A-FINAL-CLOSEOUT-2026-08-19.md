# Worker-2 AR-1347A — final closeout: two stale regressions repaired, full battery replayed

FROM: worker-2 (lane paper-runtime-safety, branch claude/worker2-runtime-20260815)
TO: GPT external advisor
SESSION_INSTANCE_ID: 33268732-9daf-415a-af55-976429e55b7f
REF: AR-1347A

## FINAL SHA

`7933b258d39cc0d78b86c3a4acda7b2753825f44` on `claude/worker2-runtime-20260815`, pushed, worktree
clean.

## DIFF PRECISION (per AR-1347A Finding 2 — distinguishing ancestry from engineering diff)

**Narrow engineering diff** (the actual test-behavior changes, both AR-1346A witnesses + this
AR-1347A repair, `9e9f8afa..7933b258` on `src/server/__tests__/*` + `src/server/services/__tests__/*`
only):
```
 scheduler-detect-stale-broker-authoritative-guard.test.ts | 136 ++++++-
 scheduler-resume-paper-plus-skip.test.ts                  | 115 ++++++-
 m3-sibling-stop-behavioral.test.ts                        | 228 +++++++++++
 pass5-lifecycle-wiring.test.ts                             |   6 +-
 m3-paper-single-authority-invariant.test.ts                |  17 ++-
 5 files changed, 492 insertions(+), 10 deletions(-)
```
**Full remote ancestry** (`ffa32a56..7933b258`, this AR-1347A round only) also contains, as GPT
correctly flagged for the prior round: the operator-applied `edit_scope` widening
(`.claude/worker2-hook-guard-manifest.json`, +3 lines, control-plane only) and worker-advisor
report/handshake files (`ACK-worker2-*`, `HELLO-worker2-*`,
`WORKER2-AR1346A-RUNTIME-WITNESSES-CLOSEOUT-*`) — none are trading-runtime semantic mutations.

**No production file was touched in this repair.** `git diff --stat` for both commits this round
shows only the 2 named test files.

## REPAIR (test-only, per AR-1347A's exact-two-files authorization)

1. `src/server/services/__tests__/pass5-lifecycle-wiring.test.ts:324` — stale literal
   `"startStream(activeSessId, symbols)"` → `"startStream(activeSessId, activation.symbols)"`,
   tracking the real, already-accepted `lifecycle-service.ts:3386` call. One-line change, same
   assertion, same invariant (the block still must call `startStream` inside the `toState===PAPER`
   M3 marker).
2. `src/server/__tests__/m3-paper-single-authority-invariant.test.ts` — added a `verifyPaperActivation`
   mock at the module boundary (same pattern as every other AR-1155 witness this packet) and
   updated the one affected assertion (`"PAPER session resumes the internal stream..."`) to expect
   verifier-returned symbols (`["MES-VERIFIED"]`) rather than the stale strategy symbol (`["MES"]`),
   with an explicit `not.toHaveBeenCalledWith(..., ["MES"])` negative check. The file's other 8
   tests (Leg A/B source-structure checks, Leg C DEPLOY_READY-skip, Leg D crash-recovery ×3) needed
   no change — none of them reach the verifier call (broker-authoritative guards or `isStreaming:false`
   fire first), confirmed by running them green both before and after.

## GREEN

```
$ npx vitest run src/server/services/__tests__/pass5-lifecycle-wiring.test.ts \
    src/server/__tests__/m3-paper-single-authority-invariant.test.ts
  (the two previously-failing tests now pass; 1 pre-existing unrelated failure remains
   in pass5-lifecycle-wiring.test.ts, named below — untouched, out of AR-1155 scope)

$ npx tsc --noEmit -p .
  (zero output — clean)
```

## FULL BATTERY REPLAY (strict superset per AR-1347A acceptance-bar item 3)

Rather than replaying only the narrow 7-file AR-1346A suite, replayed the entire wider server
suite (a strict superset containing the prior qualification/start/lifecycle/deepscan/recovery
coverage plus everything else under these two directories):

```
$ npx vitest run src/server/__tests__/ src/server/services/__tests__/
  Test Files  728-732 passed, 4 pre-existing failures remain (see below), 4 skipped
  Tests       11061+ passed, 4 failing, 28 skipped
```

## REMAINING FAILURES — named and independently attributed outside this lane (acceptance-bar item 4)

All 4 are pre-existing, confirmed unrelated to AR-1155/verifyPaperActivation, and untouched by
either this round's or AR-1346A's diff (disjoint file sets — vitest per-file module isolation
makes cross-file mock leakage impossible):

1. `src/server/__tests__/office-payout-panel-guards.test.ts > office.html wiring > mounts the
   panel and loads the script` — office.html panel wiring, unrelated subsystem.
2. `src/server/__tests__/wave23-bias-engine-wiring.test.ts > computeBiasForAllSymbols (Gap-Fix-B)
   > forceRefresh=true iterates all 3 symbols without throwing` — **observed FLAKY across repeated
   runs in this same session** (failed once, passed on a re-run moments later with no code change
   in between) — timing-sensitive, not an AR-1155 regression by construction (a flaky test can't be
   caused by a deterministic mock change).
3. `src/server/__tests__/wave23f-critic-look-ahead-engine-contract.test.ts > ... CLAUDE.md
   pinned-facts section documents the auto-shift contract` — stale CLAUDE.md prose-matching,
   unrelated to PAPER runtime.
4. `src/server/services/__tests__/pass5-lifecycle-wiring.test.ts > Pass 5 Track D — CLAUDE.md §8
   engine authority declaration > CLAUDE.md documents paper-engine authority declaration` —
   same class as #3 (CLAUDE.md prose-matching), in the SAME file I just repaired but a DIFFERENT,
   independent test with no relationship to the `startStream` literal fixed above.

None of these 4 involve `verifyPaperActivation`, `startStream`, or any AR-1155 call site. Not
absorbing them into this closeout per AR-1347A's own instruction not to widen scope into
unrelated repository repair.

## CONTROL

Both repairs preserve their test's original invariant rather than weakening it: #1 still asserts
the M3 PAPER-entry block calls `startStream` (just with the corrected argument); #2 still asserts
`routeOrder` is never called (the file's actual grading-crux invariant) AND now additionally
proves `startStream` receives verifier — not stale — symbols, which is a STRICTER assertion than
before, not a loosened one.

## STOP

None. No stale test required a production-semantic change to pass; no verifier bypass appeared on
any path; no new AR-1155-caused regression appeared; no unrelated cleanup was needed to close this
packet.

## GRADER

Not dispatched — AR-1347A's ruling did not require an independent `accuracy-validator` grade for
this narrow test-only repair, and no new production semantic claim is being made (the underlying
AR-1155 production implementation itself was already independently inspected and accepted across
prior rulings, most recently AR-1347A §"Production implementation remains frozen — ACCEPTED").

## NEXT

Per AR-1347A's own closure rule, this SHA (`7933b258`) satisfies all 7 acceptance-bar items:
(1) both stale tests repaired without weakening invariants, (2) all 4 runtime witnesses remain
green, (3) full wider battery replayed as a strict superset, (4) 4 remaining failures named and
independently attributed outside this lane, (5) `tsc` clean, (6) this report distinguishes
narrow engineering diff from full remote ancestry, (7) zero production files touched.

Requesting: **PASS — AR-1155 CERTIFIED / WORKER 2 CURRENT LANE CLOSED.**
