# GRADE CHARTER — leg-3 recovery env-var manifest (`a98a52d1`)

**Dispatched by:** OPS-campaign ADVISOR (OR-105), 2026-07-20.
**You are:** a fresh-context independent grader. You do NOT trust the author's tests — on this campaign the author's self-verification has missed a sibling on every prior unit, caught only by a grader that hunted BEYOND the named mutants. Author-green is not evidence; construct your own adversarial inputs, execute them, and hunt for what the manifest MISSES. Band ceiling 7. Secrets: names only, never values.

## Context

Leg-3 is the recovery env-var manifest — the last designed piece of the cold-recovery drill. It classifies env vars so a recovery operator knows which are REQUIRED (capability dies without them), OPTIONAL-with-fallback (absence is fine), or OPTIONAL-DEGRADING (silently reduces capability — "boots healthy, S3-blind"). Files (in worktree `C:\Users\tonio\Projects\wt-ops-experience-20260719`, HEAD `a98a52d1`): `scripts/ops/recovery-env-manifest.cjs` (typed source), `scripts/ops/verify-env-manifest.cjs` (cross-checks each declared class against the code), tests, and a rendered section of `docs/cold-recovery-runsheet.md`. It reuses leg-2's closed-schema-rendered shape. The author already RED-proofed 7 mutants and found one real defect (`AWS_SECRET_ACCESS_KEY` absent from `.env.example` while its partner was present → a rebuilt box gets half the S3 pair and is silently lake-blind).

## Verify each by your own executed adversarial input

1. **Schema closure (leg-2's property, preserved):** hand-edit the rendered manifest section of the runsheet to a dishonest classification → `runsheet:check` must exit 1. Confirm the EOL-normalization is content-preserving (a content edit still differs).
2. **The 7 mutants + the sound-direction claim:** re-apply each (undeclared degradation, overclaimed degradation, hiding the dangerous minority, invented class, missing justification, …) in a scratch clone, verify the mutation actually landed, confirm CAUGHT. Confirm the tool's stated sound direction — *an empty-default site (`?? ""`, `|| ""`, `|| ''`) for a var ⇒ that var MUST be declared OPTIONAL_DEGRADING* — actually fires, in both directions.
3. **★ HUNT BEYOND — does the manifest MISS a dangerous var? This is why you are here.** Independently sweep the codebase for empty-string-default sites (`process.env.X ?? ""`, `|| ""`, `|| ''`, `SET …='' `) and silent-degradation patterns. For EVERY such site, is its var declared OPTIONAL_DEGRADING in the manifest, or is it missed? A missed silent-degradation var is the exact defect the manifest exists to surface — a single miss in a covered pattern is NOT-SAFE. (The author found `duckdb-service.ts` and the leg-5 probe; find the ones it didn't.)
4. **`.env.example` completeness — the real-defect class.** Confirm `AWS_SECRET_ACCESS_KEY` is now present (name only). Then hunt for OTHER incomplete credential PAIRS or recovery-required vars missing from `.env.example` that silently degrade — the "half a pair" shape has siblings by definition; find them.
5. **Anti-cry-wolf vs hiding-the-signal.** The runsheet surfaces ~4 actionable vars and suppresses ~5-with-working-defaults out of ~617 read / ~323 undeclared. Confirm the suppression hides no var that a recovery actually needs (a REQUIRED or OPTIONAL_DEGRADING var suppressed as if it had a safe default). "A count is not an inventory" cuts both ways — confirm the 4 are the right 4.
6. **The false-positive surface, honestly bounded:** `PYTHONPATH ?? ""` is declared a legitimate empty-default (not degradation). Confirm the detector's false-positive cases are declared, and REQUIRED-vs-OPTIONAL is human-declared (not claimed as tool-decided, since that needs dataflow the tool doesn't do — e.g. `s3-client.ts:77` guarding a bare read 8 lines later).

## Also

- Regression floor with a discriminating control; note `tsc` is vacuous for a `.cjs`/`.mjs`/`.md` diff — report the real `test:scripts` count.
- Confirm classes-are-SETS (a var like `DATABASE_URL` can be both bare-required and empty-default-degrading) is genuinely modeled, not collapsed to one label that hides the dangerous minority.

## Verdict

Per item closed/not-closed with the input you ran; every silent-degradation var you found that the manifest MISSED; overall band + SAFE-TO-LAND / NOT-SAFE; one-line bottom line. A missed silent-degradation var in a pattern the tool claims to cover, or a suppressed var a recovery needs, is NOT-SAFE.
