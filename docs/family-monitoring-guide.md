# Family Monitoring Guide

> Your daily routine for keeping an eye on the bot. Total time: 5 minutes per day.
> Effective: 2026-05-10.

---

## What to glance at each day

Check these three places once after the market closes (after 4:00 PM Eastern Time). In this order:

### 1. TradingView (your chart)

Open the chart you set up during onboarding. Look for:

- **Entry triangles and exit X marks** on the chart — confirm the bot took trades today.
- **Strategy Tester panel at the bottom** — today's net P&L. It should be close to the operator's expected daily target (the operator told you what's normal during setup).
- **Equity curve** — should slope up across the week, not collapse.

### 2. TradersPost dashboard

Log in to TradersPost. Look for:

- **Orders** tab — every entry triangle on TradingView should match an order here.
- **Fill price** column — fills should be within 1–2 ticks of the TradingView entry price.
- **Latency** — orders should fire within 1–2 seconds of the TradingView signal.
- **Errors** — any red error messages? If yes, contact the operator.

### 3. Prop firm portal (MFFU or Topstep)

Log in to your MFFU or Topstep dashboard. Look for:

- **Account balance** — went up if the bot was profitable.
- **Drawdown remaining** — how much buffer you still have before the firm breaches you. Stay above 67% of your starting drawdown buffer (operator can explain).
- **Payout schedule** — payouts arrive every 2 weeks once you're funded.

---

## What to watch for (red flags)

These five situations need attention. Anything else, the bot handles itself.

| Situation | Severity | What to do |
|---|---|---|
| TradingView Strategy Tester P&L diverges from TradersPost P&L by more than **$5** | Yellow | Take a screenshot of both, send to operator within 24 hours |
| Account balance drops to **67% of trailing drawdown** or worse in one day | RED | Stop watching. Call the operator immediately. |
| TradersPost is not receiving alerts (no orders firing on a day the chart shows triangles) | RED | Contact operator immediately. Webhook may be broken. |
| Discord alert with **GREEN check** | Healthy | No action. The bot is fine. |
| Discord alert with **YELLOW** marker | Warning | Contact operator within 24 hours. |
| Discord alert with **RED** marker | Critical | Stop everything. Contact operator immediately. |

---

## Discord alert interpretation

The operator's system sends Discord alerts when something interesting happens. Here's what each color means:

- **GREEN check** — Healthy state. The bot opened or closed a trade as expected, or a daily summary went out. No action needed.
- **YELLOW** — Something is off but not yet dangerous. Examples: today's P&L is more negative than usual, or TradersPost had a brief outage. Contact the operator within 24 hours so they can decide if it matters.
- **RED** — Critical. Examples: the bot was halted by the kill switch, the prop firm suspended the account, or the CME exchange went down. Stop and call the operator now.

---

## When to call the operator vs handle it yourself

| Situation | Who handles it |
|---|---|
| New Pine version published | **Operator** generates the file. **You** paste it into TradingView. See `strategy-update-runbook.md`. |
| Single trade lost more than $500 | **Operator.** Send screenshot. |
| TradersPost not receiving alerts | **Operator.** Webhook diagnosis is technical. |
| Account balance dropping toward 67% drawdown | **Operator immediately.** Stop manual intervention. |
| MFFU or Topstep suspends your account | **Call the firm support FIRST** (they tell you why). Then call the operator. |
| You changed something in TradingView accidentally | **Operator.** Tell them what you clicked. |
| Payout didn't arrive on schedule | **Call the firm first** (their support handles ACH). Then operator. |
| You want to understand "why did the bot do X" | **Operator.** Don't guess. |

---

## What NOT to do

These five rules will save your account. Do not break them.

1. **Never modify the Pine code.** If you change one character, you become the strategy developer in the firm's eyes. Most firms ban this. The operator owns the strategy; you operate it.
2. **Never run the bot from a VPN, VPS, or remote desktop.** Topstep tracks IP and bans accounts that do this. Run from your home computer only.
3. **Never share your TradingView or TradersPost credentials with anyone**, including other family members. Each family member runs their own account on their own device.
4. **Never run the same strategy as another family member on the same firm.** MFFU treats this as collaborative trading and bans both accounts. The operator assigns DIFFERENT strategies per family member specifically to avoid this.
5. **Never trade manually on the funded account.** If you click a buy or sell button yourself, you mix discretionary trades with bot trades and the firm rules get complicated. Let the bot do everything.

---

## Six questions the operator's dashboard answers (so you don't have to)

The operator monitors these from the main Trading Forge dashboard. You do NOT need to track any of these — but it's useful to know they're being watched:

1. **Is the prop firm API healthy?** (operator's dashboard polls every 15 minutes)
2. **Is CME exchange up?** (operator's dashboard polls every 60 seconds)
3. **Is the network connection stable?** (operator's failover monitor watches every 30 seconds)
4. **Are macro news events about to fire?** (operator's macro gate blocks trades around FOMC, CPI, NFP)
5. **Is Windows about to force a reboot?** (operator's pre-trading-day health check runs at 8:00 AM ET each weekday)
6. **Is the strategy still performing?** (operator's lifecycle service tracks rolling Sharpe and demotes failing strategies)

If any of these are red on the operator's side, the bot pauses automatically. You'll see a Discord alert and the operator will reach out.

---

## Summary

5 minutes a day. TradingView → TradersPost → prop firm portal. Watch for the five red flags above. Trust the bot, follow the rules, take the payouts.
