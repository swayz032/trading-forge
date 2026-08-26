# Kill & Heartbeat — stopping things and knowing what is alive on this tower

> **Standing state corrected on commit (2026-08-26).** Drafted at ladder head ALGO-100C
> `602318c5`; committed at ladder head **ALGO-100E `a553b59f`** (ALGO-100D landed the
> operator's volunteered target teaching and RE-OPENED the target layer; ALGO-100E published
> this handover to the channel). Strategy branch head at commit: **`abce4155`**
> (`6888112d` is the revert commit, no longer the head). The T3 batch referenced below
> is now **LANDED and its status is exactly `UNRATIFIED-FOR-FREEZE`** (ALGO-105). It may NOT
> be described anywhere as ratified, passing, or frozen.
>
> What that means in plain words: the batch (R2 + R2b + F1 + T3'') is on the branch at
> `da7f9d3d` and the suite is green, but **re-exam #3 returned FAIL and the freeze is BLOCKED**.
> It was NOT reverted, because nothing degraded - the deployed 08:00 arm is character-identical
> to before, the 09:30 arm GAINED two sessions against the frozen anchor, and the 04-14 control
> is identical by key and target. It was NOT frozen, because the exam's A3 makes a failing
> 08:00 arm block the freeze outright, and that arm was already 1/8 before this batch existed.
>
> **Nothing here is deployable and nothing trades real money.** The bot's remaining known
> defect at 08:00 is that it spends its one daily trade BEFORE the operator's own entry clock
> on 13 of 14 sessions.


**ALGO-026 §1(c) deliverable. Every command marked VERIFIED was actually run read-only on this
machine on 2026-08-25/26. The STOP commands are documented but were deliberately NOT executed —
stopping your live services is your action, not a subagent's.**

---

## 1. The honest premise — read this first

**The MNQ v2.4 bot has no daemon.** There is no service, no scheduled task, no background
process that IS the bot. Nothing to kill, and nothing that can place an order. It cannot be
"secretly running": no start command exists, and nothing is connected to any broker (the hard
gate: FIDELITY → FREEZE → CLEAN EDGE before any TopstepX connection — not funded, not eval,
not broker-paper).

What DOES run on this tower is the **Trading Forge platform** — a separate product (the TS
web platform; its paper engine cannot even express the v2.4 bot). "Stop everything" today
means stopping platform services, and it carries **zero market risk** because nothing is
attached to a market.

## 2. What is actually running (inventory, VERIFIED 2026-08-25)

| service | what it is | verified state |
|---|---|---|
| `TradingForgeAPI` | the platform's API server (a node process listening on port 4000), run as a Windows service via NSSM | RUNNING, StartMode Auto |
| `TradingForgeDiscordBot` | the platform's Discord alert bot (platform alerts — NOT a v2.4 bot heartbeat) | RUNNING, Auto |
| `OpenclawGateway` | platform gateway service (NSSM) | RUNNING, Auto |
| `TFRelayClient` | platform relay service (NSSM) | RUNNING, Auto |
| `postgresql-x64-17` | the database | RUNNING |

Also verified: `nssm` is installed (`C:\Users\tonio\AppData\Local\Microsoft\WinGet\Links\nssm.exe`);
**no scheduled task** matches forge/mnq/trading/n8n (`schtasks /query` swept); the python and
node processes visible on the box belong to engineering tooling and the platform — **none of
them is the v2.4 bot.**

Because every service above is StartMode **Auto**, a full machine restart brings all of them
back by itself.

## 3. "Is anything running?" — copy-paste (VERIFIED)

Open PowerShell (no admin needed for these) and paste:

```
Get-Service TradingForgeAPI, TradingForgeDiscordBot, OpenclawGateway, TFRelayClient, postgresql-x64-17
```

You want `Running` on each (or `Stopped` if you stopped them). Then:

```
netstat -ano | findstr :4000
```

A `LISTENING` line means the platform API is alive on port 4000. No output means it is not.

```
Get-Process python, node -ErrorAction SilentlyContinue
```

Lists python/node processes. Seeing some is NORMAL (engineering tools, the platform). None of
them is the bot — see §1.

## 4. "Stop everything NOW" — the procedure (documented, NOT executed by the drafter)

1. Open PowerShell **as Administrator** (right-click PowerShell → "Run as administrator").
2. Paste:

```
Stop-Service TradingForgeAPI, TradingForgeDiscordBot, OpenclawGateway, TFRelayClient
```

   (Equivalent per-service form: `nssm stop TradingForgeAPI` and so on. Leave
   `postgresql-x64-17` running — it is just the database and stopping it is never needed to
   stop activity.)

3. Verify it worked — paste the §3 checks again. You want `Stopped` on the four services and
   **no** `LISTENING` line on port 4000.

4. To bring everything back later:

```
Start-Service TradingForgeAPI, TradingForgeDiscordBot, OpenclawGateway, TFRelayClient
```

   or simply restart the machine (everything is Auto-start).

**What stopping does NOT do:** it cannot close a market position, because nothing is connected
to a market. Today this procedure is about the platform only.

## 5. The FUTURE kill — for the day the bot is actually connected (not today)

This section becomes live only after the ladder completes (FIDELITY → FREEZE → CLEAN EDGE)
and a connection is authorized. It is written now so it is not improvised later.

- The connection code has a kill path, proven offline: `flatten()` closes open positions,
  `cancel_all()` cancels working orders. All 7 safety-critical broker methods have tests
  (coverage was 0/7 before ALGO-026; measured 7/7 since, re-verified 2026-08-25 by running
  `PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_topstepx_prior_art`).
- **The measured caveat: A FAILED CLOSE STOPS THE REST.** `flatten()` closes positions one at
  a time; if the broker rejects one, it stops there and later positions STAY OPEN. So "stop
  everything" can leave you partly in the market. Run it again, then **check your positions in
  the TopstepX app with your own eyes.** Never assume you are flat because a command ran.
- **The absolute fallback, always:** close positions in the TopstepX app or phone the broker.
  That works regardless of any code on this tower. If money is at risk and you are unsure, do
  that FIRST and ask questions after.

## 6. Heartbeat — what exists, honestly

- **There is NO dead-man signal for the v2.4 bot today.** Nothing pages you if a (future) bot
  process goes quiet. ALGO-025 names a dead-man/kill switch as part of the product's minimum
  safety core, so one must exist before any live run. It is unbuilt. This file does not
  pretend otherwise.
- What DOES exist: the shadow runtime, when it someday runs, writes a `HEARTBEAT` line into
  its journal file every 60 seconds, and `RealtimeHealth` refuses to trade on an unhealthy
  feed. Both are proven by tests; neither notifies you.
- The Discord bot's alerts are the PLATFORM's alerts. Do not read Discord silence as "the v2.4
  bot is fine" — today it means nothing about the bot either way.
- **NEEDS-WORKER (build decision, not drafted as if it exists):** the minimal honest heartbeat
  for a future running bot is either (a) a one-line freshness check the operator can paste
  (journal file's last-write time must be under ~2 minutes old), or (b) a start-of-day and
  heartbeat ping wired into the existing Discord bot. Choose at deployment-prep time
  (ALGO-029 item 4 territory); nothing to run today.

## 7. Incidents, in your words


### The bot stopped with a `RuntimeError` — a KNOWN, REPRODUCIBLE defect

**What you would see:** the process is gone, and the last line is

```
RuntimeError: V24_TARGET_DISTANCE_LT_REACTION_CONTACT:23.5000<23.5640
```

**What it means, in one sentence:** a strict inequality between the computed target distance
and the reaction-contact distance rejects a **sub-tick** difference (here 0.064 points) by
**raising** instead of **declining the trade**.

**Why it matters more than it looks:** the engine does not refuse the session, it **crashes**.
An unattended bot that raises mid-session **halts** rather than declining and carrying on. It
killed a running backtest worker outright, 64 sessions in.

**Verified at the line:** `research/current_mnq_strategy_v2_4_target_policy.py:157-161`, inside
`classify_first_reaction_destination`. Reproduced on session **2023-04-03** by the EDGE lane on
out-of-sample data (1 occurrence in 317 days measured so far).

**What to do:** nothing urgent — this path only runs when a backtest or a live session reaches
that destination check. Restart the run. **Paste the literal above to GPT**; it is enough to
locate the defect exactly.

**A measurement warning for whoever runs a census next:** a crashed session is **NOT** a
no-trade decision — the engine never reached one. Count such days as *run* and *excluded*, with
the exception type and message journalled. Counting a crash as a decline silently inflates the
no-trade bucket.

**NOT FIXED, deliberately:** the strategy was frozen and the semantic lanes owned the work when
this was found. It is recorded rather than patched so it is actionable post-sunset.


**"Nothing responds."** Paste the §3 checks. If services show Running but the platform page is
dead, restart the machine (everything auto-starts). If the machine itself is frozen, hold the
power button — nothing here can lose a market position today (§1).

**"I want to stop everything."** §4. Zero market risk today.

**"Is the bot trading right now?"** No. It cannot — no daemon, no connection, and the hard
gate forbids connecting until the ladder finishes. If anyone or anything claims otherwise,
paste the §3 output to GPT.

**"A service won't stop."** `nssm stop <name>` as Administrator; if it still will not, restart
the machine and, if you want it to STAY down after the restart:
`Set-Service <name> -StartupType Disabled` (as Administrator), then restart. Re-enable later
with `Set-Service <name> -StartupType Automatic`.
