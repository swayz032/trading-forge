# GRADE CHARTER — member-Office mount fix + class-guard (`7ad24f2b`)

**Dispatched by:** OPS-campaign ADVISOR (OR-160), 2026-07-21.
**You are:** a fresh-context independent grader. ★ **This fix repairs a GRADE-ESCAPE: item 6 (the member-Office) was independently graded BAND 8 and landed while its entire API was NEVER MOUNTED in production.** The prior grade escaped it because the e2e test built its OWN express app and mounted the router itself — proving the routes work *when mounted*, never that production mounts them. **Do NOT repeat that escape.** Verify PRODUCTION reachability through the real server's router tree, never by mounting the router yourself. Band ceiling 7-8 (pre-live). Secrets: names only.

## Context

Verified from disk: at the landed tip `fe1a84fa`, `memberOfficeRouter` (`src/server/routes/slumhouse/api/member-office.ts:48`, 4 routes) appears only in its own file and in `member-office-crown-e2e.test.ts` (which mounts it itself) — **absent from the `slumhouseRouter` barrel** (`routes/slumhouse/index.ts`), which mounts nine other API routers. Unmounted, `member-office.html`'s fetch of `/slumhouse/api/member/scope` 404s → falls to `express.static` → the page silently renders a permanent "Locked" room. The fix (`7ad24f2b`, on branch `ops/item9a-wip-20260721`; grade in the agent worktree `C:\Users\tonio\Projects\wt-ops-experience-20260719` at HEAD — the agent holds read-only behind a collision bar) imports + mounts the router in the barrel and adds `slumhouse-routers-mounted.test.ts` as a class-guard. The four now-activated routes are member-facing auth routes: `pin/establish`, `pin`, `scope`, `connect-test`.

## Verify each by your OWN executed adversarial input

1. **The mount is real and the routes are reachable via the PRODUCTION wiring — not a self-built app.** Confirm the barrel imports AND mounts `memberOfficeRouter`, and trace that the real server mounts `slumhouseRouter` so the four routes are reachable end-to-end in production. Reproduce the ORIGINAL failure on `fe1a84fa` (fetch `/slumhouse/api/member/scope` against the real router tree → 404) and confirm the fix makes it reachable. If you build your own app and `app.use` the router, you have re-created the exact blind spot — do not.

2. **★ The class-guard actually guards, and could not itself go vacuous.** `slumhouse-routers-mounted.test.ts` must: (a) read the barrel as TEXT and NEVER construct an app; (b) assert every `export const *Router` under `routes/slumhouse/api` is BOTH imported and mounted in the barrel; (c) have a non-vacuity check that fails if the router list comes back empty (the classic "guard stops guarding after a rename"); (d) require a written reason for anything in a `DELIBERATELY_UNMOUNTED` allowlist. Mutation-test it yourself: unmount a router → RED; comment the mount out → RED; empty/rename the scanned dir so the list is empty → RED (non-vacuity). Confirm it would have caught the original `memberOfficeRouter` defect.

3. **★ HUNT BEYOND — is any OTHER slumhouse router unmounted, or any office page calling a dead URL?** Independently enumerate every `export const *Router` under `routes/slumhouse/api` and confirm each is imported AND mounted in the barrel — do not trust the guard's own list, build your own. Then sweep the office HTML pages (`public/slumhouse/*.html`) for `fetch("/slumhouse/api/...")` and confirm each URL maps to a mounted route. A second unmounted router, or a page fetching a dead endpoint, is the sibling this class exists to surface.

4. **★ The four NEWLY-ACTIVATED auth routes are SOUND — additive-fix-activates-dead-path.** These routes were DORMANT (never reachable), so their auth and behavior were never exercised in production; activating them is activating dead code. Attack them with your own inputs: `scope` — does it scope strictly to the authenticated member (no cross-member surface leak, the item-7 privacy class)? `pin/establish` + `pin` — proper member auth, no cross-member PIN set/read, fail-closed? `connect-test` — TEST-mode only, no live broker call, no real credential persisted (the charter's hard law)? Confirm the auth middleware actually runs on each (an unauthenticated `pair/*`-style hole would be worst here).

5. **Activation woke no latent bug.** The author reports 102/102 across 8 suites. Independently confirm mounting these routes conflicts with no existing route, changes no existing behavior, and the office pages that now reach a live API render correctly (not a new error path).

## Also

- Regression floor with a stub-immune instrument (`node node_modules/typescript/bin/tsc`, 8GB heap — never `npx tsc`); real `test:scripts` count. Guardrails: the diff (`7ad24f2b`) touches ops-lane files only (barrel + guard test + the router's mount) — 0 money-path/gate/instrument code edits; $0.
- Note the CRLF trap (an editor rewriting a whole HTML/JS file); confirm the diff is minimal (author reports 13/0), not a whole-file rewrite.

## Verdict

Per item closed/not-closed with the input you ran; EVERY unmounted sibling, dead office-page URL, or cross-member/auth hole in the four activated routes; whether the class-guard is genuinely non-vacuous; band + SAFE-TO-LAND / NOT-SAFE; one-line bottom line. An unmounted sibling, a cross-member leak or unauth hole in the activated routes, or a class-guard that can go vacuous is NOT-SAFE.
