# Worker-2 AR-1155 — lifecycle PAPER-transition witness: better seam found, scope estimate before committing effort

FROM: worker-2 (lane paper-runtime-safety, branch claude/worker2-runtime-20260815)
TO: GPT external advisor
SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
REF: AR-1343A S4.3

Addendum to `WORKER2-AR1155-SCHEDULER-WITNESS-SCOPE-REQUEST-2026-08-19.md` (still holding on that
one too) -- reporting a lifecycle-witness finding before spending real effort on it, since the
scope looks substantial and AR-1343A's own stop condition #2 asks me to report a seam limitation
rather than build through one unilaterally when it's large.

## Found a BETTER existing seam than the one AR-1343A named

AR-1343A S4.3 suggested `lifecycle-b3-b6-archetype-gate-stop-race.test.ts` "if it can cleanly
drive the real service" -- it cannot; confirmed by reading it (again) -- it is 100%
`readFileSync` + string-match, same as `deepscan14-shadow-stage.test.ts`, no `LifecycleService`
import anywhere in the file.

`src/server/services/__tests__/m3-sibling-stop-behavioral.test.ts` is the real seam: it already
instantiates `new LifecycleService()` and calls the REAL `svc.promoteStrategy(STRATEGY_ID,
"PAPER", "DEPLOY_READY")` against a genuinely condition-aware DB mock (its `eq`/`and` mocks return
inspectable objects; the `paperSessions` select handler actually evaluates the WHERE condition
against seeded rows -- built specifically so a status-string typo regression would be caught, per
its own header). It already mocks `../paper-trading-stream.js`'s `startStream`/`stopStream`/
`isStreaming` directly -- exactly the dependency I need to control.

## The catch: it only covers the SIBLING (exit) transition, not entry

That file's own `promoteStrategy(..., "PAPER", "DEPLOY_READY")` call starts FROM PAPER, so it
never reaches my `if (toState === "PAPER")` block (that block only fires when ENTERING PAPER).
I would need a NEW test in this same file (or a same-pattern sibling file) calling
`svc.promoteStrategy(STRATEGY_ID, "TESTING", "PAPER")` (the LEGACY direct path, simpler than
SHADOW->PAPER's Gate 2.5 chain).

## Scope estimate for reaching that block

`grep -n '(fromState === "TESTING" || fromState === "SHADOW") && toState === "PAPER"'
lifecycle-service.ts` shows the TESTING/SHADOW->PAPER gate chain spans roughly lines 1470-3360 of
this file -- WFE, PBO, B14 ci_high, DSR walk-forward, MC survival rate > 0.70, frozen-policy
freeze, exportability pre-check, and several more (deepscan14-shadow-stage.test.ts's own H1 suite
enumerates the SHADOW->PAPER set). Reaching my activation block requires every one of these to
resolve PASS for the fixture strategy -- i.e. mocking ~8-10 additional gate-evaluator modules
(`evaluateWfeGate`, `evaluatePboGate`, `evaluateB14CiGate`, `evaluateDsrWalkForwardGate`,
`checkExportability`, `freezePolicyForStrategy`, MC survival query rows, etc.), on top of
`m3-sibling-stop-behavioral.test.ts`'s already-substantial existing mock harness.

This is not a "production export missing" seam limitation (the class AR-1343A S4.3's own stop
condition names) -- `LifecycleService`/`promoteStrategy` are already exported and the pattern
already exists. It IS a large mock-authoring task, comparable in scope to
`m3-sibling-stop-behavioral.test.ts`'s own existing setup. Reporting the size before committing to
it, per the same "smallest causal change" discipline this packet has followed throughout, rather
than silently spending a large chunk of remaining budget without confirming this is the intended
path.

```
Option A: proceed -- extend m3-sibling-stop-behavioral.test.ts with a new describe block for the
          TESTING->PAPER legacy entry path, mocking the ~8-10 gate evaluators to PASS (mirroring
          deepscan14-shadow-stage.test.ts's own documented gate list), then assert
          verifyPaperActivation refusal/success -> startStream not-called/called-with-
          activation.symbols. This is the technically-correct real-execution witness AR-1343A
          asks for.
Option B: accept a narrower/synthetic proof instead -- e.g. a small standalone unit that calls
          the SAME code shape (verify-then-startStream) that appears at lifecycle-service.ts's
          PAPER block, isolated from the surrounding gate chain, if GPT judges that an acceptable
          substitute for "real execution" here (it would NOT be the actual promoteStrategy()
          function running, so likely does not meet AR-1343A S6's "not a copied/reference
          implementation" bar -- flagging, not recommending).
Recommendation: A -- it is real, it is buildable through the existing exported class/method, and
                it is the last of the required wiring witnesses; the cost is size, not a hard
                blocker.
```

## NEXT

Holding for confirmation on Option A (or a ruling on B/other) plus the still-open scheduler
2-file scope grant from the prior report. Not starting Option A's mock-authoring work until both
the approach and the scope are confirmed -- it is real effort and I don't want to spend it on the
wrong shape or without the file actually being writable.
