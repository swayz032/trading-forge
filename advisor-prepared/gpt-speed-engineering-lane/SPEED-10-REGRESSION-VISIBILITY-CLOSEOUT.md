# SPEED-10 — Speed Regression Visibility Closeout

Status: **COMPLETE / IMPLEMENTED / HOSTED-GREEN / ADVISORY BY DEFAULT**

## Delivered

- `tooling/actions-speed-observer.mjs`
- `tooling/actions-speed-observer.test.mjs`
- `baselines/speed-budgets-advisory.json`

## Behavior

The observer reads exact GitHub Actions job/step timestamps, produces a machine-readable timing receipt, and compares measured durations to configured budgets.

It fails closed on malformed/missing/negative timing data.

It does **not** fail engineering work merely because a job is slower. Default mode is advisory. Blocking behavior requires explicit `--strict` opt-in.

## Frozen advisory baseline

Source Fast Lane:
- run `31560374167`
- SHA `98c0683dc5deafa63c77e7f70ac6b98e014a8019`
- job: `415s`
- full Vitest evidence step: `251s`

Advisory warning margin: 20%.

Current warning thresholds:
- Fast Lane job: `498s`
- full Vitest evidence step: `301s`

These thresholds are visibility policy, not correctness gates.

## Proof

Hosted speed-tooling workflow:
- run `31863565763` — GREEN.

Unit controls prove:
- exact duration arithmetic;
- job-level warning;
- step-level warning;
- malformed timestamp rejection;
- negative duration rejection;
- no-budget means no invented regression.

## Ruling

SPEED-10 is complete. Future slowdowns can now be measured without creating a new false-red route.
