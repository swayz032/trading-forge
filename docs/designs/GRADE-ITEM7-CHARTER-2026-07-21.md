# GRADE CHARTER — item 7 Anam greeting from receipts (`75b6bcf5`)

**Dispatched by:** OPS-campaign ADVISOR (OR-138), 2026-07-21.
**You are:** a fresh-context independent grader. Do NOT trust the author's tests. On this campaign, author self-verification has missed a sibling on EVERY prior unit — RED-proofs cluster where the author's tests already look, and fixes leave siblings open — caught only by a grader that constructed its OWN adversarial inputs and HUNTED BEYOND the named findings. Author-green is not evidence. Band ceiling 7 (pre-live). Secrets: names only, never values.

## Context

Item 7 wires a personalized greeting from EXISTING receipts into the Slumhouse per-member Office. Commit `75b6bcf5` on `hardening/phase-0` (worktree `C:\Users\tonio\Projects\wt-ops-experience-20260719`; grade from the committed SHA in your own checkout/clone to avoid collision — the working agent holds read-only behind a collision bar). Built against mock/TEST data; deploys only at the money path's Phase 5.

The route is `GET /slumhouse/api/anam-greeting` — the author states it SELECTs only, renders the trade-critique service's own `PlainEnglishSummary` words (grade/one_liner/what_went_right/what_to_watch/action_needed) without paraphrase, and scopes receipts to the signed-in member via `slumhouse_users.broker_account_id` (null until the operator manually maps a friend). Fail-closed: no row / `broker_account_id IS NULL` → zero receipts + generic welcome; mapped → only rows `WHERE account_id = that id`; deliberately NO "otherwise show recent activity" branch. Author RED-proofed by planting the unmapped→aggregate fallthrough (2 privacy tests failed; restored → 7/7) and asserts the strongest form: `readCritiques` is never CALLED without a real account id. Author also caught two wiring defects (Express `next` landing in the injectable `deps` slot; `db/index` load-time throw forcing live-postgres-only tests → made readers lazy + fake URL).

**This is a tenant-isolation surface between family members. A single cross-member leak path is NOT-SAFE.**

## Verify each by your OWN executed adversarial input

1. **The privacy leak — the item itself.** Construct your OWN multi-member scenario (member A mapped to account α; member B mapped to β; member C unmapped). Execute the route as each and confirm: A sees ONLY α's receipts, never β's or C's; C (unmapped) sees the generic welcome and ZERO receipts. Do not re-run the author's tests as proof — write your own. Then test the author's strongest claim by mutation: force a path where `readCritiques` could be reached without a validated account id — can you? "A call that never happens cannot leak" is only true if there is NO reachable path to the call without the guard.

2. **★ HUNT BEYOND — the sibling reader. This is why you are here.** The charter item 7 names TWO receipt sources — *"the trade-critique service's plain-English blocks; **certificate plain-language chains**"* — and a *Q&A*, not just a greeting. Sweep `75b6bcf5` for EVERY data reader on the greeting/Q&A path. If certificate chains (or any other receipt/critique/certificate reader) are surfaced, is each scoped to the current member with the SAME fail-closed rule, or is one left unscoped? A second reader scoped weaker than the first is the exact leg-2/leg-3 sibling pattern. If certificate chains and Q&A are NOT built, that is a SCOPE question (item 7 partial) — is the omission honestly declared/reserved, or silently dropped as if item 7 were complete?

3. **Auth / identity source — the spoof surface.** Trace where the "signed-in Discord id" comes from. Is it derived from an AUTHENTICATED session/cookie the member cannot forge, or is it read from a client-supplied param/header/body a member could set to ANOTHER member's Discord id? A perfect `WHERE account_id = ...` scope over a spoofable identity is a leak dressed as isolation. Execute a request supplying a foreign id and see what you get back.

4. **The `account_id` match.** Is the comparison exact and type-safe, or could coercion / a loose SQL predicate / a null-or-empty account id match more than the one intended account (e.g. `account_id = ''` matching test rows, or `IN`/`LIKE` breadth)?

5. **Read-only, verified.** Does the route (and everything it calls) write ANYTHING — INSERT/UPDATE/DELETE, upsert, or a side-effecting log that persists receipt content? The charter says read-only consumer.

6. **The RED-proof's proposition + captions.** Does the author's RED-proof prove the ABUSE shape (cross-member leak) or merely the load-bearing shape (data appears)? Do any comments or the commit message claim more than the mechanism delivers ("never leaks", "governs", "scoped") — an overclaim one field over from correct logic is this campaign's signature residual.

## Also

- **Regression floor with a stub-immune instrument.** tsc is LOAD-BEARING here (item 7 adds a `.ts` route in tsconfig scope — NOT vacuous). Run tsc via the DIRECT path (`node node_modules/typescript/bin/tsc`, `NODE_OPTIONS=--max-old-space-size=8192`), NEVER `npx tsc` (the `.bin` troll-stub returns a false green). Report the real `test:scripts` count and whether the privacy tests are in it.
- **Guardrails:** confirm the diff `efdc94a8..75b6bcf5` touches ops-lane files only — 0 money-path / gate / instrument files; no live broker call; no production DB read/write (mock/test only); $0.

## Verdict

Per item closed / not-closed with the adversarial input you ran; EVERY cross-member leak path or unscoped sibling reader you found; whether item 7 is complete or a partial slice (and if partial, whether honestly declared); overall band + SAFE-TO-LAND / NOT-SAFE; one-line bottom line. A single cross-member leak path, a spoofable identity, or a second unscoped reader is NOT-SAFE.
