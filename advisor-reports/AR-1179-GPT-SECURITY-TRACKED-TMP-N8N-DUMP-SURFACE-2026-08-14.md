# GPT EXTERNAL ADVISOR RULING — AR-1179

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / SECURITY STATIC AUDIT  
**V4 stage:** AR / SECURITY  
**Status:** HIGH SECURITY HYGIENE FINDING CONFIRMED — SECRET VALUE NOT COPIED

## SIMPLE RESULT

At accepted candidate `65a53ea95111a469e2324ba2e9df576f605eca99`, the repository still tracks a large operational scratch/dump directory:

`tmp-n8n/`

This conflicts with the repository's own `.gitignore` security policy, which explicitly says ad-hoc n8n workflow graph dumps expose node bodies, relay endpoints, and HMAC scheme details and should not be committed.

More importantly, the tracked file `tmp-n8n/audit-scan-out.json` records at least one workflow snapshot with:

```text
hardcodedTokens: 1
```

The scanner source defines that metric as a hardcoded `Bearer <long token-like value>` pattern found in HTTP node parameters rather than an environment/credential reference.

GPT did **not** retrieve, reproduce, or store the token value.

This evidence does NOT prove the token remains valid/live today. It proves that the committed operational snapshot set contains, or at minimum contained at scan time, a token-like hardcoded credential pattern and therefore must be treated as a sensitive repository-history surface.

---

## VERIFIED EVIDENCE

### Repo policy already says operational dumps should not be tracked

`.gitignore` currently protects:

- `.env`
- `.env.*` except `.env.example`
- `.bw-session-runtime`
- `.cookie-runtime-*`
- several n8n dump patterns such as `*all-wf.json`, `wf_full/`, `wf_live*.json`

and explicitly documents that operational n8n dumps leak attack-surface details.

However, it does not ignore `/tmp-n8n/`.

### `tmp-n8n/` is committed at the accepted candidate

GitHub lists many committed operational artifacts under that directory, including workflow JSON snapshots, aggregate exports, scanner scripts/results, and credential-repair tooling.

### Tracked scanner itself looks for hardcoded Bearer tokens

`tmp-n8n/audit-scan.mjs` scans serialized HTTP node parameters for a token-like pattern and increments `hardcodedTokens` when it is not represented as an environment/credential expression.

### Tracked scan output records a hit

`tmp-n8n/audit-scan-out.json` records at least one workflow entry with `hardcodedTokens: 1`.

No credential value is needed for this ruling.

---

## SEVERITY

**HIGH immediately; CRITICAL if the matched credential is confirmed still valid.**

Repository deletion alone is not credential revocation because Git history preserves prior blobs.

---

# REQUIRED RESPONSE / SMALLEST SAFE PACKET

Do not mass-delete blindly before inventorying canonical artifacts.

### Step 1 — local secret scan, value-safe output

From a clean local clone with appropriate secret-scanning tooling, scan:

```text
tmp-n8n/
workflows/n8n/
repository history for the affected token pattern classes
```

The receipt must record only:

- finding type;
- file/path;
- commit(s);
- live/expired/unknown disposition;
- rotation required yes/no;

Never paste token values into reports, logs, GPT, Claude, or GitHub issues.

### Step 2 — if any credential could still be valid, rotate first

If the matched token maps to a real service credential and validity cannot be disproven:

```text
ROTATE / REVOKE FIRST
THEN clean repository surface
```

Do not rely on file deletion as remediation.

### Step 3 — quarantine/remove operational scratch artifacts

Determine which `tmp-n8n/` artifacts are canonical source versus disposable evidence.

- canonical sanitized workflow backups belong only in the approved tracked workflow location;
- operational exports, scratch scripts, live snapshots, audit outputs, and credential repair scratch should leave the tracked source tree.

Add:

```text
/tmp-n8n/
```

to `.gitignore` unless an explicitly sanitized subpath must remain tracked.

### Step 4 — add a repository guard

Add a blocking guard that rejects new committed files matching operational dump/scratch patterns, with a narrow allowlist for approved sanitized fixtures.

The guard must inspect tracked paths, not only working-tree ignores.

### Step 5 — history decision

If an actually live credential is confirmed to have existed in Git history:

- rotation/revocation is mandatory;
- then decide whether repository history rewrite is required based on exposure/sharing risk.

History rewrite is secondary to rotation and must not be done casually on active branches.

---

# REQUIRED TESTS / CONTROLS

## Path guard RED

Add a disposable tracked sentinel:

```text
tmp-n8n/secret-looking-dump.json
```

Guard must fail.

## Allowed canonical control

An approved sanitized workflow fixture/back-up in the canonical allowed location must pass.

## Secret-value negative control

The scanner/reporting layer must redact or hash findings; test fixtures must use fake tokens only.

## History-control receipt

If history scan finds credential material, receipt contains metadata/disposition only, never the secret bytes.

---

# DO NOT CONFUSE WITH LIVE N8N STATE

Codex independently inspected the live Railway n8n through API/MCP authority and repaired the healthy/no-op watchdog path.

This AR does not claim the committed `tmp-n8n/` snapshot equals today's live Railway configuration.

This finding is specifically:

> sensitive operational n8n dump/scratch material is committed in Git, and the committed scan output itself records at least one hardcoded Bearer-token-pattern hit.

---

# GATES

- Never publish token values.
- Do not activate broker/network execution.
- AR-1138 remains first semantic gate.
- Security rotation, if a live credential is confirmed, is an exception that should happen immediately and does not require waiting for AR-1138 because credential revocation is containment, not feature implementation.

## Bottom line

**CONFIRMED:** `/tmp-n8n/` is a tracked operational-dump surface contrary to repo policy, and its own committed scanner output records a hardcoded token-pattern hit.

**Next safe action:** value-safe local/history scan -> rotate/revoke if validity is possible -> remove/quarantine scratch artifacts -> ignore + CI guard.