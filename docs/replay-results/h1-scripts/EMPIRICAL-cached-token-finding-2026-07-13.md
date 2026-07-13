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
