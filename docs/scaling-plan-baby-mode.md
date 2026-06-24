# Baby-Mode Scaling Plan — Balanced Pace, Data-Backed

> **Plain-English plan for how Slumdawg scales contract size + takes payouts without blowing accounts.**
> Built 2026-06-23 from (a) a deep scan of our actual sizing code and (b) institutional web research
> (all sources ≥2025 — see `docs/institutional-evidence/prop-firm-scaling-2026.md`). Operator-facing:
> stats are translated to plain English with a verdict.

---

## The one rule everything hangs on
**Size from the BUFFER, not the account label.** A "$50K account" is not your risk capital — your
risk capital is the **cushion above the trailing drawdown floor** ($2,000 on a fresh Topstep/MFFU
50K). Every position-size decision, and every payout decision, is computed off that buffer. This is
the single rule that 5+ 2026 sources converge on, and it's the rule the current code half-breaks.

---

## What the deep scan found (the honest current state)

| Thing | Current reality | Verdict |
|---|---|---|
| **Base size** | **6** MES / 6 MNQ / 18 MCL (`framework-overlay.ts:131`) — operator intended **9** | ✏️ change to 9 |
| **Risk-per-trade cap** | `min(2% of balance, **1% of drawdown room**)` | 🔴 the 1%-room cap = **~$20/trade = 0 contracts** on a fresh $2K buffer — the bot can't even trade base size |
| **Final size cap** | 50 micros Topstep / 40 MFFU (firm cap) — already correct | ✅ |
| **The ramp** | +3 contracts per **$3,000 of profit LEFT IN** the account | 🔴 slow + taking a payout drags your size back down |
| **Backtest proof** | Backtester sizes **statically** — it does NOT play the pyramid out over a run; no harness threads profit forward across folds | 🔴 we cannot yet *prove* a scaling schedule on real data |
| **Discipline** | 2-trades/day cap, 67% DLL halt, 95% force-close, lunch blackout, PM taper | ✅ mostly there (add a 60% reduce-size band) |

**Bottom line:** the *ceiling* (50) is right and the *discipline* is mostly there, but the *risk
cap* is broken (too strict), the *ramp* fights payouts, and we *can't validate a schedule on data yet*.

---

## The plan, in 6 moves

### 1. Set the base to 9 (start bigger, but still small)
Base = **9 MES / 9 MNQ** (keeps Style C 33/33/34 splits clean — 9 ÷ 3 = 3). MCL stays **18** (or 27
if we want it proportional — operator's call). This is the floor the bot ramps *up* from.

### 2. Fix the risk-per-trade cap so the bot can actually trade
The research is unanimous: **1% of the drawdown buffer is 8-12× too tight.** The institutional sweet
spot for a $50K EOD-trailing account is **8-10% of the remaining buffer per trade** = **$160-$200/trade**
(NexusFi 2026-05, Blue Guardian 2026-04, QuantVPS 2026-03).
- **Change `DRAWDOWN_ROOM_RISK_PCT` from `0.01` → `0.08`** (env var — one line, no code change).
- **Keep the 2%-of-balance cap** as the secondary ceiling. Real size = `min(2% of balance, 8% of buffer)`.
- This alone lets the bot trade base 9 on day one *and* scale toward 50 as the buffer grows.

> Math check: at $75K (room $25K, 5-pt MES stop = $25/contract): 1% room = **10 contracts** (current,
> chokes you); 8% room = **80** → capped by the 2%-balance (60) → capped by the **firm 50**. So 8% lets
> you reach the real ceiling; the firm cap becomes the true limit, as it should.

### 3. Change the ramp from "$ hoarded" to "proven trades"
Today, size = `base + 3 × floor(profit_kept / $3,000)`. Taking a payout shrinks `profit_kept`, so it
drags your size down — exactly the trap you flagged. **Switch the trigger to proven green trades:**
- Ramp **+3 contracts every N consecutive/clean profitable trades** at the current size (N ≈ 10-15,
  tunable), capped by the 2%-buffer rule and the firm cap.
- A new `proven_trades_count` column on `paper_sessions` survives withdrawals — **so taking income no
  longer resets your scaling progress.**
- Keep the 2%-buffer rule as the safety ceiling so you never ramp faster than the cushion can absorb.

### 4. The payout schedule (income without self-sabotage)
65% of funded accounts blow up within 30 days of a **100% withdrawal** (PropFirmScan 2026-05) — never
empty the buffer. Schedule by payout maturity:

| Phase | Take / Keep | Why |
|---|---|---|
| Payouts **1-3** | **50 / 50** | build a permanent cushion (3-5% of balance) above the floor |
| Payouts **4-5** | **70 / 30** | cushion is established; take more income |
| Payouts **6+** | **90 / 10** | once retained buffer > 10% of account, it's self-sustaining |
| At scale | **50 / 30 / 20** | 50% income+tax, 30% fund new accounts, 20% never-touch reserve |

**After every payout, the bot re-reads the new buffer and re-sizes** — withdrawing reduces the cushion,
so size adjusts down to match (this is correct, not a bug — it's why we keep some in).

### 5. Grow by COPIES, not by maxing one account (the real income lever)
This is the biggest finding and it reframes the goal. **Multiple accounts at moderate size beat one
account at max size** (FuturesHive 2026-05, YoungMoney 2026-03):
- The 100%-first-payout-tier threshold **stacks per account** — 5× $50K out-earns 1× $250K by ~$3K/mo.
- One bad trade can't breach your whole stack (each account has its own buffer).
- Topstep allows **5 Express Funded accounts** under one user + a **free native copy-trader**.

**The path:** prove Slumdawg on ONE account → ramp it to a *comfortable* ~20-33 (not 50) → after **3
clean payouts with zero rule violations**, open account #2 at base 9 and copy-trade it → repeat. Don't
white-knuckle one account to 50; replicate at moderate size. **50 stays the ceiling, but horizontal is
the growth engine.**
> ⚠️ MFFU = 1 account per user + collaborative-trading ban → the multi-account copy stack is a **Topstep**
> play. MFFU runs ONE different strategy. (Already in our compliance rules.)

### 6. Baby-mode discipline (mostly already enforced)
- **Max 2 trades/day** — already live (`TF_MAX_TRADES_PER_DAY=2`). This also caps you at ≤2 losses/day,
  which matches the research's "stop after 2 losses" rule.
- **4-band DLL escalation** — we have 67% halt + 95% force-close. **Add a 60%-of-DLL → reduce-to-50%-size**
  band (research: 60/80/90/100). Cheap add.
- **Buffer tracked in real-time** — the bot must read the live trailing floor, not closed P&L (the EOD
  floor ratchets on unrealized highs; a winner that round-trips to breakeven can quietly eat 60% of your
  buffer). Confirm `currentDrawdownRoom` is fed live, not stale.

---

## The data-backed validation plan (prove it before a dollar is live)

The deep scan found the gap honestly: **the backtester sizes statically — it does not play the pyramid
out across a run, and no harness threads profit forward.** So right now we *cannot* prove a scaling
schedule on real data. Here's the solid plan to close that, using the ~10.6 years of real ratio-adjusted
ES/NQ/CL data we already have in S3:

1. **Build a sequential walk-forward replay** that carries `account_pnl_total` forward fold-to-fold, so
   the base-9 → proven-trades ramp → 50-cap schedule actually *plays out* across a decade of real bars.
   Export the per-tier daily P&L + the contract count used at each tier.
2. **Feed each tier's daily P&L paths into `simulate_firm_survival(firm="topstep_50k")`** — this already
   models the **EOD trailing-DD breach** (the `breach_mask`, hardened 2026-06-22 with the Topstep 50%
   consistency gate now wired).
3. **Gate each size tier on breach rate < 5%** (95th-percentile path). A tier only "graduates" in the
   plan if the real-data survival sim proves it won't breach the $2,000 buffer.
4. **Output a plain-English report:** "at 20 contracts, breach risk = X%; at 33, Y%; at 50, Z%" — so the
   ramp ceiling per account is set by *evidence*, not by the firm's max.

This turns "ramp to 50" from a hope into a number we've proven on 10 years of real crude/index data.

---

## Build checklist (ordered — smallest risk first)

| # | Change | Files | Effort |
|---|---|---|---|
| 1 | **Base 6 → 9** (MES/MNQ; MCL stays 18) | `framework-overlay.ts:131` + 5 test fixtures + CLAUDE.md §1/§2b/§4 | small (1 code line + fixtures) |
| 2 | **`DRAWDOWN_ROOM_RISK_PCT` 0.01 → 0.08** | `.env` + Railway + CLAUDE.md §14 + room-cap tests | tiny (env) |
| 3 | **Proven-trades ramp** | `paper_sessions.proven_trades_count` (migration) + `risk-sizing.ts` + `sizing.py` + paper-signal counter | medium |
| 4 | **60%-DLL reduce-size band** | kill-switch / sizing PM-taper path | small |
| 5 | **WF carry-forward + survival validation harness** | new script over backtester + `simulate_firm_survival` | medium-large (the proof) |
| 6 | **Payout-aware re-size + schedule helper** | read live buffer post-payout; 50/50→70/30→90/10 lane | medium |

---

## Citations (all ≥2025)
Full evidence: `docs/institutional-evidence/prop-firm-scaling-2026.md`. Headline sources:
NexusFi Academy (2026-05-16) — 8-12%-of-buffer risk formula; PropFirmScan (2026-05-16) — payout
buffer paradox + 50/50→90/10 schedule; FuturesHive (2026-05-08) — Topstep scaling tiers + 5×$50K >
1×$250K math; YoungMoneyInvestments (2026-03-21) — horizontal-not-vertical scaling; TradeDisciple
(2026-03-29) — two-loss daily halt; ThorTradeCopier (2026-05-27) — Topstep copier mechanics.
