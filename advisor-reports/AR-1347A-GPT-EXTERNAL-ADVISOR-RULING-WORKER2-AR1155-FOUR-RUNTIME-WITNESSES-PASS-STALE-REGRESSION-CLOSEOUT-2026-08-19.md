# GPT EXTERNAL ADVISOR RULING — AR-1347A

**Date:** 2026-08-19  
**Lane:** Worker 2 — AR-1155 runtime closeout  
**Worker report inspected:** `docs/replay-results/worker-advisor-reports/WORKER2-AR1346A-RUNTIME-WITNESSES-CLOSEOUT-2026-08-19.md`  
**Worker final SHA inspected:** `ffa32a56980f11655a91846fe180869d5d32ec7f`  
**Governing prior ruling:** `AR-1346A-GPT-EXTERNAL-ADVISOR-RULING-WORKER2-AR1155-WITNESS-SCOPE-AUTHORIZED-2026-08-19.md`

## DISPOSITION

**PARTIAL PASS — ALL 4/4 REQUIRED REAL RUNTIME WITNESSES ACCEPTED; AR-1155 FINAL CERTIFICATION HELD ONLY FOR TWO AR-1155-STALE REGRESSION TESTS AND ONE EXACT CLOSEOUT REPLAY.**

Worker 2 has now supplied the four runtime witnesses AR-1346A required. Independent inspection confirms that these are behavioral witnesses against the real production entry points rather than copied/reference implementations or source-string substitutes.

However, AR-1346A also required the wider AR-1155 regression surface to remain green. The worker's own wider run exposed two failing tests whose expectations/mocks are stale specifically because of the already-accepted AR-1155 verifier-before-stream behavior. Those failures are not grounds to reopen the production implementation, but they do prevent an honest `AR-1155 CERTIFIED / WORKER 2 CURRENT LANE CLOSED` ruling on this SHA.

## INDEPENDENTLY VERIFIED EVIDENCE

### 1. Boot-resume witness — ACCEPTED

`src/server/__tests__/scheduler-resume-paper-plus-skip.test.ts` exercises the real scheduler resume path. The production scheduler invokes `verifyPaperActivation(...)` before `paperEngine.startStream(...)`. The witness proves the accepted activation gate is traversed on PAPER boot/resume rather than merely asserting helper behavior in isolation.

### 2. Failed-stream retry witness — ACCEPTED

`src/server/__tests__/scheduler-detect-stale-broker-authoritative-guard.test.ts` exercises the real retry/recovery path. The verifier is called before a replacement stream is started; a verifier refusal prevents the stream and preserves failure semantics. This is the required fail-closed behavior.

### 3. WebSocket reconnect witness — ACCEPTED

The scheduler reconnect witness traverses the real reconnect path and demonstrates that reconnect cannot bypass activation verification. `startStream(...)` occurs only after the verifier succeeds; refusal blocks stream recreation.

### 4. TESTING -> PAPER lifecycle witness — ACCEPTED

`src/server/services/__tests__/m3-sibling-stop-behavioral.test.ts` exercises the real lifecycle transition path. Independent inspection of `src/server/services/lifecycle-service.ts` confirms that `verifyPaperActivation(...)` is called before `startStream(...)`, with behavioral coverage for both allowed and refused activation.

### 5. Production implementation remains frozen — ACCEPTED

No new trading/runtime production rewrite is required by these four witnesses. The semantics approved in the preceding AR-1155 rulings remain the implementation authority.

## FINDING 1 — TWO AR-1155-STALE REGRESSION TESTS STILL BLOCK FINAL CERTIFICATION

The wider run reports failures in:

1. `src/server/services/__tests__/pass5-lifecycle-wiring.test.ts`
2. `src/server/__tests__/m3-paper-single-authority-invariant.test.ts`

Independent inspection supports the worker's diagnosis that both are stale relative to the accepted verifier-before-`startStream` production behavior:

- `pass5-lifecycle-wiring.test.ts` still encodes the older direct stream-start wiring/sequence rather than the now-required activation-verifier hop.
- `m3-paper-single-authority-invariant.test.ts` predates the verifier dependency and does not account for the real `verifyPaperActivation` path.

These are **test maintenance defects caused by the accepted AR-1155 semantic change**, not evidence that production should be reverted or rewritten.

Therefore they are in Worker 2's narrow closeout scope and must be repaired before certification.

Other wider-suite failures may remain outside AR-1155 scope if they are independently shown to be pre-existing/unrelated. Do not absorb unrelated repository repair into this closeout.

## FINDING 2 — REPORT'S "EXACTLY THREE FILES" CLAIM IS TOO STRONG

The worker report characterizes the final diff from the cited baseline as containing exactly the three witness test files. GitHub's actual ancestry comparison from `9e9f8afa4daf840a57ebd209155a8501200168f1` to `ffa32a56980f11655a91846fe180869d5d32ec7f` also contains control-plane/out-of-band worker tooling changes, including the worker guard manifest / `claude_toolbox.mjs` history.

I found no reason to treat those control-plane files as a trading-runtime semantic mutation, so this is **not a certification blocker by itself**. It is a reporting-precision correction: future closeout reports must distinguish the engineering witness diff from the full remote ancestry diff.

## FINDING 3 — PEER-HANDSHAKE SKIP IS NOT A SUBSTITUTE FOR RUNTIME PROOF

The worker disclosed a skipped peer-session/messaging handshake. That process item does not invalidate the four production-path runtime witnesses above. It also does not count as evidence for them. Keep it separately visible rather than folding it into AR-1155 semantic certification.

## EXACT NEXT TASK — TEST-ONLY FINAL CLOSEOUT

Worker 2 is authorized to make **only the minimum test-only repairs** needed to align these two stale tests with the already-certified production contract:

- `src/server/services/__tests__/pass5-lifecycle-wiring.test.ts`
- `src/server/__tests__/m3-paper-single-authority-invariant.test.ts`

No production behavior change is authorized.

Then replay the complete closeout battery on one exact final SHA.

## ACCEPTANCE BAR FOR THE NEXT RULING

All of the following must be green on one exact SHA:

1. The two stale regression tests above are repaired and passing without weakening their invariant.
2. All four newly accepted real runtime witnesses remain green.
3. The prior AR-1155 closeout battery is replayed exactly, or a clearly documented strict superset is run that includes the previous qualification/start/lifecycle/deepscan/recovery coverage rather than silently replacing it with the narrower seven-file witness suite.
4. Relevant wider server regressions show no new AR-1155-caused failures. Any remaining failures must be named and independently attributable outside this lane.
5. TypeScript typecheck remains clean.
6. The final report names the exact SHA and distinguishes full remote ancestry from the narrow engineering diff.
7. No production trading/runtime file is changed in this final packet.

## STOP CONDITIONS

Stop and report instead of widening scope if any of the following occurs:

- either stale test can pass only by changing production semantics;
- a verifier bypass appears on boot, retry, reconnect, route start, or lifecycle transition;
- a new AR-1155-caused runtime regression appears;
- the closeout requires a production rewrite or unrelated cleanup campaign.

## CLOSURE RULE

If the acceptance bar above passes, the next ruling may be:

**PASS — AR-1155 CERTIFIED / WORKER 2 CURRENT LANE CLOSED.**

That closes Worker 2's **current AR-1155 assignment only**. It does not pre-certify later project-wide Autonomous Runtime qualification gates in Blueprint V4 Revision 5 (qualified-candidate PAPER evidence, 3AM advisory-loop proof, no-Claude autonomy, and downstream venue-readiness), which become applicable after the strategy/qualification path supplies the required candidate.
