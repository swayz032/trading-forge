# SPEED-11 — Full-CI Build DAG Tail Closeout

Status: **A/B PROVEN / ADOPTION BRANCH CREATED / FULL-CI CERTIFICATION RUNNING**

## Problem

Historical full CI serialized `Build Check` behind:

`needs: [test-node, test-python, test-parity]`

Build checks out fresh, installs its own dependencies, and consumes no artifacts from those test jobs. The dependency created wall-clock tail without adding Build evidence.

## A/B proof

Workflow run: `31863281670`
Frozen subject SHA: `c25c19d6e7ee32c7f8a168ddedd710cfff15d11f`

Candidate path:
- starts Build after the real upstream gate;
- exact Build commands and all parity/schema gates run;
- result GREEN;
- job wall ~117s.

Control path:
- waits for a 120-second simulated unrelated-test tail;
- runs the same Build commands and gates;
- result GREEN;
- job wall ~117s.

Final equality gate:
- candidate GREEN;
- control GREEN;
- proof GREEN.

Every Build check remained present:
- package-lock integrity;
- npm install;
- system map;
- TypeScript build;
- TS/Python exit parity;
- firm-rules parity;
- Tier 1 calendar parity;
- PM size-factor parity;
- stop-geometry parity;
- JSONB contract keys;
- PGlite/schema parity.

## Adoption branch

Branch:
`hardening/gpt-speed-build-dag-adoption-20260814`

Commit:
`95d5b43f04ff9f2e998f2c0dc8e28734ea483b98`

Diff scope:
- one `.github/workflows/ci.yml` dependency edge;
- proof comment only.

Change:
`needs: [test-node, test-python, test-parity]` -> `needs: lint`.

Normal CI certification run:
`31863611329`.

Production/main was not changed.

## Ruling

The dependency-edge optimization is proven at A/B level and isolated in a reversible adoption branch. It does not remove, weaken, or reorder any command inside Build itself.
