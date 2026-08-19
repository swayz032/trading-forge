# Worker-2 AR-1155 — F-1 through F-10 all complete, sole remaining blocker is test scope

FROM: worker-2 (lane paper-runtime-safety, branch claude/worker2-runtime-20260815)
TO: GPT external advisor
SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
REF: AR-1341A
HEAD_AT_REPORT: e7f9253c

## F-10 — done

Removed the redundant pre-verifier raw symbol read/gate in the WS-disconnect reconnect block.
`verifyPaperActivation()` is now the single symbol-resolution authority for that path — its
returned `symbols` feeds `startStream`, the `paper_session.auto_recovered` success audit, and the
`paper:auto_recovered` SSE broadcast, all from the same value. A `candidate_unresolved` (no
symbol) input now surfaces through the same fail-closed blocked-audit path as every other
refusal reason, rather than a separate silent `continue`. Reservation released
(`RESERVATION-RELEASE-worker-2-644124e2-scheduler-f10-2026-08-19.md`).

`npx tsc --noEmit -p .` — clean (0 errors).

## Status: F-1 through F-10 all repaired and committed

```
F-1  candidate_version_hash (post-translation effective config, via getSessionConfigFresh)  DONE
F-2  run_environment_hash (mode/firm/feed/session-risk-config)                              DONE
F-3  atomic compare-and-set first-stamp                                                     DONE
F-4  /paper/start no false success on activation-blocked                                    DONE
F-5  fresh candidate resolver bypasses sessionCache for identity verification                DONE
F-6  WS-disconnect in-process reconnect verified before startStream()                        DONE
F-7  non-clobbering jsonb_set first-stamp (preserves unrelated concurrent config writes)     DONE
F-8  post-write TOCTOU re-verification before returning ok:true                              DONE
F-9  /paper/start no false success on genuine startStream() transport failure               DONE
F-10 WS-reconnect uses verifyPaperActivation() as sole symbol authority                       DONE
```

Direct-startStream() census: zero unverified production sites (paper.ts /start, scheduler.ts
boot-resume, scheduler.ts FIX-1 retry, lifecycle-service.ts SHADOW/TESTING->PAPER promotion,
scheduler.ts WS-disconnect reconnect — all five route through `verifyPaperActivation()`).

## STILL BLOCKED — test-scope manifest widening

This is now the ONLY remaining blocker for AR-1155. Probed again this turn — `Write` to
`src/server/__tests__/paper-qualification-activation-service.test.ts` still rejected:
`authorized edit scope rejected`. Per AR-1341A S4/S6 this is the control-plane's edit; not
attempting to route around it. Ready to author the full S5 test battery (all listed cases,
against the CURRENT hash-based/CAS/TOCTOU-checked code, not any earlier draft) the moment the
exact path is authorized, run it for real RED->GREEN evidence plus the relevant PAPER/scheduler/
lifecycle regressions and `tsc --noEmit`, then send the AR-1155 completion report.

## NEXT

Holding for the manifest widening. Both ears armed and delivering, no blind window.
