# AR-1143 — GPT STATIC AUDIT: STRATEGY ROTATION AUTHORITY GAP

**Date:** 2026-08-13  
**Status:** STATIC PRE-AUDIT / PAPER-QUALIFICATION FINDING  
**Worker collision rule:** AR-1138 remains the active Claude worker order after quota reset. This document does not redirect that work.

## Current branch evidence

On `h1-wave4-sealed12-driver`, two useful authorities already exist.

### Portfolio drift / demotion service

`src/server/services/portfolio-drift-demotion-service.ts`:

- evaluates deployed strategies using persisted rolling-30d Sharpe;
- defaults the portfolio-drift mutation switch OFF unless explicitly enabled;
- when enabled, can move a strategy through `DEPLOYED -> DECLINING -> TESTING` using the existing lifecycle service;
- records audit/SSE evidence.

The inspected service ends after the demotion result. It does not itself contain reserve ranking or a replacement-selection call.

### Strategy assignment service

`src/server/services/strategy-assignment-service.ts` provides the separate assignment authority:

- assign a DEPLOYED strategy to an account;
- archive an assignment;
- query active assignments;
- release/retract family assignments;
- write audit/SSE evidence.

The service requires a strategy to be DEPLOYED before assignment. It does not itself define a reserve-ranking or rotation policy.

## Static conclusion

The current inspection proves these pieces separately:

```text
strategy health / drift
-> lifecycle demotion
```

and

```text
eligible DEPLOYED strategy
-> assignment authority
```

The inspection has not yet found or certified a single coordinator proving the complete handoff between those pieces.

That is a narrower problem than rebuilding lifecycle or assignment. The correct fast-engineering posture is to continue tracing existing code for a coordinator first and avoid duplicating machinery that already exists.

## Ambiguity to resolve before unattended PAPER rotation claims

`getActiveAssignment(accountId)` currently reads an active row with `.limit(1)`. The static audit must therefore confirm the underlying DB/runtime invariant that makes the result unambiguous. If multiple active rows can exist for one account, an unordered first-row result is not a sufficient authority for unattended qualification testing.

## Next static audit targets

Without changing the worker's AR-1138 files, inspect:

1. lifecycle demotion consumers/events;
2. account-strategy-assignment write sites;
3. strategy-health / ranking outputs;
4. runtime strategy-load authority;
5. PAPER restart reconciliation for active assignment state;
6. whether an existing coordinator already connects these pieces.

If an existing coordinator is found, the next step is evidence/test review rather than new architecture. If none is found, record the missing handoff as a bounded post-compiler engineering gap.

## Verdict

**Demotion authority:** FOUND.  
**Assignment authority:** FOUND.  
**End-to-end rotation coordinator:** NOT YET FOUND / NOT CERTIFIED.  
**Recommended action now:** continue static tracing while Claude is quota-paused; do not interrupt AR-1138.
