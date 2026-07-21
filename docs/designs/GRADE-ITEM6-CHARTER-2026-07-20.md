# GRADE — TIER-2 ITEM 6 (per-member Slumhouse Office, TEST-MODE) — GRADER CHARTER

**Issued by:** ops-experience advisor. **Status:** READY — fires when the working agent requests the item-6 independent grade (the buildable surface is complete per OA-026; not blocked on the money-path battery, unlike Grade A).
**Dispatch:** FRESH-CONTEXT independent grader (accuracy-validator type; doer≠grader). This file + the two relay ledgers are the brief; grade FROM ZERO.

## Scope — the per-member Office test-mode surface (and nothing else)

Branch `ops/office-rails-20260719`, base `404a3396`. In scope, by commit:
- `8d7f9e43` member-PIN crypto layer (`member-pin.ts`) · `0bf5f161` asymmetric KDF probes
- `322bc2b0` migration **0205** (`slumhouse_member_pins` REAL + `slumhouse_connect_test` TEST)
- `cf2d997c` PIN-ticket HMAC domain separation (`pin-ticket.ts`)
- `21128e04` member-office scope authority (`member-office-scope.ts`)
- `d2dc5fc9` connect-wizard mock validator (`connect-wizard-mock.ts`)
- `f1a75ac1` member office page + floating connect card (markup)
- `0cebdad1` member routes (`/member/pin`, `/member/scope`, `/member/connect-test`)
- `bb9d750e` real-PGlite integration suite · `db366618` pglite-helper comment correction

**OUT of scope:** the liveness wave (that is Grade A — separate charter), the watchdog (Grade-B rider), the green-board truth-test + its fixes (its own unit/grade), rail-3 (design only), anything money-path.

## The claims that MUST hold (re-execute, do not re-read)

1. **Real keys can never be persisted in test mode.** Grep executable code (strip comments first — this check has caught the doer three times): `broker_accounts` has ZERO references in this surface; the integration test proves the table is untouched after a full successful flow. A member connect only ever writes `slumhouse_connect_test`, and only a `testref:` marker — never key material.
2. **The connect validator is an ALLOWLIST, not a blocklist.** It accepts only strings carrying the explicit `TESTKEY-` marker; a real key fails for LACKING the marker, not for being recognized. Re-run: 9 vendor-shaped credentials all rejected, `storableRef: null`.
3. **KDF cost params reach the KDF (symmetric-blindness killed).** Re-execute the known-answer probe: derive a vector with the options DROPPED (Node default N=16384) → it must NOT match the declared-cost record. A symmetric round-trip test alone is structurally blind here — verify the asymmetric probe exists AND fails red when the bug is reintroduced.
4. **PIN ticket domain separation.** A same-secret token minted for a foreign purpose (`slugsession` vs `slumhouse.pin.v1`) must be rejected; prove the purpose tag is INSIDE the MAC (swapping it breaks the signature), not just a string compare.
5. **Cross-member isolation.** A cryptographically VALID pin-ticket belonging to member A must grant member B nothing — safety rests entirely on the ticket-subject == session-subject comparison, and a mismatch writes an audit row. This is the unit's crown proof; run it against real PGlite.
6. **Carter is operator-only BY ROUTE**, not by CSS: zero references in executable page markup (strip comments) AND the scope authority denies it to a member under differently-shaped requests with reason `carter_is_operator_only`.
7. **DB-level enforcement.** Migration 0205's CHECK/FK constraints refuse an invented broker, invented status, and unknown member — application code could be bypassed, these cannot. Confirm 2-pass idempotent replay.
8. **Security posture / claim-scoping.** No key material to any log/audit/response body; PIN-failure response leaks neither closeness nor underlying reason; password input never echoed to the DOM even on failure. Confirm the threat model is stated honestly in-file ("a PIN in front of a mock is a UI affordance, not a security boundary").

## Traps (all pinned/on-disk)

- Bare `npx tsc` OOMs → `NODE_OPTIONS=--max-old-space-size=8192`.
- Do NOT mock the DB for the integration re-run — a mocked DB cannot catch a wrong-table write or a truncating column (the pinned zero-DB-coverage blind spot). Use real PGlite.
- Migration/journal: 0205 is idx 208; the 162→164 discontinuity is the documented 0164 orphan, pre-existing — not a finding.
- The worktree has its own real `node_modules`; never `npm ci`, never touch the canonical tree.
- Clock-read timestamps only; OA headers before OA-025 were estimated (documented).
- This is TEST-MODE family work: band 7–8 is the pre-live ceiling. **Any path that would persist a real key or write `broker_accounts` is an automatic NOT-SAFE regardless of test counts.**

## Deliverable

Banded verdict (7–8 ceiling; 10 unreachable) + per-claim CONFIRMED/refuted with your OWN receipts + RED-proof execution evidence + out-of-scope findings LOGGED-NOT-ADOPTED. The agent files it (or summary+path) as an OA; the advisor rules; landing is FF-only onto the current origin tip after that ruling.
