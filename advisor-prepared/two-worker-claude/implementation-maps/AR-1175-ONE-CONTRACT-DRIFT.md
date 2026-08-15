# AR-1175 — READY-TO-EDIT MAP

Parent finding: the default quantity-drift tolerance is `1`, and `checkPositionDrift()` only flags when `qtyDrift > tolerance`. Exactly one contract of disagreement can therefore pass as clean.

## Open first

1. `src/server/services/fill-reconciliation-service.ts`
2. `src/server/__tests__/fill-reconciliation.test.ts`

## Exact production seams

```ts
export const DRIFT_TOLERANCE_CONTRACTS = Number(
  process.env.FILL_RECON_DRIFT_TOLERANCE_CONTRACTS ?? 1,
);
```

and inside `checkPositionDrift()`:

```ts
const qtyDrifted = qtyDrift > DRIFT_TOLERANCE_CONTRACTS;
```

## RED first

Add an exact one-contract witness to the existing `fill-reconciliation-service — drift detection` block:

```text
server MES qty = 1
broker MES qty = 0
expected driftDetected = true
```

Also add the signed-short mirror if cheap:

```text
server MES qty = -1
broker MES qty = 0
expected driftDetected = true
```

Focused command:

```bash
npx vitest run src/server/__tests__/fill-reconciliation.test.ts
```

The first new test MUST fail against the pre-fix code.

## Smallest repair

Futures contract quantity truth should default to exact matching:

```text
default quantity tolerance = 0 contracts
```

Keep any intentional operator override explicit. Parse the env safely: an invalid/NaN value must not turn all comparisons false. Prefer a finite, non-negative numeric resolver with fallback `0` rather than raw `Number(...)` if the worker can do this without widening scope.

Do NOT change price tolerance in this packet unless needed only to reuse the same safe parser without semantic change.

## Forbidden detours

- Do not connect a broker network source.
- Do not alter fill accumulation/idempotency.
- Do not redesign `checkPositionDrift()`.
- Do not change PAPER fill behavior.

## GREEN

```bash
npx vitest run src/server/__tests__/fill-reconciliation.test.ts
npm run build
```

Then canonical relevant server lane per `worker-execution`.

## Positive controls

Must still prove:

```text
server 1 / broker 1 -> no drift
server -1 / broker -1 -> no drift
server 1 / broker 0 -> drift
server -1 / broker 0 -> drift
```

## Mutation control

Restore default tolerance to `1`. The exact-one-contract RED witness MUST fail again.

## Expected touched-file boundary

```text
src/server/services/fill-reconciliation-service.ts
src/server/__tests__/fill-reconciliation.test.ts
```

## Completion receipt

RED output, exact tolerance semantics, GREEN output, controls, mutation result, commit SHA, push proof, STOP for GPT review.
