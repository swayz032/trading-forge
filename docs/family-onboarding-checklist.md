# Family Onboarding Checklist

> One-page printable checklist. Companion to `family-onboarding-runbook.md`.
> Print this, tick each box as you go, and save it.

**Family member name:** _______________________

**Operator:** Tonio

**Date started:** _______________________

---

## Subscriptions

- [ ] **TradingView Premium** subscription active ($69.95/month or $58/month annual)
- [ ] **TradersPost** subscription active ($30–$50/month, plan picked by operator)
- [ ] **MFFU 50K Eval** OR **Topstep 50K Combine** account opened (operator told you which one)
- [ ] Bank account linked at the prop firm for payouts

---

## Setup

- [ ] **Pine file** received from operator (filename: __________________________)
- [ ] **Setup README** received from operator (with symbol, timeframe, webhook URL, baseline metrics)
- [ ] Pine file pasted into TradingView Pine Editor and saved
- [ ] Strategy added to chart (entry triangles + exit X marks visible)
- [ ] **Strategy Tester** panel metrics match operator's README baseline
- [ ] **TradersPost** connected to broker (green check on broker page)

---

## Alert wiring

- [ ] Alert created on the strategy in TradingView
- [ ] Alert condition: **Any alert() function call** (NOT "Crossing", "Greater than", etc.)
- [ ] Alert frequency: **Once Per Bar Close** (NOT Once Per Bar or Every Tick)
- [ ] **Webhook URL** field checked, TradersPost URL pasted
- [ ] **Message** field left as `{{strategy.order.alert_message}}` (untouched)
- [ ] Alert saved and shows as **Active** in the alarm-clock panel

---

## Paper trading verification (do these for 3–5 trading days)

- [ ] Day 1 paper run complete — entry/exit triangles visible on chart
- [ ] Day 1 — orders visible in TradersPost dashboard
- [ ] Day 2 paper run complete
- [ ] Day 3 paper run complete
- [ ] (Optional) Day 4 paper run complete
- [ ] (Optional) Day 5 paper run complete
- [ ] TradingView Strategy Tester P&L matches TradersPost dashboard P&L (within $5)
- [ ] No errors visible in TradersPost order log
- [ ] Operator gives approval to switch to live

---

## Going live

- [ ] TradersPost destination account changed from **paper** to **funded MFFU/Topstep**
- [ ] First live trade visible in TradersPost dashboard
- [ ] First live trade visible in MFFU/Topstep portal
- [ ] Bank account linked at the prop firm for ACH payouts

---

## Documentation read

- [ ] `family-onboarding-runbook.md` read end to end
- [ ] `family-monitoring-guide.md` read (daily routine)
- [ ] `family-2026-rules-cheatsheet.md` read (firm rules I must respect)
- [ ] `strategy-update-runbook.md` skimmed (what to do when operator publishes a new Pine)

---

**When every box is ticked, you're done with setup. The bot runs autonomously from here.**
