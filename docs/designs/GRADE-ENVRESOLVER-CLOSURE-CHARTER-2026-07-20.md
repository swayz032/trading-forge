# GRADE CHARTER — env-resolver NOT-SAFE closure (`cc4899ac`) + return-value-vs-throw CLASS SWEEP

**Dispatched by:** OPS-campaign ADVISOR (OR-080), 2026-07-20.
**You are:** a fresh-context independent grader (doer≠grader). You did NOT write this code and you take NObody's word for it — you re-execute. Band ceiling is **7** (pre-live; 10 is unreachable, 9 needs live evidence this leg does not have).

## Context (what you are grading, and why it is not routine)

The ops-experience working agent shipped a one-`.env`-resolver (`scripts/lib/env-resolve.cjs`) used by two unattended jobs (rail-runtime + soak-watcher). An independent grade returned **BAND 6 / NOT-SAFE** with two MUST-FIXes. The agent closed both in commit **`cc4899ac`** — an UNREVIEWED fix-of-a-NOT-SAFE-finding. Your job is to decide whether `cc4899ac` actually closes them, and whether a **defect class** is now swept clean.

★ The reason this is not a routine closure-grade: **MAJOR-1 is a recurrence.** The same defect class — *a call that signals failure by RETURN VALUE, read only via the throw / absence-of-exception channel* — was fixed earlier the SAME session in `scripts/lib/rail-crash-handler.cjs` (the "F-1" crash-handler fix: `postDiscord` returns `{ok:false}` and never throws, so a success path that keyed on "no exception" lied). It reappeared one commit later in the env-resolver against dotenv. An instance was fixed; the class was not swept; the class recurred. Your grade must close the CLASS, not just this instance.

## Where

- Worktree: `C:\Users\tonio\Projects\wt-ops-experience-20260719` (branch `ops/office-rails-20260719`).
- Grade AT commit `cc4899ac` (confirm `git -C <worktree> rev-parse HEAD` or check out that SHA in a scratch copy — do NOT reset the agent's worktree).
- **Collision bar:** the agent is holding read-only during your grade. Do not mutate the worktree. If you must run tests that write, use a scratch checkout.

## PART A — Does `cc4899ac` close the findings? (re-execute, do not re-read)

For EACH item below, the grade of record is: reintroduce the defect (mutate), run the suite, confirm the claimed number of tests go RED, revert. A fix whose test does not go RED when the bug is reintroduced is a **vacuous** fix — treat that as a RED grade regardless of what the code looks like.

1. **MAJOR-1 (dotenv return channel).** The resolver must now READ dotenv's `{error}` return, not only catch throws. Acceptance: an erroring/unreadable `.env` yields `loaded:false` + a reason (`e.code`, NEVER `e.message` — verify no secret VALUE can reach a log/return string), NOT `loaded:true`. Mutant: restore the unconditional `{loaded:true, reason:null}`. Agent claims **2 tests fail**. Confirm the count and that the failing tests are the ones that assert the failure branch.
2. **MAJOR-2 (partial-`.env` shadow).** The resolver must walk candidates until the REQUIRED vars are actually set (a `requireVars` contract), not stop at the first *existing* candidate — otherwise a partially-populated `.env` shadows a complete one (bites the worktree affordance). Mutant: revert to "stop at first existing candidate." Agent claims **2 tests fail**. Confirm.
3. **MAJOR-3 (tests institutionalized MAJOR-1).** Both success-case tests previously stubbed `config(){}` — a function that cannot fail — so `loaded===true` was trivially true. Confirm the stubs are now `okDotenv` / `erroringDotenv`, the erroring one returning `{error}` the way dotenv v16 actually does. If the erroring stub does not return `{error}`, MAJOR-1's test is still vacuous.
4. **MINOR-1/2/3.** `preferVar` per-job (so `RAILS_ENV_PATH` no longer silently outranks an operator's `SOAK_ENV_PATH`); the chosen path is actually EMITTED and consumed (`{"type":"env","loadedFrom":"<path>"}` on soak-watcher — "shipped, not delivered" was the finding, so confirm a consumer exists); siblings derived from the MODULE location too, not cwd-only (cold recovery is exactly when cwd≠repo-root). Spot-confirm each closed.
5. **Regression floor:** re-run the agent's stated gates and confirm — `tsc` 0, `test:scripts` 175/175, `ci vitest` 30/30. Report actuals, not "as claimed."

## PART B — THE CLASS SWEEP (the reason you were dispatched)

1. **Enumerate the ops-lane surface** from the branch diff: `git -C <worktree> diff --name-only 404a3396..cc4899ac`, filtered to `scripts/**` and `src/server/**` authored by this campaign. Do NOT rely on any hand-listed file set (a count is not an inventory; a memorized list misses the shape). Report the enumerated file list.
2. For every call site in that surface, classify the callee's failure signalling: **throws** / **returns a failure value** (`{ok:false}`, `{error}`, `null`, `-1`, `false`, empty) / **both**. Flag every site where the callee CAN signal failure by return value but the caller reads only throw/absence-of-exception (or the inverse: keys on a return code from something that only throws). For each flagged site: is it fixed, safe-as-written, or a NEWLY-FOUND live instance?
3. **Confirm the ORIGINAL instance stays fixed:** re-verify `rail-crash-handler.cjs` (F-1) still reads the sink return, and `soak-guard.cjs`/`soak-sensors.cjs` (the idle-guard, OR-070) do not harbor the same shape.
4. ★ **Reconcile the count discrepancy.** The agent's report §2 header says this class error is on its "**third time**"; the body says "**Twice now**." Determine the truth from the code/history: is this the 2nd or 3rd occurrence? If 3rd, NAME the third site — it is a live sibling and its state (fixed/open) is part of your verdict.

## Verdict (report both, do not average)

- **PART A:** does `cc4899ac` close all MUST-FIXes with non-vacuous (mutation-proven) tests? Band, SAFE / NOT-SAFE.
- **PART B:** is the return-value-vs-throw class swept CLEAN across the ops-lane surface, or are there live siblings (incl. the possible unnamed third)? List every site examined and its disposition.
- A CLEAN Part A with a DIRTY Part B is **NOT-SAFE for landing** — the whole point of this grade is that instance-fixes without class-sweeps recur. Say so plainly if that is what you find.

Secrets in your report = NAMES ONLY, never values. Report `file:line` for every finding.
