# Go-Live Gate Register (Appendix C)

**STATUS: STAGED — nothing here is implemented. This is a checklist, not a build plan.**

Authored 2026-07-18 as part of the "$250–$1K/day Readiness" campaign's W7 close-out (operator decision D10). This register captures verified-real, pre-live findings from the 2026-07-15 external production-readiness audit (`Trading-Forge-Institutional-Production-Readiness-Audit-2026-07-15.md`, 45 findings) while the evidence is fresh — before anything in it is built.

## What this gates

This is the checklist that gates the **FIRST live order** to a real broker (Topstep or MFFU) — it is **Certification 2 (Live-Execution-Ready)**, not the strategy lifecycle and not the "$250-1K" campaign itself.

- **Certification 1 (Lifecycle/Pipeline-Ready)** — delivered by the campaign this register closes out: a strategy can flow Backtest → Replay → SHADOW → PAPER → (qualification) with TRUE evidence, fail-closed promotion, deterministic durable paper execution. Certification 1 is DONE.
- **Certification 2 (Live-Execution-Ready)** — the per-finding checklist below. Gated on D8 (proven edge + combine purchase). Built at go-live, not before.

Prop firms live in the execution/account layer DOWNSTREAM of the lifecycle (CLAUDE.md §7) — the lifecycle authorizes a strategy; the execution layer decides whether that approved strategy may trade a specific account.

## Acceptance for Certification 2

All GL items below closed, PLUS the full fault matrix: normal + concurrency + restart + DB-failure + broker-rejection + partial-fill + disconnect tests all green. Then a **1-micro PILOT** proves real fills/slippage/platform behavior before any scaling. Certification 1 (this campaign) is a hard precondition — already satisfied.

## Register

All line anchors are live-repo as of 2026-07-16 (campaign base). Re-verify anchors before implementation — 2+ months will have passed by go-live.

| GL | Source | Requirement | Acceptance |
|---|---|---|---|
| GL-1 | C-01 | Implement TopstepX adapter: `routeOrder` (currently `broker-router.ts:1622` `topstepx_not_configured`), fill ingestion (`fill-recon.ts:253` null), position snapshot (`:1237` inert plug) | Sandbox order → fill → position round-trips; broker = source of truth |
| GL-2 | C-02 | HMAC canonical binds the FULL envelope. Today `live-order.ts:127` signs only `account\|ticker\|action\|timestampMs`; qty/order_type/price/stop_price/strategy_id unsigned (:207-216). Weaker than the TV-webhook canonical beside it | Signature over {account, ticker, action, ts, **quantity, order_type, price, stop_price, strategy_id, bar_ts**}; mutating any → 401. RED-proof: replay a 1-lot sig with qty=9 rejects |
| GL-3 | C-03 | Pine gateway timing: freshness window keyed to bar-CLOSE (or TF-aware), not the 2-min-vs-bar-OPEN that structurally staled 5m+ signals (`live-order.ts:102`, `:413/:500`; `webhook-builder.ts:183` `{{time}}`=OPEN). Dedup: fix ms-epoch→`::timestamptz` cast that fails-open (`live-order.ts:276/:286-295`) — mirror the TV path's fail-CLOSED `ON CONFLICT DO NOTHING` | 5m bar-close alert accepted; duplicate bar_ts rejected (fail-closed); RED-proof injects a dup |
| GL-4 | C-04 | Live orders require a lifecycle-approved `strategy_id` (DEPLOYED/PILOT). Today optional (`live-order.ts:211`), gate skipped when absent (:552-598), broker-router has NO backstop (0 lifecycle checks). Privileged admin/flatten/liquidation get SEPARATE action types (not strategy-less orders) | strategy-less order → 403 unless a privileged action type; broker-router asserts lifecycle state |
| GL-5 | C-06/C-07 | Capital-path fail-opens → fail-CLOSED for entry actions: compliance subprocess failure (`broker-router.ts:1278-1308` proceeds), route-2% throw (:1136-1165 proceeds), clamp (:1020-1023). NOTE: campaign W3A converted the broker-router ENTRY subset for the paper surface (VERIFIED band 7 both at landing and at W7-6 re-grade — see `docs/ratify-packets/w3a-execution-hardening-2026-07-17.md`); the `live-order.ts:883` direct-route path is the go-live delta | entry order with any risk check unavailable → reject; exit/flatten still proceeds |
| GL-6 | C-10/C-11 | Broker fill ingestion + position reconciliation LIVE; disagreement between internal and broker truth → reconcile or HALT | fill + snapshot non-null; injected divergence triggers reconcile/halt |
| GL-7 | C-17 | Durable `production_trades` row before/at routing, fail-CLOSED (today `void` fire-and-forget success-only, `broker-router.ts:492-564/:1499`; skipped entirely when strategy-less :501-511) | every routed live order has a durable row; write failure blocks/queues |
| GL-8 | C-09 | Live-exit ordering: confirm broker exit before marking paper flat, or reconcile (SME fire-and-forget exits update state before firing) | injected live-exit failure cannot leave "flat locally, open at broker" |
| GL-9 | C-12 + H-09 | Distributed scheduler leadership (DB advisory lock / lease / fencing) so a 2nd process can't run the ~110-job fleet twice (today in-process `Set` only, `scheduler.ts:575`; relies on `TF_DISABLE_SCHEDULER`). Watchdog must fence/cancel, not just release the lock (:590-619). ★ Also a CURRENT operational risk (PM2-vs-NSSM duplicate-supervision incident) — operator may pull forward | two instances → exactly one runs each job; hung job fenced |
| GL-10 | H-04 | Network-timeout ambiguous-order truth recovery (`traderspost/client.ts:275`) | timeout → query broker truth, never assume |
| GL-11 | H-05/H-08 | Pine bearer-token rotation/scoping (family path); kill-switch broker-UUID→account-key mapping for scoped force-close (`broker-router.ts:619-646` fail-soft to unscoped global) | token rotates; kill-switch flattens the exact account |
| GL-12 | H-06/H-07/H-13/H-16 | Current-surface security/reliability (operator MAY pull forward — staged per D10): `AUTH_DEV_BYPASS` prod NODE_ENV guard (`auth.ts:142`), session-revocation fail-open on DB outage (`auth.ts:46/:131`), `unhandledRejection` handling (`index.ts:772`), readiness endpoint (`/api/health` always 200, `index.ts:353`) | dev-bypass inert in prod; readiness reflects trading-ready truth |

## Known-deliberate pre-live staging (NOT defects — do not "fix" these outside a GL item)

Per the original external audit reconciliation: C-01 TopstepX stub (GL-1), C-09 SME fire-and-forget (GL-8), C-10 broker-truth-null (GL-6), C-11 gateway contract (GL-1/GL-6), H-03 SME-off, H-05 Pine token embedded (GL-11) — all documented staging, not accidental gaps. Building any of these before D8 (proven edge + combine purchase) is premature — the whole point of staging this register is to build Certification 2 exactly once, when it's actually needed, not iteratively against a moving target.

## Stale/superseded findings from the original audit (reference only, not on this register)

C-14 (`npm ci` "Invalid Version") and C-15 (migration-immutability/DDL gates "broken") were STALE snapshot artifacts even at audit time — the 2026-07-11 CI resurrection (Node 22→24) post-dates the audit; both are BLOCKING green-enforcing CI gates today. C-16 (npm audit CVEs) is advisory/`continue-on-error`, not a hard gate. H-01/H-02/H-11/H-12/H-14/H-15 are architecture/notes, not action items.

## W7 close-out addendum (2026-07-18)

Two items surfaced during this campaign's own close-out verification that are relevant to a future go-live push, recorded here for continuity even though neither is a GL item in the original audit's numbering:

- **C4 survival-score gate structurally inert** (found during the W7-6 fresh re-grade of W3B): `raw_survival_score` — the input to the C4 TESTING→PAPER hard gate — is unconditionally 0.0 today, because every `backtester.py` call site passes `survival_results=None` to `compute_forge_score()`. Dormant while production has 0 backtests; the moment backtests start flowing, this will hard-block every TESTING→PAPER promotion regardless of firm_profiles.py correctness (which W3B fixed). Needs a scoped design decision (what real per-firm daily P&L feeds `survival_score()` from the backtest path) before backtests flow — not a mechanical patch, and not itself a live-execution-path item, but worth resolving before it silently blocks the pipeline this register's Certification 1 was built to keep flowing.
- **Full-suite pre-existing test-debt** (~80 vitest files + ~100 pytest failures, all enumerated + git-blamed to root causes predating this campaign): an operator scope decision on whether/when to adopt as its own cleanup wave. Zero relation to live-capital safety; noted here only so it doesn't silently vanish from the record.
