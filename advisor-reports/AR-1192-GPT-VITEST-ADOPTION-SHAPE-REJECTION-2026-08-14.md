# GPT EXTERNAL ADVISOR RULING — AR-1192

**Date:** 2026-08-14  
**Type:** THREE SPEEDS / VITEST ADOPTION-SHAPE FAILURE  
**Status:** ONE-RUNNER SHARDING REJECTED / TWO-RUNNER RESULT PRESERVED / PRODUCTION FAST LANE UNCHANGED  
**Parent:** AR-1191

## RULING

The stricter one-runner Vitest sharding experiment is **REJECTED**.

This is not a test-count failure and not a missing-test failure. The experiment conserved all measured test identities but changed at least one assertion status under same-runner concurrency.

The speed lane must not weaken the evidence comparator or accept count-only parity to make this geometry pass.

## EXPERIMENT

Run:
`31862262190`

Commit:
`7491e1db6c7d82bc5d28fd2f453d9cc9517f451f`

Subject SHA:
`98c0683dc5deafa63c77e7f70ac6b98e014a8019`

Geometry:
- one GitHub Actions runner;
- dependencies installed once;
- one isolated database for serial control;
- one isolated database per shard;
- serial control first;
- then two concurrent Vitest child processes;
- each shard remained `forks + maxWorkers=1 + minWorkers=1`;
- shard evidence merged through the fail-closed merger;
- exact file/assertion/status equivalence required before the existing baseline comparator could run.

## WHAT PASSED

- runner/toolchain setup;
- exact subject dependency install;
- three isolated database creation/migration;
- fresh serial control execution;
- both concurrent shard executions;
- shard JSON production;
- fail-closed merge;
- test-file census conservation;
- assertion-count conservation.

Observed conserved census:
- serial files: `922`;
- merged files: `922`;
- serial assertions: `13,485`;
- merged assertions: `13,485`.

The overall success flag also remained equal.

## WHAT FAILED

The exact assertion evidence comparison returned:

```text
same_files       = true
same_assertions  = false
same_success     = true
```

Therefore at least one assertion status changed under the same-runner concurrent geometry even though the test-file and assertion counts remained identical.

That is sufficient to reject the adoption shape.

The existing baseline-comparator equality step was intentionally not reached after the stricter equivalence gate failed.

## WHY THIS MATTERS

A weaker speed check could have said:

```text
922 files == 922 files
13,485 assertions == 13,485 assertions
same overall success flag
=> good enough
```

That would be wrong.

For Trading Forge, machine speed is allowed only when the evidence meaning is conserved, not merely the counts.

The assertion-status drift demonstrates that same-runner concurrency changes observable test behavior in this suite.

## TWO-RUNNER RESULT REMAINS VALID

This rejection does **not** invalidate the earlier isolated-runner result from run `31861913966`.

That proof showed:
- serial `259s`;
- two isolated single-worker shards `142s` critical path;
- `117s` saved;
- `1.824x` test-phase speedup;
- exact `922` file conservation;
- exact `13,485` assertion conservation;
- exact file/assertion/status evidence equivalence;
- identical existing baseline-comparator verdict.

Therefore:

**TWO-RUNNER ISOLATED SHARDING = PROVEN CANDIDATE.**

**ONE-RUNNER CONCURRENT SHARDING = REJECTED.**

These are different claims and must not be conflated.

## PRODUCTION DECISION

Production `.github/workflows/fast.yml` remains unchanged.

Do not:
- switch Fast Lane to the rejected one-runner geometry;
- loosen assertion comparison;
- accept count-only equivalence;
- restore the old unstable global/thread parallelism;
- hide the drift behind the frozen baseline comparator.

Any future Vitest acceleration must preserve isolated-runner truth or prove another geometry with exact evidence equivalence first.

## OTHER WAVE-1 RESULT UNAFFECTED

The parity dependency-slimming candidate remains strongly proven:
- same-commit heavy parity job: `199s`;
- same-commit bounded dependency proof: `76s`;
- exact `35 passed / 0 failed / 0 skipped`;
- `123s` same-commit job saving;
- production CI still unchanged pending bounded adoption.

## FINAL RULING

**REJECT THE ONE-RUNNER SHARDING ADOPTION SHAPE.**

This failure is a successful robustness outcome: the speed lane found a faster-looking configuration and refused it because the underlying evidence changed.

Preserve the proven two-runner isolation result, preserve the parity dependency candidate, keep production Fast Lane unchanged, and continue only with speed changes that conserve exact truth.
