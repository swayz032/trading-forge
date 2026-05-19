# Family 2026 Rules Cheatsheet

> Plain-English summary of the prop firm rules YOU are responsible for as a family member.
> The bot enforces most rules automatically — these are the few where YOUR behavior matters.
> Effective: 2026-05-10. Source: `prop-firm-rules-2026-mffu.md` + `prop-firm-rules-2026-topstep.md`.

---

## Rules that apply to BOTH MFFU and Topstep

These are non-negotiable for every family member.

- **Don't modify the Pine code.** If you change one character, the prop firm can classify YOU as the strategy developer. That violates the rule that says one person can't develop AND trade. The operator owns the strategies; you operate them.
- **Don't share Pine code with anyone outside the family.** Operator-owned strategies are private. Sending them to friends, posting them on Discord, or uploading them to GitHub is forbidden.
- **Operator owns the strategies; you operate them on your own account.** This separation is what keeps everyone compliant with firm developer-vs-operator rules.
- **One trader per computer.** Each family member runs Trading Forge from their own laptop or desktop, with their own TradingView and TradersPost logins.
- **Maximum loss per single trade is roughly 2% of your account balance.** The bot enforces this automatically with the stop loss.
- **Payouts arrive every 2 weeks via ACH** once you're past the firm's buffer phase.

---

## MFFU-specific rules

These apply only if the operator put you on **MFFU**.

### Account profile

- Account size: **$50,000**
- Monthly evaluation fee: **$77** (Activation fee: **$0**)
- Profit target to pass: **$3,000**
- Max drawdown: **$2,000** (end-of-day trailing)
- Max contracts: **15**
- Payout split: **80% to you, 20% to MFFU**

### Rules YOU must respect on MFFU

- **Never share your computer with another trader.** MFFU detects shared hardware fingerprints. Each family member uses ONLY their own device.
- **Never run the same strategy as another family member on MFFU.** MFFU calls this "collaborative trading" and bans both accounts. The operator assigns DIFFERENT strategies per family member to prevent this. If you find out you and a sibling are running the same Pine, stop the bot and call the operator immediately.
- **Don't fire two limit orders at the same price simultaneously.** This is a high-frequency trading pattern MFFU bans. The bot doesn't do this — but if you ever see a warning about it, ignore unless the operator says otherwise.
- **Don't trade through major news events** (FOMC, CPI, NFP). The bot handles this automatically with a news blackout 30 minutes before through 30 minutes after each release.
- **No overnight positions.** All positions auto-flatten at 3:55 PM ET every day.
- **No weekend trading.** Bot runs Monday–Friday only.

---

## Topstep-specific rules

These apply only if the operator put you on **Topstep**.

### Account profile

- Account size: **$50,000**
- Monthly Combine fee: **$49** (Activation fee: **$0**)
- Profit target to pass: **$3,000**
- Max drawdown: **$2,000** (end-of-day trailing — locks at starting balance)
- Daily loss limit: **$1,000** (opt-in at checkout)
- Max contracts: **15**
- Payout split: **90% to you, 10% to Topstep**

### Rules YOU must respect on Topstep

- **Never use a VPN, VPS, or remote desktop.** Topstep tracks your IP. If you connect from a VPN once, you can be banned. Run the bot from your home computer on your home internet only.
- **TopstepX is the only allowed platform.** Since **January 12, 2026**, Topstep banned NinjaTrader and Tradovate. TradersPost will route your orders through TopstepX automatically — you don't need to install anything new, just confirm the broker connection in TradersPost shows TopstepX.
- **You CAN have multiple Topstep accounts under your one Topstep user.** Topstep explicitly allows the same person to copy trades across their own multiple accounts. (MFFU does NOT allow this.)
- **End-of-day trailing drawdown.** Topstep recalculates your drawdown buffer at the end of each day based on your account high. The bot handles this automatically — you don't need to monitor.
- **Personal device only.** Never run from a server, VPS, or someone else's computer.
- **No overnight positions, no weekends.** Same as MFFU.

---

## Quick "is this allowed?" reference table

| Action | MFFU | Topstep |
|---|---|---|
| Run on home internet | YES | YES |
| Run on VPN | NO | **NO (instant ban)** |
| Run on VPS or cloud server | NO | **NO** |
| Run on remote desktop | NO | **NO** |
| Same strategy on 2 accounts (same family) | **NO** | YES (within YOUR own multiple accounts) |
| Same strategy across 2 different family members | **NO** | **NO** (different family members = different accounts; collaborative-trading rule still applies in spirit) |
| Hold positions overnight | NO | NO |
| Trade weekends | NO | NO |
| Modify the Pine code | **NO** | **NO** |
| Share Pine with friends | **NO** | **NO** |
| Trade manually on the funded account | NO | NO |

---

## What the bot handles automatically (so you don't have to)

You do NOT need to think about any of these — the operator's system enforces them:

- News blackouts around FOMC, CPI, NFP
- End-of-day position flattening at 3:55 PM ET
- Daily loss limit and trailing drawdown kill switches at 67% of firm limit
- Contract count caps (max 15 per firm)
- Stop-loss on every trade
- Holiday calendar (no trading on CME-closed days)
- Correlated-position guard (won't open MES + MNQ at the same time, since they're 95% correlated)
- Order routing via the correct platform (TopstepX for Topstep, MFFU's broker for MFFU)
- Network failover if your home internet hiccups (server-side order placement on Railway)

---

## When in doubt

If something feels wrong, **stop and call the operator** before you click anything else. A 30-second phone call costs nothing. A wrong click can blow up a $50,000 account.
