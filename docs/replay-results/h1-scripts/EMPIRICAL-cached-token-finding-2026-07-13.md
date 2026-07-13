# EMPIRICAL FINDING — cached tokens count FULL-WEIGHT against the free cap (2026-07-13)

Operator's OpenAI dashboard screenshot settled the day-one unknown definitively:
- gpt-5.4 showed **262K raw input vs the 250K free-daily line** → billed for the ~12K over = **$0.08**, even though **74% of all input was cache-served**.
- **CONCLUSION: cached tokens count FULL-WEIGHT against the free daily allowance.** The cache does NOT stretch the free cap — it makes calls faster and makes any overage dirt-cheap (~$6.67/1M input at the discounted overage rate; $0.08 for 12K).
- **Our conservative full-weight ledger was exactly right** — no phantom headroom, no surprises. The governor keeps counting full-weight for the free cap; the cache-discount is bill-price only.

## Reconciliation
Our reconstructed ledger read gpt54 = 251,436; the dashboard true metric = 262,000 (delta ~10.6K = input-vs-total accounting + a few pre-ledger calls). The dashboard is ground truth for the free line AND more conservative, so the ledger was set to 262K (never optimistic on a paid lane).

## The $0.08 and the fix
The $0.08 leaked through the blind spot in the hours BEFORE the cross-run ledger shipped (the in-run counter reset per run and couldn't see cumulative daily spend). The persistent ledger now holds the wall across runs → $0.08 becomes $0.00 going forward, UNLESS the operator hands the governor a signed burst ticket.

## Burst ticket (operator-signed, hard-bounded, PROVEN)
`grantBurstTicket`/`evaluateWithBurst` (governor). Today's ticket: gpt54, **250K tokens OR $2.00, whichever first**, freePoolLine 250K, overage $6.67/1M, signed by operator (Tonio: "$2 not $4"), auto-expires at consumption OR UTC midnight → wall reverts to free-only. Bounds PROVEN (trip test: token-cap stops at paid>250K, usd-cap stops at $>2, no-ticket/expired refuse). Paid-so-far 12K=$0.08; headroom 238K (~3-4 videos). Sealed 12 CANNOT be bought at any price (protocol-locked, separate from the 16).

## ADMIN KEY + Costs API (2026-07-13, later)
Operator provided an admin key WITH `api.usage.read` scope → Costs API `/v1/organization/costs` now returns 200 (stored in gitignored `.env` as `OPENAI_ADMIN_KEY`, never committed). BUT it reports **$0 across 35 days** = OpenAI cost-reporting is **T+1 lagged** (no paid usage before today; today's ~$2 posts tomorrow). So the dollar-truth layer is a **DAILY reconciliation (T+1)**, exactly as designed — real-time safety stays the estimate-governor (token full-weight + $-ticket at measured-blend×1.5), and the Costs API corrects the prior day's estimate to actuals. Balance reads $6.30 now (nothing posted); will read ~$4.30 once today finalizes. NOT overclaimed as real-time.

## CORRECTION (2026-07-13) — the $0 was PROJECT SCOPE, not T+1 lag (operator caught it)
My earlier "T+1 lag" claim was WRONG. The org-level `/organization/costs` returns $0 because spend is PROJECT-attributed and must be scoped: `project_ids=proj_lXgrb4JH3KrEPvzhKsXCBX1W` (the "Aspire City" project; there is also a separate empty "Aspire" project). Scoped, the Costs API shows TODAY's spend SAME-DAY:
- **Usage today (Aspire City): 1,246,408 input + 114,808 output = 1.36M tokens.**
- **Billed today: $1.9641.**  →  **remaining balance ≈ $6.30 − $1.96 = $4.34.**
- Reconciliation: actual $1.96 vs estimate-governor's ~$2.16 → estimate erred SLIGHTLY HIGH (conservative, wallet-favoring), exactly as designed. Dollar-truth is REAL-TIME (same-day), not T+1. Governor `fetchOrgCostsUsd`/`remainingBalanceUsd` now default-scope to `ASPIRE_CITY_PROJECT_ID`.

## BALANCE CORRECTION #2 (2026-07-13) — anchor to the operator's dashboard, never guess
I reported balance $4.34 using a GUESSED starting credit ($6.30, a stale mid-session figure). WRONG. Operator's dashboard: **$5.65 remaining**. Reconciles: start-of-today credit $7.61 − today's billed $1.96 = **$5.65**. The $1.96 SPEND (Costs API) was right; the balance was wrong only because the starting-credit input was guessed.
RULE: balance = (operator-CONFIRMED starting credit) − (Costs API spend since). Never infer the starting credit — anchor it to the dashboard. ANCHOR SET: **$5.65 as of 2026-07-13 (post-tonight-spend); forward balance = $5.65 − future Costs-API spend.** Sealed-12 extraction later draws from this $5.65.
