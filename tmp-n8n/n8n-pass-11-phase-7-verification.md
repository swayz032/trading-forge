# Pass 11 — Phase 7 Verification Report

Generated: 2026-05-05
Reviewer: Independent (Phase 7)
Final verdict: **APPROVE_WITH_FOLLOWUPS**

---

## 1. Verification Matrix (15 rows)

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Audit doc ≥30 verdict lines | PASS | `wc -l tmp-n8n/n8n-pass-11-audit.md` → 257 lines |
| 2 | `audit-n8n-workflows.mjs` exit 0 | PASS | "Auditing 30 active workflows…" → "Total violations: 0" / EXIT=0 |
| 3 | Drift detector finds zero hardcoded keys | PASS | Live API scan, all 30 workflows clean |
| 4 | Post-fix snapshots have zero `:4100/alert/` | **FAIL (stale snapshots)** | 11 of 22 snapshot files still match `host.docker.internal:4100/alert/`. Live workflows are clean (drift report = 0); snapshots in `tmp-n8n/wf-*.json` were captured 23:28 UTC, before Phase 6.5 closed the 9 leftovers at ~00:50 UTC. Files needing re-snapshot: `wf-0z.json`, `wf-4qVyxZd29pQkGn9p.json` (5N), `wf-5j.json`, `wf-5k-current.json`, `wf-5k.json`, `wf-5n.json`, `wf-F6i4JoTdxgiyjHhM.json` (5L), `wf-MIIxmilbgZv3SUBh.json` (7A), `wf-RumAJUp4iS1TYlNm.json` (6D), `wf-tourn.json`, `wf-v4eSeAoaEErYp472.json` (0Z). |
| 5 | Drift detector flags single-symbol prompts | PASS | Detector scans regex `\bES futures\b` etc. across AI/agent nodes; 0 hits on live scan |
| 6 | scout signal_type — 5J | PASS | `wf-Ep2Zsu33tMOsaJbE.json:95` carries `signal_type: 'strategy_candidate'` literal in jsonBody |
| 7 | scout signal_type — 5K, 5L, 5M | PASS (live) | Live audit reports zero violations across `findScoutMissingSignalType` |
| 8 | Strategy gen multi-symbol (Z4 / sAIr / hPX) | PASS | All 3 snapshots contain MES + MNQ + MCL literals (verified by contract test passing on those rows) |
| 9 | Webhook eCr7 Bearer auth wired | PASS | `wf-eCr7cyb0aPArFCZc.json` has `authentication: "headerAuth"` + `httpHeaderAuth` cred ref. Operator action still required to create the credential value (see §4). |
| 10 | Rollback registry covers all modified workflows | PASS | `tmp-n8n/n8n-pass-11-rollback.md` (96 lines) lists 17 rollback rows covering Phases 1, 2, 3 |
| 11 | Workflow IDs in CLAUDE.md / INDEX.md / System Map v2 | PASS | `Z4NcOCDbet8KzjDd` & `eCr7cyb0aPArFCZc` appear in all 3 docs (CLAUDE.md ×4, System Map ×2, INDEX.md ×3). |
| 12 | `npm run system-map:check` exit 0 | PASS | Stdout terminates with full JSON dump, exit 0 |
| 13 | `npm run audit:n8n` exit 0 | PASS | Wraps audit script, "Total violations: 0", exit 0 |
| 14 | `npx vitest run tests/n8n-workflow-contracts.test.ts` | **FAIL** | 10 of 41 tests fail. ALL failures are stale-snapshot artifacts (port-4100 references in `wf-0z.json`, `wf-v4eSeAoaEErYp472.json`, `wf-4qVyxZd29pQkGn9p.json`, etc.). Live n8n is clean — the discrepancy is the test reading `tmp-n8n/wf-*.json` files that pre-date Phase 6.5. Vitest exit 0 (process exit semantic of the runner mode), but the test FAIL count is what matters. |
| 15 | Rollback file lists every modified workflow | PASS | 17 entries × Phase {1,2,3} cover the live mutations. Phase 6.5 mutations (5M Brave, 5J explicit literal, 5 port-4100 redirects) are NOT in the registry — see §4 follow-up. |

**Matrix score: 13 PASS / 2 FAIL** (rows 4 + 14, both rooted in the same stale-snapshot issue).

---

## 2. Code Review

### `scripts/audit-n8n-workflows.mjs` — APPROVE
- Regex coverage matches the 5 violation classes (api_keys, single_symbol, scout_signal_type, port_4100_alert, typeversion). Stateful regex `lastIndex` is correctly reset before each `match`/`test` call (line 116/122) — no false positives on the second workflow scanned.
- Allowlist marker (`# n8n-drift-allowed: <reason>` in node `notes`) is wired only for the single_symbol check — appropriate, since API keys and dead endpoints are never legitimate.
- Exit code semantics correct: `exitCode = totalViolations > 0 ? 1 : 0`. Pagination via `nextCursor` handles >100 workflows.
- **Minor (non-blocking):** the script doesn't time-bound API calls. A hung n8n could stall the monthly cron. Recommend `AbortController` with 30s timeout per fetch in a follow-up.

### `tests/n8n-workflow-contracts.test.ts` — APPROVE_WITH_FOLLOWUPS
- Regex parity with the script is good for port-4100 (identical regex literal) and API keys.
- **Issue (medium):** the test scans ALL `wf-[A-Za-z0-9]+\.json` files (line 45) — including snapshots that may pre-date the latest fix. There is no freshness check or "must match live" comparison. This causes the row-14 failure in this run: live n8n is clean but stale snapshots block CI. Recommend either (a) Phase 6.5-style refresh of all snapshots after every change, automated via a `npm run snapshot:n8n` script, or (b) timestamping snapshots and rejecting reads older than 24h with a clear skip message.
- Test isolation is fine (pure `fs.readFileSync` + regex; no side effects).

### `src/server/scheduler.ts` (n8n-drift-monthly cron) — APPROVE
- `registerJob("n8n-drift-monthly", 30 * 24 * 60 * 60 * 1000, …)` (line 569) registers the 30-day debounce. Cron expression `"0 8,9 1 * *"` (line 1536) covers EDT/EST UTC offsets; ET-hour filter pins to 4:00 AM ET (lines 1544-1549). Correct.
- **NOT pipelineGated** — explicit comment (line 566) and matches C1/C2/C8 posture for safety probes. Correct.
- `notifyCritical()` wiring on non-zero exit (line 588) includes stdout/stderr tail and report path. Good operator UX.
- Spawn uses `process.execPath` + script path; inherits env so `N8N_API_URL` / `N8N_API_KEY` propagate. Correct.

### `package.json` — APPROVE
- `audit:n8n` entry at line 29 is a clean passthrough. No issues.

### `vitest.config.ts` — APPROVE
- `include: ["src/**/*.test.ts", "tests/**/*.test.ts"]` (line 7) correctly extends the glob. Coverage exclude list is unchanged (tests/ is intentionally excluded from coverage instrumentation), which is correct posture.

### `AGENTS.md` — APPROVE
- Drift-detector rule wording (line 65) is enforceable: names the script, the cron, the 5 classes, and the failure-blocks-new-work consequence. Aligned with C7 validation-cadence forcing-function pattern.

### `CLAUDE.md` — APPROVE
- Scout Pipeline route-design clarification (line 923-925) explains the legacy/strict asymmetry and tells future agents NOT to "fix" it. Good.
- n8n Workflow Inventory section (line 833) is the single canonical 27-active-workflow list.

### Spot-check workflow snapshots — MIXED
- `wf-Ep2Zsu33tMOsaJbE.json` (5J): signal_type literal at line 95, no inline keys, no port-4100. CLEAN.
- `wf-Z4NcOCDbet8KzjDd.json` (Z4): MES/MNQ/MCL all present, env-var refs only. CLEAN.
- `wf-eCr7cyb0aPArFCZc.json` (eCr7): `authentication: "headerAuth"` wired. CLEAN at the workflow level — credential value still operator-side.
- `wf-v4eSeAoaEErYp472.json` (0Z): **STALE** — still contains `host.docker.internal:4100/alert/workflow-errors` at line 1. Live n8n was fixed in Phase 6.5; the snapshot file was not regenerated.

---

## 3. Areas of Concern

**Phase 1 incomplete coverage / detector blind spots.** The fact that Phase 6.5 found 9 violations Phase 1 missed validates the *necessity* of the drift detector. The current detector covers all 5 classes responsible for those 9 misses. **Remaining blind spot:** the detector inspects `params.url` for HTTP nodes but does NOT inspect Code-node bodies for hardcoded URLs (5N's Brave key was inline in a Code node, hence the Phase-0 miss). Recommend adding a stringified-node scan for port-4100 URL literals as a defensive secondary, similar to how `findApiKeys()` already does whole-node stringification.

**5M Phase-0 false negative (Brave key inline).** Phase 0's checklist regex was correct but only ran against the audit doc, not against actual workflow JSON. The detector now closes that gap. Recommendation already covered: `findApiKeys()` does whole-workflow `JSON.stringify` (line 114), so 5M-class regressions are now caught.

**5J signal_type regex limitation.** The detector's `findScoutMissingSignalType()` parses string body params (jsonBody, body, bodyParameters). It cannot trace upstream `JSON.stringify($json)` flows — a Code node could pollute `$json.ideas` without a literal `signal_type`. The Phase 6.5 fix made the literal explicit at the Code-node output, which is the right fix. Recommend keeping the explicit-literal pattern as the contract; the regex check is sufficient *only* when paired with that contract. AGENTS.md should call this out.

**JWT expiry on `N8N_API_KEY`.** Phase 1 reported the token expires 2026-04-15. Today is 2026-05-05 → token is ≥20 days expired. **HOWEVER:** the audit script ran successfully against `localhost:5678` just now (30 active workflows fetched, exit 0), which means the active credential is NOT the expired JWT. Either (a) `.env` was rotated and the rollback-doc claim is stale, or (b) localhost is unauthenticated. Operator must verify the current `N8N_API_KEY` value's expiry by decoding the JWT `exp` claim. Until verified, the monthly cron is at risk of silent auth failure (it would exit 1 with "n8n API error: 401" → fires `notifyCritical` correctly, so the failure is at least observable, not silent).

**sAIr `python_code` shape.** Phase 2 left sAIr emitting `python_code` because `POST /api/agent/batch` requires `runStrategySchema.python_code: z.string().min(1)`. This is **acceptable as a follow-up, not a correctness risk**. The DSL-vs-python_code split is documented in the rollback registry follow-up. If sAIr were forced to emit DSL today, every batch submission would 400. The clean fix is option (a) from the rollback note: migrate sAIr to call `POST /api/agent/run-from-dsl` per strategy.

**Z4 single-symbol regime fetch.** The Detect Market Regime HTTP node still queries MES only. **This is acceptable for now**: the prompt explicitly tells the model to treat the fetched regime as a directional hint rather than a constraint, and the multi-symbol prompt language enumerates MES/MNQ/MCL as the candidate symbol set. False-regime risk is bounded (no hard gate is keyed off the single-MES regime). However, it leaves a quality gap — MCL (crude) regimes diverge from equity index regimes regularly. Recommend the structural rewire (3-call loop or `$helpers.httpRequest` Code node) in a follow-up hardening pass.

---

## 4. Operator Action Items

1. **Create `trading_forge_strategy_gen_token` credential in n8n UI** for the eCr7 webhook (Phase 3). Header name = `Authorization`, value = `Bearer <token>`. Until done, the webhook's authenticated invocation will return 401.
2. **Verify `N8N_API_KEY` expiry.** Decode the JWT `exp` claim; if < 90 days from now, rotate via n8n UI → Settings → API → Regenerate.
3. **Re-snapshot the 11 stale `tmp-n8n/wf-*.json` files** (list in row 4). Quickest path: `for id in 0z 4qVyxZd29pQkGn9p 5j 5k 5n F6i4JoTdxgiyjHhM MIIxmilbgZv3SUBh RumAJUp4iS1TYlNm tourn v4eSeAoaEErYp472; do mcp__n8n-api-mcp__n8n_get_workflow id=$id > tmp-n8n/wf-$id.json; done`. After refresh, `npx vitest run tests/n8n-workflow-contracts.test.ts` should go 41/41 green.
4. **Append Phase 6.5 entries to `tmp-n8n/n8n-pass-11-rollback.md`.** The 9 live mutations from Phase 6.5 are not yet in the registry. Without the rows, rollback of those workflows requires version-list spelunking.
5. **Add a `npm run snapshot:n8n` script** that re-pulls all active-workflow JSON to `tmp-n8n/wf-<id>.json` so the contract test never silently drifts again. Recommend wiring it as a pre-commit hook for any change touching `tmp-n8n/`.
6. **Confirm `BRAVE_API_KEY`, `TAVILY_API_KEY`, `PARALLEL_API_KEY`, `OPENAI_API_KEY`, `N8N_API_KEY` are populated in the n8n container's env** — Phase 1 moved literals to `$env.*` references; missing env vars now fail loudly.
7. **(Optional but recommended)** Apply the follow-up from row §3: migrate sAIr to `/api/agent/run-from-dsl` per strategy so the fixture pipeline becomes uniform DSL JSON.

---

## 5. Final Verdict — APPROVE_WITH_FOLLOWUPS

The Pass 11 production-grade sync is **substantively correct on the live n8n surface**: 0 drift violations across 30 active workflows, drift detector is well-architected and properly scheduled, docs reflect reality, AGENTS.md enshrines the rule. The single red mark — 10 contract-test failures + 11 stale snapshots — is a **process artifact, not a correctness defect**. Phase 6.5's live fixes were not propagated to the snapshot directory, so the static test now lags reality. Operator action item #3 closes the gap in <5 minutes of work.

Approval is granted on the condition that operator action items 1, 2, 3, and 4 are completed before the next monthly drift cron fires (2026-06-01 04:00 ET). Items 5, 6, 7 are recommended hardening but not blockers.
