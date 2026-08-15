# AR-1178 — READY-TO-EDIT MAP

Parent finding: production can accept `AUTH_DEV_BYPASS=true` even though the middleware contract says the bypass is local-dev only.

## Open first

1. `src/server/middleware/auth.ts`
2. `src/server/__tests__/auth-middleware.test.ts`
3. Optional boot-warning reuse only if needed: `src/server/lib/startup-config-check.ts` + its existing tests.

## Exact production seam

`authMiddleware()` currently ends with:

```ts
if (process.env.AUTH_DEV_BYPASS === "true") {
  next();
  return;
}
```

That branch ignores `NODE_ENV`.

## RED first

Extend `src/server/__tests__/auth-middleware.test.ts` with production-path cases:

```text
NODE_ENV=production + AUTH_DEV_BYPASS=true -> MUST NOT call next()
NODE_ENV=development + AUTH_DEV_BYPASS=true -> may call next()
NODE_ENV=development + flag absent -> MUST NOT bypass
```

Existing test `AUTH_DEV_BYPASS=true allows (explicit dev only)` currently runs with `NODE_ENV=production`; change it into the RED production-refusal witness rather than preserving the unsafe expectation.

Focused command:

```bash
npx vitest run src/server/__tests__/auth-middleware.test.ts
```

## Smallest repair

Make bypass authorization require BOTH:

```text
AUTH_DEV_BYPASS == true
AND
NODE_ENV == development
```

Do not introduce an implicit `NODE_ENV=development` bypass. The explicit flag must still be required.

If a boot-time warning/refusal is added, reuse `startup-config-check.ts`; do not create another environment/config subsystem. Request-time refusal is the minimum capital/security fix.

## Forbidden detours

- Do not weaken Bearer/API-key checks.
- Do not alter self-HMAC admin-route exemptions.
- Do not create a second auth middleware.
- Do not add a generic production auth bypass under another env name.

## GREEN

```bash
npx vitest run src/server/__tests__/auth-middleware.test.ts
npm run build
```

Then run the canonical relevant server/CI lane required by `worker-execution`.

## Negative control

Temporarily mutate the repaired condition back to `AUTH_DEV_BYPASS === "true"` only. The production refusal test MUST fail.

## Expected touched-file boundary

Preferred minimum:

```text
src/server/middleware/auth.ts
src/server/__tests__/auth-middleware.test.ts
```

Only touch `startup-config-check.ts` and its existing tests if the active order explicitly requires a boot-time configuration witness.

## Completion receipt

Report exact RED command/output, patch boundary, GREEN command/output, negative-control result, commit SHA, push proof, then STOP for GPT review.
