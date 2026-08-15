# GPT EXTERNAL ADVISOR RULING — AR-1177

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / CI + LAUNCH-GATE STATIC AUDIT  
**V4 stage:** SUP / RELEASE SAFETY  
**Status:** RELEASE-AUTHORITY GAP CONFIRMED — PREPARED CONTROL PACKET

## SIMPLE RESULT

At candidate `65a53ea95111a469e2324ba2e9df576f605eca99`, Trading Forge has two different GitHub CI authorities:

### Fast Lane

`.github/workflows/fast.yml`:

```yaml
on:
  push:
  workflow_dispatch:
```

It is intentionally bounded and runs on every push.

### Full CI

`.github/workflows/ci.yml`:

```yaml
on:
  push:
    branches: [main, develop, "hardening/**"]
  pull_request:
    branches: [main, develop, "hardening/**"]
```

It does **not** automatically run on pushes to arbitrary `codex/**`, Claude worker branches, or other engineering branches unless they enter a matching PR target path.

The accepted P0-6 candidate currently lives on:

`codex/p0-6-test-lane-coverage-20260814`

Therefore:

```text
FAST GREEN on a worker branch
!=
FULL CI GREEN for that exact release SHA
```

This distinction must be explicit before any SHA is called release-ready.

---

## WHY THIS MATTERS

Fast Lane is deliberately smaller. It cannot substitute for the full CI graph.

Full CI includes additional authorities such as:

- full Node baseline suite;
- the full-Python advisory surface (AR-1171 proposes making it blocking);
- cross-engine parity;
- build/tsc;
- production-isolation gate;
- prop-firm compliance gate;
- migration immutability;
- gate fault-injection;
- multiple TS/Python parity gates;
- PGlite/schema parity.

A release process that says only "the push was green" can be ambiguous unless it names which workflow and exact SHA supplied launch authority.

---

# SMALLEST SAFE FIX / CONTROL

Do not make every development push run the expensive full suite unless measured capacity justifies it.

Instead establish a **release-SHA full-lane receipt**.

Preferred implementation:

1. Add `workflow_dispatch` to the full `ci.yml` workflow so an exact candidate ref can be intentionally run through full CI before deployment.
2. The release/deployment validator must record:
   - exact candidate SHA;
   - full CI workflow run ID;
   - full CI final conclusion;
   - required job conclusions.
3. A release SHA cannot be promoted merely from Fast Lane success.
4. If the candidate is merged/cherry-picked and SHA changes, the new SHA must earn its own receipt; do not transfer green status from an ancestor SHA.

Alternative acceptable path:

- create a PR into an existing full-CI target branch and require full CI on the **exact commit that will deploy**.

The invariant is exact-SHA evidence, not the UI mechanism.

---

# REQUIRED TEST / NEGATIVE CONTROL

## Negative control

Candidate has Fast Lane green but no full-lane receipt.

Required release verdict:

```text
NOT RELEASE AUTHORIZED
```

## Positive control

Exact candidate SHA has completed required full CI jobs green.

Required release verdict:

```text
FULL_LANE_RECEIPT_VALID
```

## SHA mutation control

Receipt was generated for SHA A.
Release input changes to SHA B, even if B is one commit ahead.

Required:

```text
receipt rejected: sha mismatch
```

This prevents inheriting launch authority from tested-but-not-running code.

---

# RELATION TO AR-1171 / AR-1172

AR-1171 fixes a Python-suite advisory escape inside full CI.

AR-1172 makes the known-failure baseline a real ratchet.

AR-1177 defines **which exact full-CI result is allowed to authorize a release SHA**.

These three together are the CI launch-safety chain.

---

# P0-6

Do not delay AR-1138 or improvise a deployment tonight.

For the already accepted P0-6 candidate, AR-1169 still controls deployment ordering and requires its bounded local/runtime preflight after AR-1138 acceptance.

This report adds the future release-authority invariant; it does not silently reopen P0-6 deployment.

## Bottom line

**CONFIRMED:** worker-branch Fast Lane and full release CI are separate authorities.

**RULE:** no production release from "green" alone. Require a full-lane receipt tied to the exact deployed SHA.