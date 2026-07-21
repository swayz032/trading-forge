# GRADE CHARTER — leg-2 recovery runsheet/verifier, NOT-SAFE closure (`57d47d2b`)

**Dispatched by:** OPS-campaign ADVISOR (OR-097), 2026-07-20.
**You are:** a fresh-context independent grader. You did NOT write this code and you do NOT trust the author's tests — on this campaign the author has now TWICE RED-proofed against shapes the tests already caught (leg-5's credential guard, then this unit's mutants), and its fixes have twice left a sibling class open one file over. So author-green is not evidence; you construct your OWN adversarial inputs and EXECUTE them, and you hunt BEYOND the findings already named. Band ceiling 7. Secrets: names only.

## Context

`scripts/ops/verify-recovery.cjs` is an executable recovery runsheet/verifier (three tiers A/B/C + it invokes the leg-5 S3 probe). Its whole subject is preventing false-greens in recovery. An independent grade returned **BAND 4 / NOT-SAFE** with TWO CRITICALs:
- **CRITICAL-1:** `tierTasks` hardcoded 3 expected task names while the register scripts create 6, so it printed `all_registered` / "5 PASS exit 0" while `TF-Rails-Divergence`, `TF-Rails-WorktreeTTL`, and **`TF-CI-Runner`** (the Tier-C runner task whose inertness is the runsheet's headline finding) were absent — the verifier committed the exact "registers clean, does nothing" sin it documents.
- **CRITICAL-2:** 10 of 12 mutants survived; the suite never called `main()`, `legS3`, or `tierServices`. Plus M10: the author fixed the runsheet-guard instance but left the EVIDENCE-enum sibling with no honesty check (`"DRILLED 2026-07-20 (previously: not drilled)"` passes a literal `/not drilled/` grep).

The author closed all of this in **`57d47d2b`** — UNREVIEWED. Your job: is it actually closed, and are there MORE survivors the author (whose blind spot is systematic) did not find?

## Where

- Worktree `C:\Users\tonio\Projects\wt-ops-experience-20260719`, grade AT `57d47d2b` (confirm HEAD; scratch-clone for mutating runs; the author holds read-only — do not mutate its tree).
- Files: `scripts/ops/verify-recovery.cjs`, `scripts/ops/__tests__/verify-recovery.test.mjs`, the runsheet `.md`, and the register scripts it derives task names from.

## The closures — each verified by YOUR OWN executed adversarial input

1. **CRITICAL-1 — task existence.** Confirm expected task names are DERIVED from the register scripts' own `$TaskName` defaults, not a hardcoded list (change a register script's task name in a scratch clone → the verifier's expectation must follow). Confirm: a registered-but-**Disabled** task is a FAIL (registration ≠ execution); an **empty derived list** is UNKNOWN not PASS ("found nothing" ≠ "nothing missing"); a substring match no longer counts (parse by field + state). Run the verifier on this tower and confirm it now reports the absent tasks as FAIL with exit 3, naming them — not a green.
2. **CRITICAL-2 — mutation coverage.** The fix claims every check now takes injected I/O and all 10 survivors are caught. Re-apply each of the 10 named mutants (map probe FAIL→PASS · PASS when no distro · PASS despite FAILs · never spawn the probe · and the rest) in a scratch clone and confirm CAUGHT — **and verify the mutation is actually applied first** (the author found two runs that reported CAUGHT/SURVIVED while the mutation had thrown `FileNotFoundError`; a mutant that fails for the wrong reason proves nothing). Confirm `main()`, `legS3`, `tierServices` are now actually exercised.
3. **★ HUNT BEYOND THE 10 — this is why you were dispatched.** The author's RED-proofs cluster where its tests already look, twice now. Construct NEW mutants the author did not publish, especially in the previously-uncovered paths (`main`, `legS3`, `tierServices`, the tier roll-up, the evidence enum, the probe-spawn/exit-code handling, UNKNOWN-vs-FAIL precedence). Does any survive? A single survivor in a path the fix claims to cover is NOT-SAFE.
4. **M10 — evidence-enum honesty.** Confirm the printed evidence enum now gets MEANING-based classification, not a literal grep: `"DRILLED 2026-07-20 (previously: not drilled)"` and other negation-laden dishonest upgrades must be CAUGHT; an honest reword must NOT false-trip (M9's prose-scan shape too).
5. **MAJOR-3/4** — guard no longer inverted (red on honest reword / green on dishonest upgrade); Tier-B capability column states what is actually checked (not "able to run" when only a substring was proven).

## Also

- Regression floor with a **discriminating** control, and note honestly: `tsc` covers only `**/*.ts`, so "tsc 0" is VACUOUS for this `.cjs`/`.mjs`/`.md` change — the real coverage is `test:scripts` (report the actual count, confirm non-vacuous). Do not accept a "tsc 0" that sounds like coverage and is not.
- The CRITICAL-1 FAIL surfaces a real ops finding — 3 tasks absent on this tower. Confirm that is a genuine registration gap (consistent with the known dormant-by-non-registration issue), not a verifier bug.

## Verdict

Per item closed/not-closed with the adversarial input you ran; any NEW survivors you found; overall band + SAFE-TO-LAND / NOT-SAFE; one-line bottom line. A single surviving mutant in a covered path, or any evidence-enum dishonest-upgrade that passes, is NOT-SAFE.
