# GPT EXTERNAL ADVISOR RULING — AR-1178

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / SECURITY STATIC AUDIT  
**V4 stage:** AR / SECURITY  
**Status:** CRITICAL CONFIGURATION FINDING CONFIRMED — PREPARED FIX PACKET

## SIMPLE RESULT

At accepted candidate `65a53ea95111a469e2324ba2e9df576f605eca99`, `AUTH_DEV_BYPASS=true` bypasses API authentication **without checking `NODE_ENV` or runtime stage**.

The source comment says this flag is for explicit local development and should never be present in production, but the code does not enforce that statement.

Current behavior:

```text
production process
+
AUTH_DEV_BYPASS=true by mistake
        ↓
request has no Bearer key/cookie
        ↓
authMiddleware calls next()
        ↓
auth gate bypassed
```

Because the repo itself warns that a Railway relay can expose localhost traffic publicly, production safety cannot depend on an operator remembering never to set the flag.

---

## DIRECT CODE PROOF

`src/server/middleware/auth.ts` documents:

```text
AUTH_DEV_BYPASS=true (explicit local dev — never in prod .env)
```

but actual gate is only:

```ts
if (process.env.AUTH_DEV_BYPASS === "true") {
  next();
  return;
}
```

There is no production/stage condition around it.

The existing auth test sets `NODE_ENV="production"` in `beforeEach()` and then contains:

```ts
it("AUTH_DEV_BYPASS=true allows (explicit dev only)", ...)
```

Inside that test it sets only `AUTH_DEV_BYPASS=true`; it does **not** change NODE_ENV away from production.

So the current unit test actually proves the unsafe production combination is accepted.

---

## SEVERITY

**CRITICAL configuration trap before exposed production use.**

This is not a secret-value leak. It is an authentication-control bypass that can be enabled by one environment-variable mistake.

---

# SMALLEST SAFE FIX

Make the bypass impossible in production/preprod runtime authority.

Preferred contract:

```text
AUTH_DEV_BYPASS=true
AND
NODE_ENV !== production
AND
TF_RUNTIME_STAGE is explicitly local/dev/test
```

or an equivalently strict centralized environment predicate.

Do not rely on `NODE_ENV=development` alone as automatic trust. The existing comment correctly says localhost can be relayed publicly. The bypass must require an **explicit local-only stage**, not merely a generic development mode.

Recommended shape:

```text
isExplicitLocalAuthBypassAllowed()
```

with one source of truth shared by middleware/startup checks.

Additionally, boot should fail closed or emit a launch-blocking error if:

```text
AUTH_DEV_BYPASS=true
AND runtime stage is production/preprod
```

Failing boot is preferred over silently ignoring a dangerous contradictory configuration because it makes the misconfiguration impossible to miss.

---

# REQUIRED TESTS

## RED proof — current candidate

```text
NODE_ENV=production
TF_RUNTIME_STAGE=production (or production-equivalent)
AUTH_DEV_BYPASS=true
no API key/cookie
=> current middleware allows next()
```

## GREEN matrix

Must reject bypass:

```text
production + AUTH_DEV_BYPASS=true
preprod + AUTH_DEV_BYPASS=true
unknown stage + AUTH_DEV_BYPASS=true
```

May allow only an explicitly authorized local test/dev matrix.

## Mutation control

Remove the runtime-stage condition from a test fixture / mutate predicate to `AUTH_DEV_BYPASS === true` only.

Security test must fail.

## Startup control

Production/preprod boot with the bypass set must not become a healthy serving process.

---

# DO NOT BREAK SELF-HMAC RECOVERY ROUTES

The special POST recovery routes that bypass the Bearer middleware because they authenticate themselves with their own HMAC are a separate design and must remain covered by their exact allowlist + replay/HMAC tests.

Do not "fix" AR-1178 by removing those routes from their self-authenticated path.

---

# GATES

No credential values are required or recorded in this packet.
No broker network access is required.
AR-1138 remains first semantic gate.

## Bottom line

**CONFIRMED:** the comment says dev-only, but the code and test permit `AUTH_DEV_BYPASS=true` while NODE_ENV is production.

**Prepared repair:** explicit local-only authority + production/preprod boot rejection + mutation test.