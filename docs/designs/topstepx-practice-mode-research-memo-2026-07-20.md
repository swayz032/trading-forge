# TOPSTEPX PRACTICE-MODE RESEARCH MEMO (R-062 #5 staging) — 2026-07-20

> **Status: STAGING MEMO, not a frozen instrument.** Facts researched live 2026-07-20 (sources below); ALL claims get re-verified against live TopstepX/ProjectX state at adapter-build time — that re-verification IS the R-062 #5 check this memo stages. Web research only; no purchases, no account actions taken.

## §1 WHAT EXISTS (verified from current public sources)

1. **The Practice Account is FREE — but only WITH an active Trading Combine subscription.** $150K simulated balance, live market data, 15-lot max, unlimited free resets, no penalties. It deactivates if the Combine subscription lapses (an Express Funded Account alone does not qualify). Source: Topstep Help Center.
2. **API access = ProjectX API subscription, $14.50/mo with code "topstep"** (TopstepX Settings → ProjectX Linking). Required for any programmatic trading regardless of account stage. Source: PickMyTrade Topstep API guide, ProjectX API page.
3. **★ 2026 structural fact: ProjectX ended ALL third-party prop-firm licensing 2026-02-28 and is now Topstep-exclusive.** ProjectX technology exists only as TopstepX; the ProjectX Dashboard survives solely as the API-subscription portal. Implication: the API is a FIRST-PARTY Topstep rail now — no third-party-platform licensing risk under our operator-lane decision (R-052: TopstepX direct, no TradersPost for the operator).
4. **A demo Swagger gateway exists** (`gateway-api-demo.s2f.projectx.com`) and the community SDK exposes live/sim environment flags (`live=True/False` on contract search) — the API surface distinguishes environments.
5. **Practice, eval (Combine), and funded accounts all run on the SAME TopstepX platform + API surface** — sim accounts are added/switched inside the same dashboard and platform.

## §2 WHAT THIS UPDATES (the R-062 #5 premise, sharpened)

R-062 #5 asked: "if free/cheap practice exists, real-fill evidence arrives pre-Combine." The 2026 answer restructures that:
- **Practice is not free-standalone — it is free-WITH-Combine.** There is no practice evidence "pre-Combine" in the purchasing sense; practice evidence begins the day the first Combine subscription starts.
- **That is GOOD for our sequence, not bad:** one Combine purchase (operator's R-060 decision, when funds allow) simultaneously opens (a) the practice sandbox for ADAPTER CERTIFICATION (test-mode order round-trips against the real API with zero eval risk and unlimited resets), and (b) the eval itself on the same rails. The adapter certifies on practice, then the SAME code path carries eval → funded. The "pre-positioned last mile" (Blueprint Phase 3) costs one Combine + $14.50/mo API.
- **Honesty line: practice fills are SIMULATED fills on live data.** Decision-grade for adapter correctness, order lifecycle, and strategy behavior; NOT truth about live slippage — the slippage_survival gate remains the slippage guard. No claim upgrade.

## §3 THE ONE QUESTION THAT NEEDS LIVE CREDENTIALS (queued for adapter-build)

**Can the Gateway API place orders on the Practice Account specifically** (not just eval/funded accounts)? Public docs 403'd on deep pages; the SDK shows environment flags but no explicit practice-account order example. This is answerable in minutes WITH an API subscription + Combine login — which exist only after the operator's purchase. → Queued as the FIRST check of the adapter build: authenticate, enumerate accounts (practice account should appear with a sim flag), place + cancel one far-from-market limit order on the practice account, receipt the round-trip. If practice-account API trading turns out NOT to be supported, fallback evidence path = eval account itself with far-from-market orders before any real signal routes (bounded risk, operator-armed as always).

## §4 ADAPTER-BUILD CHECKLIST STAGED (so R-062 #5 fires mechanically later)

1. Re-verify §1 facts against live state (pricing, bundle terms, exclusivity — terms move; the operator's live screenshot governs over any doc, per the R-056 precedent).
2. Run the §3 practice-account API round-trip; receipt it.
3. Confirm rate limits + websocket market-data entitlements on the API subscription tier.
4. Confirm practice-account fill semantics (matching model) for the paper-parity notes.
5. Operator holds: the Combine purchase decision (R-060: when funds allow), the API subscription, and the arming key — nothing in this memo changes the go-live gates.

**Sources:** [Topstep Help Center — Practice Account](https://help.topstep.com/en/articles/8284134-practice-account) · [TopstepX platform page](https://www.topstep.com/topstepx) · [ProjectX API](https://www.projectx.com/api) · [ProjectX Gateway API docs](https://gateway.docs.projectx.com/docs/intro/) · [PickMyTrade: Topstep API Access Guide 2026](https://docs.pickmytrade.io/docs/connect-projectx-to-topstep-api/) · [rundef/projectx-api SDK](https://github.com/rundef/projectx-api) · [h2tfunding: TopstepX add simulation account](https://h2tfunding.com/topstepx-how-to-add-simulation-account/)

*Authored by the money-path advisor (Fable) under R-062 #5 staging; noted in R-077. The #5 carry stays OPEN until the adapter-build check runs live.*
