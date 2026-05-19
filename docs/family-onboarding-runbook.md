# Family Onboarding Runbook

> Hand this to a new family member. They can complete setup without operator help.
> Effective: 2026-05-10. Operator (Tonio) owns the strategies; you operate them on your own account.

---

## 1. Prerequisites

Before you start, make sure you have:

- **Your own personal computer** (laptop or desktop). You cannot share a computer with another family member who runs Trading Forge strategies. The prop firms detect shared hardware and ban accounts.
- **Home internet.** Do NOT use public Wi-Fi, a VPN, or a remote desktop connection. Topstep especially will ban accounts that connect through a VPN.
- **A valid government-issued ID** (driver's license or passport). The prop firm needs this for KYC when you open the evaluation account.
- **A bank account** in your own name. Payouts arrive every 2 weeks via ACH transfer.

If any of these are missing, stop and contact the operator before continuing.

---

## 2. Account signups (do these in order)

### Step 1 — TradingView Premium

- Go to [tradingview.com/pricing](https://www.tradingview.com/pricing/) and sign up for the **Premium** tier.
- Cost: **$69.95/month** monthly, or about **$58/month** if you pay yearly.
- Why Premium and not a cheaper tier: the cheaper tiers expire alerts after 2 months. Premium alerts run forever, which is what the bot needs.

### Step 2 — TradersPost

- Go to [traderspost.io](https://traderspost.io) and create an account.
- Cost: about **$30–$50/month** depending on the plan the operator tells you to pick.
- This is the bridge between TradingView and your prop firm account. TradingView sends signals; TradersPost places the actual orders.

### Step 3 — Prop firm evaluation account

The operator will tell you which firm to sign up with. It will be ONE of these:

- **MFFU 50K Evaluation** — $77/month evaluation fee, $0 activation fee.
- **Topstep 50K Combine** — $49/month evaluation fee, $0 activation fee.

Both firms target $3,000 profit to pass the evaluation, with a $2,000 max drawdown.

> The operator picks the firm for you so two family members never run on the same firm with the same strategy. This is required by MFFU's collaborative-trading rule.

---

## 3. Connect TradersPost to your broker

After signing up at TradersPost:

1. Log in to TradersPost.
2. Click **Brokers** → **Add Broker**.
3. Pick your firm:
   - **MFFU** users: select MFFU and follow the on-screen MFFU broker connection steps.
   - **Topstep** users: select **TopstepX** (this is the only platform Topstep allows since January 2026 — no NinjaTrader, no Tradovate).
4. Enter the API credentials your firm gave you when you opened the eval account.
5. TradersPost will confirm the connection with a green check.

> [Screenshot placeholder — TradersPost broker connection screen]

---

## 4. Receive your Pine file from the operator

The operator will send you a **download link** via Discord, email, or another secure channel. The link downloads a `.pine` file directly from the Trading Forge backend (no manual file transfer needed). The filename will look like `strategy_<name>_<your-label>.pine`.

- **Do not edit the file.** If you change a single character, you become the developer of the strategy and you violate the prop firm rules.
- Open the operator's accompanying setup README (sent in the same message). It contains:
  - The chart symbol (MES, MNQ, or MCL).
  - The chart timeframe (5m, 15m, etc.).
  - Your TradersPost webhook URL.
  - Expected Strategy Tester baseline numbers (so you know if the paste worked).

> Note for operator: the download link is the `downloadUrl` field returned by `generateRecipientExport()`. It calls `GET /api/pine-export/:exportId/artifacts/:artifactId/download` and serves the artifact content directly from the database. No filesystem access is required.

---

## 5. Paste the Pine into TradingView

1. Click the download link the operator sent you. Your browser will download the `.pine` file automatically.
2. Log in to TradingView.
3. In the search bar at the top, type the symbol from the README (for example `MES1!` for the MES futures front-month contract).
4. Set the chart timeframe to match the README (for example `5m`).
5. At the bottom of the chart, click **Pine Editor**.
6. Click **New** → **Empty Strategy Script**.
7. Open the downloaded `.pine` file in a text editor (Notepad on Windows, TextEdit on Mac). Select all → copy.
8. In TradingView Pine Editor, select all → paste.
9. Click **Save** (give it any name).
10. Click **Add to chart**.

You should now see entry triangles and exit X marks appear on the chart.

10. Open the **Strategy Tester** panel at the bottom of the chart.
11. Confirm the metrics roughly match what the operator's setup README listed (net profit, win rate, drawdown). Small differences are fine; large differences mean the paste went wrong — contact the operator.

> [Screenshot placeholder — TradingView Pine Editor + Add to chart]

---

## 6. Configure the alert webhook to TradersPost

This is the most important step. Without this, signals go nowhere.

1. With your strategy on the chart, right-click anywhere on the chart → **Add alert** (or click the alarm-clock icon top right).
2. **Condition:** select your strategy name → **Any alert() function call**.
3. **Frequency:** **Once Per Bar Close**. This is critical — never use "Once Per Bar" or "Every Tick".
4. **Webhook URL:** check the box for **Webhook URL**. Paste the TradersPost webhook URL from the operator's README.
5. **Message:** the Pine code already builds the right JSON message. **Leave the message field as `{{strategy.order.alert_message}}`**. Do not type anything custom.
6. Click **Create**.

> [Screenshot placeholder — TradingView alert dialog with webhook URL field]

The alert will fire automatically every time the strategy enters or exits a trade.

---

## 7. Paper-trade for 3–5 days first

Before switching to a live funded account, watch the bot run on a paper-trading account for 3–5 trading days.

What to look at each day:

- **TradingView Strategy Tester panel** — shows entry triangles and exit X marks. The equity curve should slope up over the week.
- **TradersPost dashboard** — shows the orders TradersPost actually fired and the fill prices. Compare these to the entry triangles on TradingView. They should match within 1–2 ticks.
- **Today's net P&L** vs the operator's expected daily target.

If anything looks wrong (no orders firing, P&L dramatically different from TradingView's Strategy Tester, errors in the TradersPost dashboard), contact the operator before continuing.

---

## 8. Switch to live trading

After 3–5 paper days and the operator's approval:

1. Log in to TradersPost.
2. Click **Strategies** → find your strategy.
3. Change the **Destination Account** dropdown from your paper account to your funded MFFU or Topstep account.
4. Click **Save**.

That's it. Your bot now trades real money the next time the strategy fires.

---

## 9. What happens next

- The bot trades autonomously during regular trading hours (9:30 AM – 4:00 PM Eastern Time, Monday through Friday).
- All open positions automatically close at **3:55 PM ET** every day. You will never be in a position overnight.
- Profits accumulate in your prop firm account.
- After the buffer phase (set by the firm), payouts arrive every **2 weeks** via ACH to your bank account.
- **You do not need to babysit the bot.** Glance at it once or twice a day. See `family-monitoring-guide.md`.

---

## 10. When the operator publishes a new strategy

Sometimes the operator improves a strategy and sends you an updated `.pine` file. Replacing it takes about 1 minute. See `strategy-update-runbook.md` for the steps.

---

## Questions or problems

Contact the operator (Tonio) directly. Do not call MFFU or Topstep support unless your account is suspended — those calls are reserved for genuine firm-side issues.
