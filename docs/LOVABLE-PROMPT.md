# Trading Forge — Lovable Prompt

> Copy everything below the line and paste it into Lovable as your initial prompt.
> This scaffolds the entire dashboard in one shot.

---

## THE PROMPT (copy from here)

```
Build a premium dark trading dashboard called "Trading Forge" — an institutional-grade strategy research platform for futures trading. This is a single-user desktop-first application that connects to an existing Express.js backend API.

## IDENTITY
- Name: "Trading Forge"
- Tagline: "Institutional-Grade Strategy Research"
- Personality: Bloomberg Terminal meets luxury fintech. Quiet confidence. Zero gimmicks.

## COLOR SYSTEM — Black + Amber Gold

### Backgrounds (The Black Stack)
- App background (void): #08080A
- Page background (base): #0E0E12
- Card/panel surface: #141418
- Elevated surface (hover cards, dropdowns): #1A1A20
- Tooltips/popovers: #22222A
- Table row hover, inputs: #2A2A34
Every background has a subtle blue-violet undertone (NOT pure gray).

### Amber-Gold Accent (The Forge Fire)
- Primary accent: #FFB300
- Button gradient: linear-gradient(135deg, #FFB300 0%, #F59E0B 40%, #D4920A 100%)
- Subtle card glow: linear-gradient(135deg, rgba(255,179,0,0.15) 0%, rgba(245,158,11,0.05) 100%)
- Ambient background glow: radial-gradient(ellipse at 50% 0%, rgba(255,179,0,0.04) 0%, transparent 70%)
Full amber scale: #FFF8E1, #FFECB3, #FFD54F, #FFCA28, #FFC107, #FFB300, #F59E0B, #D4920A, #B27A08, #8B6106

### Text
- Primary text (headings, values): #F5F5F7
- Secondary text (body, labels): #A1A1AA
- Muted text (timestamps, metadata): #71717A
- Disabled: #52525B
- Accent text: #FFB300
- Inverse (on amber buttons): #0E0E12

### Trading Signals
- Profit/green: #22C55E (subtle bg: rgba(34,197,94,0.12))
- Loss/red: #EF4444 (subtle bg: rgba(239,68,68,0.12))
- Info/blue: #3B82F6
- Regime/violet: #8B5CF6
- Data/cyan: #06B6D4

### Borders
- Card borders: rgba(255,255,255,0.06)
- Input borders: rgba(255,255,255,0.10)
- Hover borders: rgba(255,255,255,0.16)
- Amber focus: rgba(255,179,0,0.30)

## TYPOGRAPHY
- Sans font: 'Inter' (body, headings)
- Mono font: 'JetBrains Mono' (ALL financial numbers — P&L, prices, percentages, scores)
- Display: 36px/700 (hero P&L metric)
- H1: 28px/700, H2: 22px/600, H3: 18px/600
- Body: 15px/400, Body-sm: 14px/400
- Caption: 13px/500, Micro: 11px/600
- Mono numbers: 20px/600 (large), 15px/500 (medium), 13px/400 (small)

## LAYOUT
- Max width: 1440px centered
- Sidebar: 260px fixed left (collapsible to 72px)
- Top bar: 56px with backdrop-filter blur
- Content: fluid, 24px gutters
- Card grid: 12-column CSS grid

## PAGE STRUCTURE

### Sidebar Navigation
Background #08080A, border-right rgba(255,255,255,0.06).
Logo: "FORGE" wordmark in amber gradient with small flame icon.
Nav groups with micro uppercase labels:

OVERVIEW → Dashboard
RESEARCH → Strategies, Backtests, Monte Carlo
DATA → Data Pipeline, Market Data
INTELLIGENCE → AI Agents, Strategy Scout
LIVE → Paper Trading, Positions
SYSTEM → Settings, Alerts, Audit Log

Active nav item: amber gradient subtle background, 3px amber left border, amber icon.
Default: muted icon + secondary text. Hover: slight bg highlight.

### Top Bar
56px height, base background with backdrop-filter blur(16px).
Left: breadcrumbs. Center: search bar (Cmd+K shortcut badge). Right: bell icon + status dot + settings gear.

## PAGES TO BUILD

### Page 1: Dashboard (/)
The command center.

4 KPI metric cards across the top:
1. "Today's P&L" — large mono number ($2,847.50), sparkline, green/red change badge. This card gets a special amber glow on the top border (1px amber gradient line with blur).
2. "Forge Score" — circular progress ring (87/100), amber fill, score number in center.
3. "Active Strategies" — count (3/5) with mini colored status dots.
4. "Max Drawdown" — dollar amount with threshold progress bar.

Cards: bg #141418, border rgba(255,255,255,0.06), border-radius 14px, padding 20-24px. Hover: translateY(-1px), deeper shadow, border brightens.

Below KPI strip:
- Left (8 cols): Equity curve chart (30-day line chart, amber line on dark bg, barely-visible grid lines)
- Right (4 cols): Strategy Status card (list of strategies with status dots and mini Forge Score badges)

Next row:
- Left (8 cols): Recent Trades table (Symbol, Entry, Exit, P&L columns. P&L cells colored green/red with subtle background tint)
- Right (4 cols): Alerts Feed (scrollable list with severity icons and timestamps)

### Page 2: Strategies (/strategies)
Header: "Strategies" h1 + amber primary "New Strategy" button.
Filter bar: status dropdown, tags multi-select, sort dropdown, search input.
Grid of strategy cards (3 columns):
Each card shows: name, status badge, one-sentence description, Forge Score mini ring, Sharpe ratio, Win%, monthly P&L sparkline, action buttons (View, Backtest, Paper).

### Page 3: Strategy Detail (/strategies/:id)
Hero: strategy name + status badge + tags + description.
Action buttons: Run Backtest (primary), Start Paper, Edit Config, Archive.
Tabs: Overview | Backtests | Monte Carlo | Trades | Config.
Overview: large Forge Score ring + radar chart breakdown, performance metrics table, equity curve, monthly returns heatmap.

### Page 4: Backtests (/backtests)
Data table: Strategy, Timeframe, Period, Trades, Net P&L, Sharpe, Max DD, Forge Score, Status, Date.
Status badges: Running (amber with progress), Completed (green dot), Failed (red dot), Queued (gray pulse dot).

### Page 5: Backtest Detail (/backtests/:id)
Top metric strip: Net P&L, Sharpe, Sortino, Max DD, Win Rate, Profit Factor, Expectancy.
Full-width equity curve chart with trade markers (green ▲ entries, red ▼ exits).
Drawdown chart below (red-tinted area chart).
Side panels: trade list table, MAE vs MFE scatter, win/loss histogram, monthly returns heatmap.

### Page 6: Monte Carlo (/monte-carlo/:id)
Hero: fan chart — layered amber-opacity bands showing percentile corridors (5th-95th, 10th-90th, 25th-75th), solid amber median line, white actual equity line.
Risk metrics grid: probability of ruin, expected max drawdown, confidence of $250/day target, worst-case scenario.
Simulation parameter controls.

### Page 7: Data Pipeline (/data)
Symbol coverage table: Symbol, Timeframe, Earliest, Latest, Records, S3 Path, Status (green check or amber warning).
Data source status cards: Databento (credits remaining), Massive (connection status), Alpha Vantage (requests today/limit).

### Page 8: AI Agents (/agents)
Agent cards showing: name, status (active dot), last run time, ideas found/passed counts, source breakdown.
Discovery pipeline funnel visualization: Ideas Scraped → Filtered → Backtested → Passed MC → Deployed (narrowing amber gradient bars).

### Page 9: Paper Trading (/paper)
Live session: large real-time P&L display (display font), session timer, Stop button.
Position cards with live prices (blink animation on update).
Execution quality panel: slippage, fill rate, latency metrics.

### Page 10: Settings (/settings)
Sections: API Keys (masked inputs), Alert Configuration, Data Sources, Trading Rules, System preferences.

## COMPONENT DETAILS

### Buttons
Primary: amber gradient background, dark text (#0E0E12), border-radius 10px, subtle inner shadow highlight. Hover: brightness(1.08) + amber glow shadow.
Secondary: #1A1A20 bg, #F5F5F7 text, subtle border. Ghost: transparent, muted text. Danger: red-tinted bg + red text.

### Tables
Header: #1A1A20 bg, uppercase caption text, sticky. Rows: 52px height, no alternating colors, hover rgba(255,255,255,0.02). P&L cells: green/red text with matching subtle background. Sort chevrons: amber when active.

### Badges/Pills
24px height, border-radius 6px, micro font weight 600.
Amber, green, red, blue, violet, neutral variants — each with 12% opacity background + matching text + matching 20% opacity border + optional 6px dot indicator.

### Forge Score Ring
Circular progress indicator. Track: #2A2A34. Fill: conic gradient amber. Animates on mount (1200ms ease-out). Center: score number in mono font + "/100" in muted text.
Color thresholds: 0-39 red, 40-59 amber-800, 60-79 amber-500, 80-100 green.

### Inputs
Height 44px, bg #2A2A34, border rgba(255,255,255,0.10), border-radius 10px. Focus: amber border + amber glow ring (0 0 0 3px rgba(255,179,0,0.12)).

### Toasts
Bottom-right, bg #1A1A20, border-radius 12px, deep shadow. Left accent bar (3px): green/red/amber/blue by type. Enter: slide from right with spring easing.

### Modals
Backdrop: rgba(8,8,10,0.80) with blur(8px). Modal: #1A1A20, border-radius 18px, deep shadow. Enter animation: scale(0.96) → scale(1) with opacity.

## ANIMATIONS
- Page transition: fade + translateY(8px), 300ms
- Card hover: translateY(-2px), 200ms
- Metric numbers: count-up on mount, 800ms
- Sparklines: stroke-dashoffset draw, 600ms
- Forge Score ring: conic gradient fill draw, 1200ms
- Table rows: staggered fade-in, 50ms delay each
- Price updates: amber background flash, 400ms fade-out
- All easing: cubic-bezier(0.16, 1, 0.3, 1) — snappy, no bounce

## AMBIENT BACKGROUND GLOW
Add two fixed radial gradient orbs on the #08080A app background:
- Top-right: 600px circle, rgba(255,179,0,0.04) — barely visible warm glow
- Bottom-left: 500px circle, rgba(212,146,10,0.03) — subtle secondary warmth
These are pointer-events: none, z-index: 0. Extremely subtle — you should barely notice them.

## GLASSMORPHISM — SELECTIVE ONLY
Glass effects (backdrop-filter blur + transparency) ONLY on:
- Command palette (Cmd+K overlay)
- Chart tooltips
- Floating action panels
NEVER on: sidebar, cards, tables, modals (these stay solid).

## MOCK DATA
Use realistic trading data for all pages:
- Strategies: "ES Momentum", "NQ Mean Reversion", "CL Breakout", "ES Session Open", "NQ Volatility Expansion"
- Symbols: ES (S&P 500 E-mini), NQ (Nasdaq E-mini), CL (Crude Oil)
- P&L values: realistic ($200-800 range per trade, $2000-5000 daily)
- Forge Scores: range 45-95
- Dates: use current dates

## API INTEGRATION (connect later)
The dashboard will connect to this Express.js API at http://localhost:4000:
- GET /api/strategies, POST /api/strategies, GET /api/strategies/:id
- POST /api/backtests/run, GET /api/backtests, GET /api/backtests/:id
- POST /api/monte-carlo/run, GET /api/monte-carlo/:id
- GET /api/data/symbols, GET /api/data/:symbol/ohlcv
- POST /api/paper/start, GET /api/paper/sessions/:id
For now, use mock data. API integration comes after backend is complete.

## TECH REQUIREMENTS
- React + TypeScript
- TailwindCSS with the color tokens above
- shadcn/ui as base components, restyled to match this spec
- Recharts for analytics charts (fan chart, heatmap, scatter, radar)
- Framer Motion for animations
- Lucide React for icons (20px default, 1.5px stroke)
- React Router for page navigation
- Desktop-first, responsive down to 1024px minimum

## CRITICAL RULES
- This is NOT a crypto dashboard. It's a futures STRATEGY RESEARCH platform.
- Every financial number uses mono font. Every single one.
- No emojis in the UI. No rounded cartoon icons. No playful elements.
- The design should feel like an institutional trading desk, not a retail crypto app.
- Cards and surfaces are SOLID backgrounds, not transparent glass.
- Amber is the ONLY accent color. No blue CTAs, no purple highlights, no multi-color rainbow.
- The ambient background glow is EXTREMELY subtle. If you can clearly see it, it's too strong.
```

## END OF PROMPT

---

## After Lovable Scaffolds

Once the dashboard is running with mock data:

1. **Replace mock data with API calls** — swap static arrays with `fetch('http://localhost:4000/api/...')` calls
2. **Add SSE for real-time** — connect to the Express SSE endpoint for live updates (Phase 6)
3. **Install lightweight-charts** — replace the Recharts equity curves with TradingView lightweight-charts for proper candlestick/price data
4. **Wire up actions** — "Run Backtest" button triggers `POST /api/backtests/run`, etc.
5. **Add TradingView widgets** — embed free widgets for non-CME market overview panels

The Lovable prompt gives you a complete, functional UI with mock data. Backend integration is just swapping data sources.
