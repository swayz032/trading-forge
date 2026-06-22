# Slumhouse Portal — Design Spec

**Date:** 2026-05-27
**Owner:** Tonio (operator)
**Status:** Brainstorming complete; ready for implementation plan
**Brand umbrella:** Slumdawg Traders
**Portal name:** Slumhouse

---

## §1. Mission

Slumhouse is a **friend/family-facing read-only portal** that sits next to the existing Trading Forge admin dashboard. Operator's friends — non-traders, non-tech — log in via Discord OAuth and see their bot's activity in **street-translated plain English**. The admin dashboard (Trading Forge) is untouched.

**Scope decision (brainstorm Q1):** Two-portal split. One repo, two front-ends, shared backend. Trading Forge admin = operator firehose; Slumhouse = friend portal.

**What Slumhouse is NOT:**
- A trading interface — friends cannot place trades, halt the bot, or promote strategies
- A separate codebase, backend, or governance layer — every number comes from existing TF systems
- A public/SaaS product — invite-only, Discord-gated, no marketing surface
- A rename of Trading Forge — operator's admin keeps the "Trading Forge" brand

**Production hardening invariant preserved:** Wave 27.5 / Wave 28 / Wave 29 hard gates retain authoritative veto. Slumhouse only READS state; it never writes lifecycle decisions, never calls `routeOrder()`, never mutates governance.

---

## §2. Audience + Core Job

**Audience:** Members of the Slumdawg Traders Discord community — operator's friends, family, and crew. Most have never traded. Operator onboards each one with a TradingView Premium + TradersPost + funded MFFU/Topstep account (per existing `docs/family-onboarding-runbook.md`).

**Core job (brainstorm Q2 — Option A picked, with elements of D folded in):** *"Watch my bag work."* Each friend logs in, sees their own bot trading, knows whether it's making them money today, and trusts the system because they can see every test it passed.

**Three secondary jobs the portal also serves:**
- Talk to Slumdawg (Anam.ai avatar — already authored at `docs/slumdawg-analyst/*`)
- See what new strategies the kitchen is cooking up
- Verify any strategy passed every gate before it touched their account

---

## §3. Information Architecture

**3 pages. No more.** Top-nav pill: **The Crib · The Kitchen · The Recipe**.

| Page | Job | Data lens |
|---|---|---|
| **The Crib** | Home — talk to Slumdawg, glance at today's bot activity, see what's cooking | LIVE bot activity + Discord ingest queue + crew leaderboard |
| **The Kitchen** | Strategy lifecycle pipeline — every play from ingredient → menu | All lifecycle stages, real $$ on the menu strategies |
| **The Recipe** | Strategy validation deep-dive — proof every test passed before this play touched real money | ALL FAKE MONEY — backtest replay + Monte Carlo + 8 other test gates |

Pages dropped from earlier drafts: "My Bag" and "The Rules" — Recipe + Kitchen carry their content.

---

## §4. The Crib (home page)

**Layout** (top to bottom):
1. **Top-nav pill** (centered): The Crib (active) · The Kitchen · The Recipe
2. **Page title block:** "The Crib · Slumdawg's home — talk to him, see what's cooking."
3. **Daily metrics banner** — 5 stats in a horizontal grid:
   - Today's Bag (today's net P&L across all running bots) — green/red dollar number
   - Trades Today (count + W/L breakdown)
   - Open Right Now (count + 1-line position summary)
   - In the Pot (count of strategies currently being tested)
   - Kill Switch (● Green / ● Red)
4. **Main 2-column row:**
   - **Left (Anam stage)** — Slumdawg avatar (Anam.ai video iframe), single "Video with Slumdawg" pill button top-right of the stage card. NO "Voice with Slumdawg" — operator's call.
   - **Right rail (Discord ingest feed)** — "Fresh from Discord" — last 4 strategy drops with status (queued / extracting / graduated · CANDIDATE)
5. **Bottom 2-column row:**
   - **Bottom-left** — "In the Pot · click to peek" — horizontal scroll of strategy chips currently testing, each with stage tag + name + P&L mini + plays count. Click any chip → navigates to The Recipe for that strategy.
   - **Bottom-right (Crew leaderboard)** — top 4 friends this week by P&L with jersey numbers (e.g. `25 Tonio +$3,108 · 11 Cuz +$1,847 · 07 Trav +$924 · 04 Kee +$112`). "Resets Monday."

**Anam.ai wiring:** Use the existing authored assets at `docs/slumdawg-analyst/`:
- System prompt (101 lines, baby-jargon translation table)
- Greeting Option A
- 5 tools schema → `src/server/routes/slumdawg.ts` (already HMAC-gated)

The Crib only renders the Anam iframe + "Video with Slumdawg" launcher; all tool calls flow through `slumdawg.ts`.

---

## §5. The Kitchen (lifecycle pipeline page)

**Layout:**
1. **Top-nav pill** (Kitchen active)
2. **Page title:** "The Kitchen — Where every play gets cooked before it touches your money."
3. **Hero strip** (3-column grid):
   - Left (380px wide) — cooking pot image (`/files/slumdawg-kitchen.png`) full-bleed
   - Middle — eyebrow "In the pot right now" + bold "Slumdawg is cooking 87 plays. 4 made it to the menu." + 1-paragraph plain-English explanation
   - Right — "Kitchen output · last 30 days" + big lime number (e.g. `+$18,420`) + caption "across menu plays" + 12-bar sparkline
4. **6-stage pipeline** (equal-width grid, click any stage → drill-down below):

| Stage (street) | Maps to lifecycle | Subtitle | Count label |
|---|---|---|---|
| **Ingredients** | scout discovery / extraction / graduation | "just dropped" | "cooking down" |
| **Prep Station** | CANDIDATE | "recipes ready to cook" | "on the counter" |
| **On the Stove** | TESTING + SHADOW | "getting tested" | "heat up" |
| **Taste Test** | PAPER | "fake money trial" | "on the spoon" |
| **Small Plates** | DEPLOY_READY + PILOT | "small real money" | "soft launch" |
| **On the Menu** | DEPLOYED | "full real money" | "serving daily" |

5. **"Today's Menu" restaurant card** (renders when "On the Menu" stage is selected — default):
   - Decorative top + bottom rules with `— TODAY'S MENU —` mark
   - Page heading "On the Menu · Plays that survived the kitchen · running for real money right now"
   - Dish rows (one per DEPLOYED strategy), each row:
     - Dish number (01, 02, …)
     - Dish name (strategy name, friendly format) + optional badge (Chef's pick / Hot)
     - 1-sentence plain-English description (e.g. "Bot waits until price stretches too far from the day's average, then bets it snaps back.")
     - Slumdawg's note (italic, warm-yellow) — pulled from latest trade-critique row
     - 10-bar sparkline (last 10 days of daily P&L)
     - Right stats: **`+$8,420` made this month · `208 plays · ~$40 each`** (concrete dollars, NOT R-multiples / PF ratios)

**Translations baked in:**
- `R-multiple` → never shown to friends
- `PF 1.8` → "+$X made this month" (raw dollar P&L)
- `MES/MNQ/MCL` → "Mini-S&P / Mini-Nasdaq / Mini-Oil"
- `lifecycle_state` enum values → cooking station names per table above

---

## §6. The Recipe (strategy validation deep-dive)

**Mental model:** *"Why should I trust this play with my money?"* Recipe = test report card. **Every number on this page is fake money / simulated / replayed — never live.**

**Layout:**
1. **Top-nav pill** (Recipe active)
2. **Back link** — "← Back to The Kitchen"
3. **Hero with command-center image backdrop** (`/files/slumdawg-command.png`, dark overlay):
   - Strategy name (e.g. `vwap-band-mini-s&p`) + stage badge (e.g. "● Ready for the Menu")
   - 1-paragraph plain-English description
   - **Caveat line** (small, lime accent): "Recipe stage — **none of this is live money**. Numbers below are from backtest replay and Monte Carlo simulation."
   - Right side: Slumdawg Score ring (e.g. `84` out of 100) + label "Slumdawg Score"

4. **Main 2-column panels:**

   **Left — 📼 Backtest panel**
   - Header: "Backtest" + 📼 Replay pill (blue)
   - Caption: "If the bot had been running on the **last 12 months** of real market data, here's what would've happened. None of it actually did."
   - 4 KPI cells in 2×2 grid:
     - Total made (green) + "across N plays" subline
     - Per play (ink) + "average win-or-lose" subline
     - Worst day (red) + "single rough session" subline
     - Winning days (ink) + "of 252 trading days" subline
   - Equity curve (SVG path, lime fill + stroke) below the divider
   - Curve footer: "how the account would've grown · last 12 months"

   **Right — 🧪 Monte Carlo panel**
   - Header: "Monte Carlo" + 🧪 What-if pill (warm orange)
   - Caption: "We ran **1,000 fake years** using the bot's playstyle. None of these actually happened — it's a stress test for what *could* happen."
   - 5 rows:
     - Chance the account blows up this year → "3 outta 100" (green)
     - Bad year — money lost → "−$2,840" (red)
     - Good year — money made → "+$94,200" (green)
     - Most likely year → "+$42,500" (green)
     - Verdict → "Survives ✓" (green)
   - Survival score bar (gradient lime) at bottom with label "Survival score · 84 / 100"

5. **Bottom 2-column row:**

   **Left — 📼 Backtest Calendar (narrower)**
   - Header: "Backtest Calendar" + 📼 Replay pill + ‹ May 2026 ›
   - Caption: "Day-by-day P&L from the backtest. Green = profitable, red = loss, darker = bigger. **None of these are real trades.**"
   - 7-col calendar grid with single-letter day headers (M T W T F S S)
   - Each day cell: aspect-ratio 1:1, day number + condensed daily $$ (e.g. `+1.2K`, `−430`)
   - 4 green-intensity tiers + red for losing days
   - Footer row inline: Month +$X · Green N · Red N · Best +$X · Worst −$X

   **Right — Other Tests vertical feed (340px wide)**
   - Header: "Other Tests"
   - Subhead: "Every other system this play had to pass. Green = passed, amber = warning, red = failed."
   - 8 rows, each = `[pass/warn/fail dot] [Test name] [one-sentence "we did X. Result: Y." in street voice]`. **Stat column dropped — the dot is the verdict, the sentence is the proof.**

   **The 8 tests (street name → TF system):**

| Street Name | Maps to TF system | Sentence template |
|---|---|---|
| **Surprise Test** | Walk-Forward folds (`wfe_overall`) | "Hid pieces of history from the bot, made it trade them blind. Won N outta M." |
| **Sloppy Bot Test** | B15 Parameter Robustness Battery (SDR/PSI/RWS) | "Cranked all its dials 20% off. Still cashed out." |
| **Worst Day Test** | A14 Black Swan | "Played the 2020 crash. Lost a week of profit, then bounced back." (amber = lost some, green = unaffected) |
| **Every Mood Test** | B10 Multi-Regime Performance | "Made the bot play in 5 kinds of markets — trending, choppy, crashing, sleeping, wild. Won every one." |
| **Real or Lucky** | A4 Frankenstein curve-fit / PBO Bailey | "Shuffled its wins around to see if it was just hot. Wasn't. Got real game." |
| **Preseason** | Paper trading (`paper_positions`) | "30 days of fake money, real market. Pocketed +$X in practice." |
| **Real-Time Match** | Wave 29 SHADOW divergence gate | "Watched the bot call live shots for a week. Same calls as the test said." |
| **Plays Clean** | Compliance enforce mode (Wave 27.5 Pass C) | "Followed every house rule. Won't get the account shut down." |

---

## §7. Backend mapping (every UI element → existing TF data)

| UI surface | TF source of truth |
|---|---|
| Crib · Today's Bag | `paper_positions` SUM(net_pnl) WHERE closedAt::date = today |
| Crib · Trades Today | `paper_positions` COUNT + W/L breakdown WHERE closedAt::date = today |
| Crib · Open Right Now | `paper_positions` WHERE status = 'open' |
| Crib · In the Pot | `strategies` COUNT WHERE lifecycle_state IN ('CANDIDATE','TESTING','SHADOW','PAPER') |
| Crib · Kill Switch | `kill_switch.isHaltedForProduction()` |
| Crib · Fresh from Discord | scout-discovery ingest queue (existing scout pipeline) |
| Crib · In the Pot feed (horizontal) | `strategies` WHERE lifecycle_state IN testing-stages, ORDER BY recent activity |
| Crib · Crew leaderboard | `slumhouse_users` JOIN `paper_positions` GROUP BY user, last 7 days |
| Kitchen · stage counts | `strategies` GROUP BY lifecycle_state |
| Kitchen · Today's Menu dishes | `strategies` WHERE lifecycle_state = 'DEPLOYED' |
| Kitchen · per-dish "$X made this month" | `paper_positions` SUM(net_pnl) WHERE strategy_id + closedAt month = current |
| Kitchen · Slumdawg's note (per dish) | latest `trade_critique` row (plain-English block) |
| Kitchen · per-dish sparkline | last 10 days of `paper_positions` daily P&L |
| Recipe · Backtest panel | latest `backtests` row for strategy (total_pnl, trades count, daily_pnls, equity_curve) |
| Recipe · Monte Carlo panel | MC run output (`probability_of_ruin_ci.ci_high`, percentile bands) |
| Recipe · Slumdawg Score | composite from `strategy_health_scores` (Wave 28 Pass A) — 13-subsystem normalized score |
| Recipe · Backtest Calendar | `backtests.daily_pnls` JSONB |
| Recipe · Surprise Test | `walk_forward.wfe_overall`, fold pass count |
| Recipe · Sloppy Bot Test | B15 battery SDR / PSI / RWS thresholds |
| Recipe · Worst Day Test | A14 Black Swan output |
| Recipe · Every Mood Test | B10 MRP per-regime results |
| Recipe · Real or Lucky | A4 Frankenstein + PBO `pbo_overall_p_value` |
| Recipe · Preseason | `paper_positions` SUM over last 30 days WHERE paper_account_routing != null |
| Recipe · Real-Time Match | `lifecycle_shadow_signals` divergence_pct (Wave 29 Pass A.3) |
| Recipe · Plays Clean | compliance_mode = 'enforce' run pass rate |

**No new schema work expected** — every data point above is already persisted. New code is route handlers + frontend components.

---

## §8. Auth + Hosting

**Auth: Discord OAuth.**

Flow:
1. Friend lands on `/slumhouse` → redirected to `/slumhouse/login`
2. Login page: lime+black 2-pane card, full-bleed Slumdawg showcase image right pane, "Sign in with Discord" button left
3. Click → standard Discord OAuth (`discord.com/oauth2/authorize?...&scope=identify`)
4. Callback → `/slumhouse/auth/callback` exchanges code for Discord user ID
5. Lookup `slumhouse_users.discord_user_id` → if found, session cookie set; if not, "Get the code from Tonio" landing screen
6. Operator-only admin route on TF dashboard to map `discord_user_id → broker_account_id + jersey_number`

**New table:**
```sql
CREATE TABLE slumhouse_users (
  discord_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  jersey_number INTEGER,
  broker_account_id TEXT REFERENCES broker_accounts(account_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);
```

**Hosting (no new infra):**
- Slumhouse routes mounted at `/slumhouse/*` on existing TF API (tower :4000 via NSSM)
- Existing tower-relay-client forwards HTTP frames from Railway public URL → tower
- Friends DM'd `https://tf-relay-production.up.railway.app/slumhouse` in Discord
- The tower is the single point of failure (same risk surface as TF today; no new exposure)

**Single point of failure mitigation:** Slumhouse availability matches TF API availability. When tower is down, Slumhouse is down — friends see the same outage messaging as the dead-mans-heartbeat alerts already produce.

---

## §9. Visual Identity

**Pinned in `feedback_visual_identity.md`:**
- Pure black (#000) background
- Lime green accent (#a3ff12 — replaces emerald from older spec)
- Slim flat black glassy cards with hairline borders (1px rgba(20,20,20,1) = #141414)
- Top-nav pill (no sidebar)
- Premium fintech feel, NOT marketing copy
- Bulldog mascot reserved for brand-mark slot
- Showcase image (`slumdawg-showcase.png`) for login
- Command-center image (`slumdawg-command.png`) for Recipe hero
- Cooking-pot image (`slumdawg-kitchen.png`) for Kitchen hero

**Typography:** system stack (-apple-system, sans-serif). Display weight 700-800 for numbers + headers; body 12-14px for prose; eyebrow labels 10-11px UPPERCASE 0.08-0.14em letter-spacing.

**Data-source pills (used on every page section that renders fake data):**
- 📼 **REPLAY** — blue (`#60a5fa`) — historical backtest / past data
- 🧪 **WHAT-IF** — warm (`#ffb84d`) — simulation / Monte Carlo / stress test
- 🍃 **PAPER** — lime (`#a3ff12`) — real market, fake money
- 📓 **NOTES** — gray (`#bbb`) — narrative commentary

---

## §10. Production-hardening alignment

**No new subsystems** in the production-hardening sense — Slumhouse adds:
- Frontend (read-only, no governance)
- Auth table (`slumhouse_users`, 5 columns, append-only mapping)
- Route handlers at `/slumhouse/*` (read-only DB queries)
- Discord OAuth flow

**No changes to:**
- Lifecycle state machine
- Hard gates (Wave 27.5 / Wave 28 / Wave 29)
- Audit log writers
- Kill switch
- Broker router
- Backtester / MC engine / Walk-Forward
- Trade critique service
- Pattern aggregator
- Scout pipeline

**System-map sync mandate:** After implementation, run `npm run system-map:sync` + `system-map:check`; register subsystems `slumhouse_routes`, `slumhouse_users_table`, `slumhouse_discord_oauth`, `slumhouse_frontend`.

**Multi-pass dispatch pattern:** Implementation plan should split into ≥3 passes (auth + route handlers; The Crib + Anam wiring; The Kitchen + Recipe). Each pass runs through `paper-parity` + `observability-reliability` + architect close before next pass dispatches.

**Family-distribution compliance:**
- Discord auth respects "personal device only" Topstep rule — Slumhouse is operator-side rendering of FRIEND'S state, not running their bot
- No MFFU collaborative-trading risk — each friend sees ONLY their own account's data (scoped by `broker_account_id` from `slumhouse_users` lookup)
- Read-only model means friends can't accidentally trigger trades or break compliance

---

## §11. Out of scope (explicitly NOT in this design)

- Renaming Trading Forge admin → it stays as is
- Slumhouse mobile app — desktop browser only (Discord clickthrough flow assumes desktop)
- Discord bot in-channel commands (Slumhouse is a web portal, not a Discord bot extension)
- Notifications back to Discord (consider Wave +1: post big wins to a `#slumdawg-wins` channel)
- Voice-with-Slumdawg (Anam voice mode) — operator chose video-only; voice is a future-wave consideration
- Email/password auth — operator chose Discord OAuth; if a future friend isn't on Discord, that's an explicit blocker, not a fallback
- Hit-rate / win-rate display — Wave 23 spec mandate: win rate is OBSERVED only, never a target/header
- Pine file download via Slumhouse — friends already receive Pine via DM per `docs/family-onboarding-runbook.md`; Slumhouse is monitoring, not distribution

---

## §12. Glossary — what every street name maps to

| Slumhouse term | Real meaning |
|---|---|
| The Crib | Slumhouse home page |
| The Kitchen | Strategy lifecycle pipeline view |
| The Recipe | Per-strategy validation deep-dive |
| The Bag | Net P&L (today's, this month's, etc.) |
| The Pot | Strategies currently in testing stages |
| Ingredients | Scout-discovery raw drops (YouTube videos, Discord links) |
| Prep Station | CANDIDATE-stage strategies |
| On the Stove | TESTING + SHADOW stage |
| Taste Test | PAPER stage |
| Small Plates | DEPLOY_READY + PILOT stage |
| On the Menu | DEPLOYED stage |
| Tossed | GRAVEYARD stage |
| Slumdawg Score | Composite-health 0–100 score from Wave 28 |
| Cook | A play / trade |
| Plays served | Trade count |
| Dish | A strategy |
| Slumdawg's Word / Note | Trade critique GPT-5.4 plain-English block |
| Money Calendar | Daily P&L heatmap |
| Survive Test | Monte Carlo + B14 Survival Twin |
| Surprise Test | Walk-Forward folds |
| Sloppy Bot Test | B15 Parameter Robustness |
| Worst Day Test | A14 Black Swan |
| Every Mood Test | B10 Multi-Regime Performance |
| Real or Lucky | A4 Frankenstein + PBO |
| Preseason | Paper trading |
| Real-Time Match | Wave 29 SHADOW divergence |
| Plays Clean | Compliance enforce mode |

---

## §13. Implementation phasing (preview — actual plan in writing-plans pass)

**Pass 1 — Foundation (paper-parity + observability):**
- `slumhouse_users` migration
- Discord OAuth flow + callback route
- Operator admin route to map discord_user_id → broker_account_id
- `/slumhouse/login` page + session cookie
- Audit-log events: `slumhouse.login_success`, `slumhouse.login_unmapped_user`, `slumhouse.session_started`

**Pass 2 — The Crib (paper-parity + observability):**
- `/slumhouse` route renders The Crib
- Daily metrics banner data endpoint
- "Fresh from Discord" + "In the Pot" + Crew leaderboard endpoints
- Anam.ai iframe wiring (reuse existing `slumdawg.ts` HMAC routes)
- Frontend components: nav pill, banner, anam-stage, discord-feed, pot-strip, crew-leaderboard

**Pass 3 — The Kitchen (paper-parity + critic-optimizer):**
- `/slumhouse/kitchen` route + drill-down per stage
- Pipeline aggregation query (count per `lifecycle_state`)
- Today's Menu restaurant card render
- "Slumdawg's note" pulled from `trade_critique` latest row per strategy

**Pass 4 — The Recipe (backtest-core + paper-parity):**
- `/slumhouse/recipe/:strategy_id` route
- Backtest panel data (from `backtests` table)
- Monte Carlo panel (from MC run output)
- Backtest Calendar (from `daily_pnls` JSONB)
- 8 Other Tests feed (read each gate's persisted result)
- Slumdawg Score from `strategy_health_scores`

**Pass 5 — Architect close-out (trading-forge-architect):**
- System Map sync; register 4 new subsystems
- CI hard-gate verification (system-map:check + production-isolation + 2026-compliance)
- AGENT-LOGS entry
- Memory updates
- Audit row: `slumhouse.master_close`

**Estimated test footprint:** ~80-120 new vitest across the 4 passes (auth, route handlers, frontend smoke). No new pytest expected — engine is untouched.

---

## §14. Open questions for implementation planning

1. **Slumdawg Score normalization** — does the Wave 28 composite score map cleanly to 0–100 friend-facing, or does it need a separate display normalizer? (Today the composite is `[0,1]` with 4-state availability tag.)
2. **What if a strategy doesn't have all 8 Other Tests yet?** Show the row in muted state with "Not run yet" instead of pass/fail. Implementation plan needs to enumerate which TF tests are universally run vs which are opt-in.
3. **First-time friend onboarding** — when `slumhouse_users.broker_account_id` is null (Discord ID exists but operator hasn't mapped it yet), show a "Tonio hasn't connected your account yet — DM him" screen instead of erroring out.
4. **Anam.ai usage cost** — Anam billing per-minute on video. Should The Crib auto-start the avatar, or require explicit click? (Recommendation: explicit click — friends may leave the tab open.)
5. **Crew leaderboard scoping** — do friends see their OWN P&L only, or everyone's? (Brainstorm answer: everyone's, with display_name + jersey_number. But P&L is sensitive — confirm operator's intent before exposing peer dollar amounts.)

---

---

## §15. Visual reference artifacts

Mockups produced during the brainstorming pass, saved at `.superpowers/brainstorm/833-1779853154/content/`:

| File | Purpose |
|---|---|
| `login-v5.html` | Login page — full-bleed Slumdawg showcase image right pane, lime accents |
| `slumhouse-home-v2.html` | The Crib — metrics banner + Anam stage + Discord feed + In the Pot + Crew |
| `kitchen-v4.html` | The Kitchen — premium menu treatment, dollar metrics, sparklines, 6-stage pipeline |
| `recipe-v6.html` | The Recipe — command-center hero + Backtest + Monte Carlo + Calendar + Other Tests feed (street-translated) |
| `slumdawg-showcase.png` | Login right-pane hero image |
| `slumdawg-kitchen.png` | The Kitchen hero image |
| `slumdawg-command.png` | The Recipe hero image |

Implementation should treat these as the **visual contract** — color, layout, spacing, density, tone. Markup is illustrative; the contract is the look.

---

**End of spec. Ready for `writing-plans` skill to convert to implementation plan.**
