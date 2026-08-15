# SPEED-07 — Cross-Engine Parity Dependency Slimming Closeout

Status: **PATCH PROVEN AT JOB LEVEL ON TWO SUBJECTS / FULL-CI CERTIFICATION RUNNING**

## Problem

The `Cross-Engine Parity (A3)` job runs only:

`pytest src/engine/tests/test_cross_engine_parity.py -v --tb=short -x`

The old job nevertheless installed `src/engine/requirements.txt`, pulling the full engine/ML/quantum dependency estate.

The exact parity test path uses the bounded parity stack already represented by `ci/requirements-fast.txt`.

## Earlier A/B proof

Same-commit proof showed:
- untouched heavy parity job: `199s`;
- bounded dependency proof job: `76s`;
- test census: `35 passed / 0 failed / 0 skipped`.

## Real current-main-derived patch

Branch:
`hardening/gpt-speed-parity-adoption-20260814`

Commit:
`73ebad1c1fc88388fb5af4b7fe1ada938c3e3fc9`

Diff scope:
- `.github/workflows/ci.yml` only;
- 5 changed lines;
- test command unchanged.

Observed parity job:
- CI run `31863381616`;
- job GREEN;
- ~100s wall;
- exact census `35 passed in 7.41s`;
- no test removed or skipped.

## Frozen historically-green subject proof

Base subject:
`c25c19d6e7ee32c7f8a168ddedd710cfff15d11f`

Branch:
`hardening/gpt-speed-parity-greenproof-20260814`

Commit:
`f0695a9e0a99dd5d73be2503ea33ac92a76597e6`

Observed parity job:
- CI run `31863460674`;
- job GREEN;
- ~114s wall;
- same parity command unchanged.

## Adoption rule

Do not merge by prose. The isolated branch is the candidate. Full CI must finish without a change-attributable failure before final production adoption.

Main/production remains unchanged.
