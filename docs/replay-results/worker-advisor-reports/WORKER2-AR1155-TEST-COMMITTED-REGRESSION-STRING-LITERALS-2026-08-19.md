# Worker-2 AR-1155 — focused test committed and GREEN, two pre-existing regression tests need a one-line string update outside my scope

FROM: worker-2 (lane paper-runtime-safety, branch claude/worker2-runtime-20260815)
TO: GPT external advisor
SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
REF: AR-1341A S4/S5

## Test-scope grant confirmed working, with negative controls proven

`Write` to `src/server/__tests__/paper-qualification-activation-service.test.ts` now succeeds.
Proved the exact required negative controls before writing real content:
- unrelated test file (`src/server/__tests__/some-unrelated-file.test.ts`): DENIED
- Worker-1-owned surface (`src/engine/extraction/some-probe.py`): DENIED
- self-protected guard manifest itself: DENIED (`lane guard refused (not scope-overridable):
  SELF_PROTECTED:.claude/worker2-hook-guard-manifest.json`)

## Focused test file committed — 37 tests, all GREEN, real RED->GREEN evidence

`src/server/__tests__/paper-qualification-activation-service.test.ts` now covers every AR-1341A
S5 case: RED witnesses, every mutation class (driven through the REAL `canonicalHash`/
`buildCandidateProjection`/`buildRunEnvironmentProjection` so a "mutation blocks" assertion
proves the hash actually changed, not just that a string comparison works), F-5 freshness
(warm-cache-then-DB-mutation-then-verify-blocks), F-8 TOCTOU (a controlled spy makes a DB
mutation land strictly between one `verifyPaperActivation` call's internal read and write),
F-3/F-7 atomicity (racing first-stamp callers, unrelated-concurrent-config-survives), and the
never-calls-startStream contract.

RED->GREEN evidence, not just a final green:
```
npx vitest run src/server/__tests__/paper-qualification-activation-service.test.ts
  -> 37 passed (37)

Red-proof performed live: temporarily neutered the F-8 post-write check
(`if (false && !postWriteCheck.ok)`), re-ran the -t "F-8" filter -> 1 failed as expected
(assertion `expected true to be false`), reverted, re-ran full suite -> 37 passed again.
```

`npx tsc --noEmit -p .` — clean (0 errors).

## Testing-limitation disclosure (surfaced, not concealed)

The real `paper-signal-service.js` could not be imported for these tests — a PRE-EXISTING,
AR-1155-unrelated app-wide fragility: it transitively imports `paper-risk-gate.js` /
`context-gate-service.js`, both of which import `../index.js` (the full Express bootstrap,
`new LifecycleService()` at module scope), which breaks under Vitest's module system. 65 files
in this codebase share this `../index.js` import anti-pattern; `deepscan14-shadow-stage.test.ts`'s
own header comment documents avoiding this exact problem for `lifecycle-service.ts` the same way
I ended up doing here. Fix: `vi.mock`/`vi.doMock` a FAITHFUL minimal reimplementation of
`getSessionConfig`'s exact cached-vs-fresh contract (same cache-forever-per-sessionId vs
never-caches shape), reading the SAME real PGlite `strategies`/`paper_sessions` rows, not a
second semantic implementation of DSL translation (none of my fixtures are DSL-shaped, so the
real translator would be a no-op on them anyway). This is disclosed in the test file's own header
comment and inline at the mock site.

## Existing regression battery run — 2 files, 3 pre-existing tests now RED, exact fix identified, OUTSIDE MY SCOPE

Ran the existing lifecycle/scheduler regression suites that assert against
`lifecycle-service.ts`'s SHADOW/TESTING->PAPER `startStream()` site by literal-source-string
matching (the pattern documented in `deepscan14-shadow-stage.test.ts`'s own header as this
codebase's established alternative to importing the heavy module directly):

```
src/server/__tests__/deepscan14-shadow-stage.test.ts             1 failed / 24 passed
src/server/__tests__/lifecycle-b3-b6-archetype-gate-stop-race.test.ts   2 failed / 7 passed
src/server/__tests__/deepscan16-wave2-track-g2.test.ts            all passed
src/server/__tests__/auto-recovery-debt1-4.test.ts                all passed (25)
```

All 3 failures are the SAME root cause: my F-10-equivalent change for this call site (the
`toState==="PAPER"` block) now calls `startStream(activeSessId, activation.symbols)` instead of
the old `startStream(activeSessId, symbols)` -- correct and intentional (the verified symbols
from `verifyPaperActivation` are now the authority, same principle as F-10's scheduler.ts fix),
but these two files assert the OLD literal string.

Exact one-line fix needed in each (both are simple substring updates, no logic change to the
test's own assertions):

```
FILE: src/server/__tests__/deepscan14-shadow-stage.test.ts
LINE 85:
  - expect(region).toContain("startStream(activeSessId, symbols)");
  + expect(region).toContain("startStream(activeSessId, activation.symbols)");

FILE: src/server/__tests__/lifecycle-b3-b6-archetype-gate-stop-race.test.ts
LINE 121:
  - expect(block).toContain("await startStream(activeSessId, symbols)");
  + expect(block).toContain("await startStream(activeSessId, activation.symbols)");
LINE 133:
  - const startLocalIdx = block.indexOf("startStream(activeSessId, symbols)");
  + const startLocalIdx = block.indexOf("startStream(activeSessId, activation.symbols)");
```

I am NOT authorized to edit either file -- `edit_scope.allowed_exact` covers exactly
`src/server/__tests__/paper-qualification-activation-service.test.ts`, no other test path (by
design, per AR-1341A S4's own "do not add the whole prefix" instruction). Not attempting to route
around it.

```
Option A: widen edit_scope.allowed_exact to add these exact two filenames (narrowest possible,
          same exact-not-prefix convention every other grant in this manifest already uses).
Option B: route this pre-existing-test-maintenance fix to a session/actor already authorized for
          those two paths (if one exists).
Option C: accept these 3 tests as a documented, GPT-ruled known-breakage for this packet only,
          to be closed in a follow-up outside AR-1155 (only if GPT judges that acceptable --
          Worker-2's own CLAUDE.md carries a zero-carry-forward doctrine, so this is offered as
          an option, not a default).
Recommendation: A -- two-line total diff, mechanical, already fully specified above; matches how
                the test-scope block itself was resolved.
```

## Status

AR-1155 implementation: F-1 through F-10 complete, `tsc` clean, focused test file committed and
GREEN with real RED->GREEN + red-proof evidence. Sole remaining gap: the 3 pre-existing
regression-test string literals above, blocked on scope exactly as before.

## NEXT

Holding for a ruling on the two-file scope question. Both ears armed.
