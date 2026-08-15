# GPT EXTERNAL ADVISOR RULING — AR-1175

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / POSITION RECONCILIATION STATIC AUDIT  
**V4 stage:** AR / EXECUTION SAFETY  
**Status:** HIGH FINDING CONFIRMED — PREPARED FIX PACKET

## SIMPLE RESULT

At accepted candidate `65a53ea95111a469e2324ba2e9df576f605eca99`, the default server-vs-broker **quantity drift tolerance is 1 contract** and drift is only declared when the absolute difference is **greater than** that tolerance.

Therefore, unless production overrides the environment value:

```text
server position = +1 MES
broker position = 0 MES
absolute difference = 1
1 > 1 = false
=> NO DRIFT DETECTED
```

The same blind spot applies to MNQ/MCL or any other contract-counted futures symbol.

For broker position truth, a one-contract quantity mismatch is not noise. It is real exposure.

---

## DIRECT CODE PROOF

`src/server/services/fill-reconciliation-service.ts`:

```ts
export const DRIFT_TOLERANCE_CONTRACTS = Number(
  process.env.FILL_RECON_DRIFT_TOLERANCE_CONTRACTS ?? 1,
);
```

Later:

```ts
const qtyDrift = Math.abs(serverNetQty - params.brokerPositionQty);
const qtyDrifted = qtyDrift > DRIFT_TOLERANCE_CONTRACTS;
```

So the default boundary is exact and deterministic.

The existing test suite proves only a 2-contract divergence as the positive quantity-drift case:

```text
server 3
broker 1
drift 2 > tolerance 1
=> drift detected
```

There is no boundary test proving server 1 vs broker 0 blocks.

---

## SEVERITY

**HIGH / launch-blocking before real broker execution.**

The purpose of position reconciliation is to detect disagreement in exposure. Contract quantity is discrete. A difference of one means one side believes a position exists that the other side does not.

For micro futures, one contract still carries real P&L and drawdown risk.

---

# SMALLEST SAFE FIX

Do not redesign fill reconciliation.

1. Make quantity reconciliation exact by default:

```text
FILL_RECON_DRIFT_TOLERANCE_CONTRACTS default = 0
```

2. Keep an explicit environment override only if a future broker proves there is a legitimate snapshot-lag use case, but a launch configuration for MES/MNQ/MCL must use zero unless a broker-specific evidence packet authorizes otherwise.

3. Validate the configured value:
   - finite;
   - non-negative;
   - contract-count compatible.

4. Quantity mismatch detection remains:

```text
abs(serverQty - brokerQty) > tolerance
```

with tolerance zero for exact futures position truth.

5. Do not change the separate average-price tolerance in this packet. Price can legitimately differ because of actual fills/slippage; quantity is the critical blind spot here.

---

# REQUIRED TESTS

## Boundary RED proof

Current candidate:

```text
server +1
broker 0
expected safety result = DRIFT
current result = NO DRIFT
```

Also:

```text
server -1
broker 0
expected = DRIFT
current default = NO DRIFT
```

## GREEN proof

After default-zero fix:

```text
server +1 / broker 0 => DRIFT
server -1 / broker 0 => DRIFT
server 0 / broker +1 => DRIFT
server 0 / broker -1 => DRIFT
server +1 / broker +1 => CLEAN
server -1 / broker -1 => CLEAN
```

## Multi-contract control

Existing 3-vs-1 positive test must remain RED/drift.

## Config mutation control

Set `FILL_RECON_DRIFT_TOLERANCE_CONTRACTS=1` in an isolated test and prove the old blind spot returns. This demonstrates the launch configuration itself matters and allows a launch guard to enforce zero for futures if desired.

---

# RELATION TO CODEX WORK

Codex already completed substantial **offline Topstep position/reconnect logic**. Do not redo it.

This finding is in the existing generic `fill-reconciliation-service.ts` server-vs-broker drift gate and is independently visible in current GitHub source.

---

# GATES

- Server-mediated execution remains flag OFF by default.
- Topstep network remains closed.
- No live broker call is needed to fix or test this boundary.
- AR-1138 remains first semantic priority.

## Bottom line

**CONFIRMED:** default quantity reconciliation can miss exactly one contract of real position drift.

**Prepared repair:** make futures quantity truth exact by default (`0` contract tolerance) and add ±1 boundary tests.