# Strategy Update Runbook

> What to do when the operator publishes a new version of your strategy.
> Total time: 1 minute. You'll get this notification roughly once or twice a month.

---

## 1. Operator notifies you

You'll get a Discord ping or email from the operator that says something like:

> **New Pine version for [your strategy name].** Replaces the version you have now. Backward-compatible, same symbol, same timeframe. New baseline metrics in the attached README.

The operator will include a **download link** for the new `.pine` file (served directly from the Trading Forge backend — no email attachment). Filename usually has a version suffix like `_v2`, `_v3`.

---

## 2. Replace the Pine in TradingView

1. Click the download link the operator sent you. Your browser downloads the new `.pine` file automatically.
2. Log in to TradingView and open the chart with your current strategy.
3. At the bottom of the chart, click **Pine Editor** to open it.
4. Click the **Open** icon (folder icon) → pick your existing strategy script.
5. **Select all the existing code** (Ctrl+A on Windows, Cmd+A on Mac) → press **Delete**.
6. Open the downloaded `.pine` file in a text editor (Notepad / TextEdit). Select all → copy.
7. Back in TradingView Pine Editor: paste the new code.
8. Click **Save**. Use the same script name as before — TradingView will overwrite.
9. Click **Add to chart**.

The old strategy is now replaced. New entry triangles and exit X marks will appear on the chart.

---

## 3. Verify the Strategy Tester shows the new baseline

The operator's update README will list expected new metrics — for example:

> **New baseline:** Net profit ~$4,800/month, win rate ~74%, max drawdown ~$1,400.

Open the **Strategy Tester** panel at the bottom of the chart. Confirm the metrics on the panel are roughly in line with the operator's numbers. Small differences (a few percent) are fine. Big differences mean the paste went wrong — contact the operator before continuing.

---

## 4. Re-enable the alert if TradingView disabled it

When you replace a Pine script, TradingView sometimes disables the existing alert. Check this:

1. Click the alarm-clock icon (top right of TradingView).
2. Find your strategy alert.
3. If the toggle is OFF, switch it back ON.
4. If TradingView lost the alert entirely, recreate it using the same steps as in `family-onboarding-runbook.md` Step 6.

The webhook URL and message field stay the same — only the strategy condition changes.

---

## 5. Paper-test for 1 day before letting live alerts fire

Before the new version trades real money:

1. Log in to TradersPost.
2. Open the strategy → temporarily change the **Destination Account** from your funded account back to your **paper account**.
3. Let it run for one full trading day.
4. Confirm the new strategy's behavior matches the operator's update notes (similar number of trades per day, similar P&L pattern).
5. The next morning, switch the TradersPost destination back to your funded account.

If anything looks off during the paper day, contact the operator before going live.

---

## 6. Rollback if needed

Save the OLD `.pine` file for at least **7 days** after every update. Don't delete it.

If the new strategy underperforms during its first week (the operator will be watching too), the operator may ask you to roll back. To roll back:

1. Repeat the steps above using the OLD `.pine` file instead of the new one.
2. Confirm the Strategy Tester returns to the old baseline metrics.

After 7 days of stable performance on the new version, you can delete the old file.

---

## Quick checklist

- [ ] New `.pine` file received from operator
- [ ] Operator's update README read (new baseline metrics noted)
- [ ] Old Pine code deleted in TradingView Pine Editor
- [ ] New Pine code pasted, saved, and added to chart
- [ ] Strategy Tester metrics match operator's new baseline
- [ ] Alert re-enabled (or recreated if it disappeared)
- [ ] Paper-tested for 1 trading day
- [ ] Switched back to funded account
- [ ] Old `.pine` file kept on disk for 7 days

That's it. The bot is running the new version.
