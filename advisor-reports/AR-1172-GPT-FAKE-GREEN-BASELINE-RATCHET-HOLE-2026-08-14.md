# GPT EXTERNAL ADVISOR RULING — AR-1172

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / FAKE-GREEN STATIC AUDIT  
**V4 stage:** SUP / CI SAFETY  
**Status:** SECOND FINDING CONFIRMED — PREPARED FUTURE PACKET

## SIMPLE RESULT

GPT found a second independent false-green class in the frozen test-baseline gate at accepted candidate `65a53ea95111a469e2324ba2e9df576f605eca99`.

The current baseline is **not a true ratchet**.

A test that was once listed as a known failure can:

```text
fail (known baseline) -> CI GREEN
become fixed          -> CI GREEN + only prints BASELINE_SHRINK_NEEDED
break again later     -> CI GREEN because its old failure ID is still allowlisted
```

That means a real **re-regression of a previously fixed test can be hidden indefinitely** if the baseline was not manually shrunk after the fix.

---

## DIRECT CODE PROOF

`ci/compare-baseline.mjs` computes:

- `newFailures`
- `fixedFailures`
- `floorBreached`

but verdict is RED only when:

```text
newFailures.length > 0 OR floorBreached
```

`fixedFailures` does not affect the verdict.

The CLI only prints:

```text
BASELINE_SHRINK_NEEDED=<count>
```

when fixed failures exist, while keeping exit code `0` because verdict remains GREEN.

The committed unit test explicitly locks this behavior in:

```text
"stays green but reports fixed baseline failures"
```

So this is not a theory. The current test suite proves that the comparator intentionally allows a stale baseline after a failure becomes fixed.

---

## WHY THIS IS A FALSE GREEN

Example:

```text
baseline:
  A.test > broker reconnect restores truth = KNOWN FAILURE

Monday:
  test fails
  -> GREEN because known

Tuesday:
  engineer fixes bug
  test passes
  -> GREEN, prints shrink-needed only
  baseline is not forced to change

Friday:
  new commit breaks same behavior
  same test ID fails again
  -> comparator sees old ID as KNOWN
  -> GREEN
```

The second Friday failure is a **new regression in reality** but an **old failure in the static allowlist**.

---

## SEVERITY

**HIGH for launch authority.**

A baseline quarantine is acceptable only if it cannot permanently immunize a test ID after the defect is fixed.

---

# PREPARED SMALLEST SAFE REPAIR

Do not blindly flip the comparator today, because the existing baseline may contain tests that now pass and immediately turning `fixedFailures` into RED could create a large unmeasured wall.

Future bounded packet:

### Step 1 — exact-candidate census

From a clean candidate worktree, generate the canonical Vitest and pytest reports and run the comparator.

Record exactly:

```text
current known failures still failing
fixed baseline failures
new failures
collection counts
```

### Step 2 — shrink baseline truthfully

Remove only baseline entries proven fixed by the exact canonical report.

Do not hand-edit names from prose. Machine output is authority.

### Step 3 — make shrink mandatory

Add a strict ratchet mode, e.g.:

```text
--require-baseline-current
```

Under that mode verdict is RED when:

```text
newFailures > 0
OR collection floor breached
OR fixedFailures > 0
```

Meaning a PR that fixes a quarantined test must also shrink the frozen baseline before CI can be green.

### Step 4 — use strict mode in blocking launch CI

Both canonical blocking baseline comparisons must invoke the strict ratchet mode.

The non-strict comparator may remain available for diagnostic/offline use if needed.

---

# REQUIRED TEST PROOF

Add a three-state regression test:

```text
STATE A
baseline = [old bug]
results = [old bug]
=> GREEN

STATE B
baseline = [old bug]
results = []
strict ratchet
=> RED / BASELINE_SHRINK_REQUIRED

STATE C
baseline shrunk = []
results = []
=> GREEN

MUTATION / RE-REGRESSION
baseline shrunk = []
results = [old bug]
=> RED as NEW FAILURE
```

Also preserve existing fail-closed tests for malformed reports and collection-floor drops.

---

# DO NOT CONFUSE WITH AR-1171

AR-1171 = full Python suite is advisory.

AR-1172 = known-failure baseline can hide a **re-regression after a previous fix**.

They are separate defects and should be separate commits/packets.

---

# ORDERING

No execution before AR-1138 and two-worker activation gates.

This is GPT pre-solving tomorrow's work, not pulling CI implementation ahead of the active semantic gate.

## Bottom line

**CONFIRMED:** baseline comparator is fail-closed for malformed/new failures, but it is not a permanent ratchet because fixed baseline IDs are not forced out.

**Prepared repair:** exact census -> truthful shrink -> strict shrink-required mode -> mutation proof.