# Trading Forge — Lovable Design Specification

> Premium dark dashboard with amber-gold accent system.
> Enterprise-grade. Institutional feel. Zero gimmicks.
> Built for Lovable (React + TailwindCSS + shadcn/ui).

---

## Identity

**Name:** Trading Forge
**Tagline:** "Institutional-Grade Strategy Research"
**Personality:** Quiet confidence. Bloomberg meets luxury fintech. The interface doesn't shout — it commands.
**Target:** Single power user (not SaaS). Every pixel serves the operator.

This is NOT Aspire. No blue accents. No gray two-tone surfaces. No agent avatars. No canvas drag-drop widgets. Trading Forge is its own product — dark, warm, data-dense, and ruthlessly focused on trading performance.

---

## Color System

### Foundation — The Black Stack

| Token | Hex | Usage |
|---|---|---|
| `--bg-void` | `#08080A` | App background, deepest layer |
| `--bg-base` | `#0E0E12` | Page background, main content area |
| `--bg-surface` | `#141418` | Cards, panels, primary containers |
| `--bg-elevated` | `#1A1A20` | Hoverable cards, dropdowns, modals |
| `--bg-overlay` | `#22222A` | Tooltips, popovers, secondary surfaces |
| `--bg-subtle` | `#2A2A34` | Table row hover, input backgrounds |

> Note: Every background has a subtle blue-violet undertone (not pure gray) — this creates warmth under amber light and prevents the "dead gray" look.

### Amber-Gold Accent System — The Forge Fire

| Token | Hex | Usage |
|---|---|---|
| `--amber-50` | `#FFF8E1` | Subtle tinted text, highlight glow |
| `--amber-100` | `#FFECB3` | Badges, soft accent backgrounds |
| `--amber-200` | `#FFD54F` | Active tab indicators, focus rings |
| `--amber-300` | `#FFCA28` | Primary buttons, key metrics |
| `--amber-400` | `#FFC107` | Hero accent, CTA hover state |
| `--amber-500` | `#FFB300` | **Primary accent** — navigation active, links |
| `--amber-600` | `#F59E0B` | Secondary buttons, badge text |
| `--amber-700` | `#D4920A` | Chart accent lines, sparklines |
| `--amber-800` | `#B27A08` | Muted accents, borders |
| `--amber-900` | `#8B6106` | Subtle backgrounds with amber wash |

**The Golden Gradient** (signature element):
```css
--gradient-forge: linear-gradient(135deg, #FFB300 0%, #F59E0B 40%, #D4920A 100%);
--gradient-forge-subtle: linear-gradient(135deg, rgba(255,179,0,0.15) 0%, rgba(245,158,11,0.05) 100%);
--gradient-forge-glow: radial-gradient(ellipse at 50% 0%, rgba(255,179,0,0.12) 0%, transparent 70%);
```

### Text Hierarchy

| Token | Hex | Usage |
|---|---|---|
| `--text-primary` | `#F5F5F7` | Headings, key values, P&L numbers |
| `--text-secondary` | `#A1A1AA` | Body text, descriptions, labels |
| `--text-muted` | `#71717A` | Timestamps, metadata, placeholders |
| `--text-disabled` | `#52525B` | Disabled inputs, inactive tabs |
| `--text-amber` | `#FFB300` | Accent text, active navigation |
| `--text-inverse` | `#0E0E12` | Text on amber buttons |

### Semantic Colors — Trading Signals

| Token | Hex | Usage |
|---|---|---|
| `--green-profit` | `#22C55E` | Positive P&L, winning trades, uptrend |
| `--green-subtle` | `rgba(34,197,94,0.12)` | Profit badge background |
| `--red-loss` | `#EF4444` | Negative P&L, losing trades, drawdown |
| `--red-subtle` | `rgba(239,68,68,0.12)` | Loss badge background |
| `--blue-info` | `#3B82F6` | Informational states, links |
| `--blue-subtle` | `rgba(59,130,246,0.12)` | Info badge background |
| `--violet-regime` | `#8B5CF6` | Regime detection indicator |
| `--cyan-data` | `#06B6D4` | Data pipeline, streaming status |

### Borders & Dividers

| Token | Hex | Usage |
|---|---|---|
| `--border-subtle` | `rgba(255,255,255,0.06)` | Card borders, dividers |
| `--border-default` | `rgba(255,255,255,0.10)` | Input borders, table lines |
| `--border-hover` | `rgba(255,255,255,0.16)` | Hover state borders |
| `--border-amber` | `rgba(255,179,0,0.30)` | Active/focused element borders |
| `--border-amber-glow` | `rgba(255,179,0,0.15)` | Glow ring on focused cards |

---

## Typography

**Font Stack:**
```css
--font-sans: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
```

| Scale | Size | Weight | Line Height | Letter Spacing | Usage |
|---|---|---|---|---|---|
| `display` | 36px | 700 | 1.1 | -0.02em | Dashboard hero metric (today's P&L) |
| `h1` | 28px | 700 | 1.2 | -0.015em | Page titles |
| `h2` | 22px | 600 | 1.25 | -0.01em | Section headings |
| `h3` | 18px | 600 | 1.3 | -0.005em | Card titles |
| `h4` | 16px | 600 | 1.4 | 0 | Widget headers |
| `body` | 15px | 400 | 1.6 | 0 | Default paragraph text |
| `body-sm` | 14px | 400 | 1.5 | 0 | Table cells, descriptions |
| `caption` | 13px | 500 | 1.4 | 0.01em | Labels, metadata |
| `micro` | 11px | 600 | 1.3 | 0.04em | Badges, ticker values, timestamps |
| `mono-lg` | 20px | 600 | 1.2 | 0.02em | P&L values, prices |
| `mono-md` | 15px | 500 | 1.3 | 0.02em | Table numbers, trade data |
| `mono-sm` | 13px | 400 | 1.3 | 0.02em | Timestamps, IDs |

> All financial numbers (P&L, prices, percentages, Forge Scores) use `font-mono`. Always.

---

## Spacing & Layout

### Spacing Scale (4px base)
```
1: 4px   |  2: 8px   |  3: 12px  |  4: 16px
5: 20px  |  6: 24px  |  8: 32px  |  10: 40px
12: 48px |  16: 64px |  20: 80px |  24: 96px
```

### Layout Grid
```
Max width: 1440px (centered, with 24px side padding)
Sidebar: 260px fixed (collapsible to 72px icon-only)
Content: fluid, fills remaining space
Gutter: 24px between columns
Card grid: 12-column CSS grid
```

### Page Regions
```
┌─────────────────────────────────────────────────────┐
│  Top Bar (56px) — breadcrumb + search + alerts      │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ Sidebar  │  Page Content                            │
│ (260px)  │  ┌────────────────────────────────────┐  │
│          │  │  Page Header (title + actions)      │  │
│  Logo    │  ├────────────────────────────────────┤  │
│  Nav     │  │  Metric Strip (KPI cards)          │  │
│  Groups  │  ├────────────────────────────────────┤  │
│  ...     │  │  Primary Content (charts, tables)  │  │
│          │  ├────────────────────────────────────┤  │
│          │  │  Secondary Content (detail panels) │  │
│          │  └────────────────────────────────────┘  │
│  User    │                                          │
│  Prefs   │                                          │
└──────────┴──────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Sidebar Navigation

```
Background: --bg-void (#08080A)
Border-right: 1px solid --border-subtle
Width: 260px (72px collapsed)
Padding: 16px 12px

Logo Area:
  - "FORGE" wordmark in --amber-500 with subtle gradient
  - Micro flame icon (amber) left of text
  - Font: 18px, 800 weight, letter-spacing: 0.08em
  - Collapsed: flame icon only, centered

Nav Groups:
  - Group label: --text-muted, micro size, uppercase, 0.08em spacing
  - Spacing: 8px between items, 24px between groups

Nav Item (default):
  - Height: 40px
  - Padding: 0 12px
  - Border-radius: 8px
  - Icon: 20px, --text-muted
  - Text: body-sm, --text-secondary
  - Hover: bg rgba(255,255,255,0.04), text --text-primary
  - Transition: all 150ms ease

Nav Item (active):
  - Background: --gradient-forge-subtle
  - Left border: 3px solid --amber-500 (inset)
  - Icon: --amber-500
  - Text: --text-primary, font-weight 500
  - Subtle box-shadow: inset 0 0 20px rgba(255,179,0,0.05)

Groups:
  OVERVIEW          → Dashboard
  RESEARCH          → Strategies, Backtests, Monte Carlo
  DATA              → Data Pipeline, Market Data
  INTELLIGENCE      → AI Agents, Strategy Scout
  LIVE              → Paper Trading, Positions
  SYSTEM            → Settings, Alerts, Audit Log
```

### 2. Top Bar

```
Height: 56px
Background: --bg-base with backdrop-filter: blur(16px) saturate(150%)
Border-bottom: 1px solid --border-subtle
Padding: 0 24px
Display: flex, align-items: center, justify-content: space-between

Left: Breadcrumb
  - Separator: "/" in --text-disabled
  - Current page: --text-primary
  - Parent pages: --text-muted, clickable

Center: Search (Cmd+K)
  - Width: 400px max
  - Background: --bg-surface
  - Border: 1px solid --border-default
  - Border-radius: 10px
  - Placeholder: "Search strategies, backtests..." in --text-disabled
  - Shortcut badge: "⌘K" right-aligned, micro, --text-disabled, bg --bg-subtle

Right: Quick Actions
  - Alert bell icon with amber dot indicator (if unread)
  - System status dot (green=healthy, amber=degraded, red=down)
  - Settings gear icon
  - All icons: 20px, --text-muted, hover --text-primary
```

### 3. Metric Cards (KPI Strip)

The signature component. 4 cards across the top of the dashboard.

```
Card Container:
  Background: --bg-surface
  Border: 1px solid --border-subtle
  Border-radius: 14px
  Padding: 20px 24px
  Min-height: 120px
  Position: relative
  Overflow: hidden

  Hover state:
    Border-color: --border-hover
    Transform: translateY(-1px)
    Box-shadow: 0 8px 32px rgba(0,0,0,0.3)
    Transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1)

Card Layout:
  ┌──────────────────────────────┐
  │ ⬡ Label            Sparkline│
  │                              │
  │ $2,847.50          ▲ +12.3% │
  │ vs yesterday: +$340          │
  └──────────────────────────────┘

  Label: caption size, --text-muted, with 16px icon left
  Value: display size (36px), font-mono, --text-primary
  Change: mono-md, --green-profit or --red-loss
  Sub-text: micro, --text-disabled
  Sparkline: 80px wide, 40px tall, stroke --amber-700, no fill

Premium Touch — Ambient Glow:
  On the primary card (Today's P&L), add a subtle top-edge glow:
  &::before {
    content: '';
    position: absolute;
    top: 0; left: 10%; right: 10%;
    height: 1px;
    background: --gradient-forge;
    filter: blur(4px);
    opacity: 0.6;
  }
```

**The 4 Dashboard KPI Cards:**
1. **Today's P&L** — `$2,847.50` with sparkline (amber glow top border)
2. **Forge Score** — `87/100` with circular progress ring (amber fill)
3. **Active Strategies** — `3 / 5` with mini status dots
4. **Max Drawdown** — `$1,240` with threshold bar

### 4. Standard Card

```
Background: --bg-surface
Border: 1px solid --border-subtle
Border-radius: 14px
Padding: 24px
Box-shadow: 0 1px 3px rgba(0,0,0,0.2)

Header:
  Display: flex, justify: space-between, align: center
  Title: h3 size, --text-primary
  Action: ghost button or icon button, --text-muted
  Border-bottom: 1px solid --border-subtle (only if card has sections)
  Padding-bottom: 16px, Margin-bottom: 16px

Variants:
  card-default   → standard
  card-highlight → border: 1px solid --border-amber, subtle amber top glow
  card-success   → left border: 3px solid --green-profit
  card-danger    → left border: 3px solid --red-loss
  card-glass     → backdrop-filter: blur(20px) saturate(150%),
                   background: rgba(20,20,24,0.75),
                   border: 1px solid rgba(255,255,255,0.08)
```

### 5. Buttons

```
Base:
  Font: body-sm, weight 600
  Border-radius: 10px
  Height: 40px (default), 36px (sm), 48px (lg)
  Padding: 0 20px
  Transition: all 150ms ease
  Cursor: pointer

Primary (Amber):
  Background: --gradient-forge
  Color: --text-inverse (#0E0E12)
  Border: none
  Box-shadow: 0 1px 2px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15)
  Hover: brightness(1.08), box-shadow: 0 4px 16px rgba(255,179,0,0.25)
  Active: brightness(0.95), translateY(1px)

Secondary:
  Background: --bg-elevated
  Color: --text-primary
  Border: 1px solid --border-default
  Hover: border-color --border-hover, bg --bg-overlay

Ghost:
  Background: transparent
  Color: --text-secondary
  Border: none
  Hover: bg rgba(255,255,255,0.04), color --text-primary

Danger:
  Background: rgba(239,68,68,0.12)
  Color: --red-loss
  Border: 1px solid rgba(239,68,68,0.20)
  Hover: background rgba(239,68,68,0.18)

Icon Button:
  Width: 40px, Height: 40px, padding: 0
  Border-radius: 10px
  Display: flex, align-items: center, justify-content: center
```

### 6. Data Tables

```
Container:
  Background: --bg-surface
  Border: 1px solid --border-subtle
  Border-radius: 14px
  Overflow: hidden

Header Row:
  Background: --bg-elevated
  Height: 44px
  Font: caption, --text-muted, weight 600, uppercase, 0.04em spacing
  Border-bottom: 1px solid --border-default
  Padding: 0 16px
  Sticky: top 0, z-index 10

Body Row:
  Height: 52px
  Padding: 0 16px
  Font: body-sm (text) or mono-md (numbers)
  Color: --text-secondary (text), --text-primary (numbers)
  Border-bottom: 1px solid --border-subtle

  Hover: background rgba(255,255,255,0.02)
  Clickable rows: cursor pointer, hover bg rgba(255,179,0,0.03)

  Alternating: DO NOT alternate colors. Keep uniform. The hover state is enough.

  P&L Cells:
    Positive: --green-profit, prefix "+"
    Negative: --red-loss, prefix "-"
    Background: respective --*-subtle color

Status Column:
  Pill badge:
    Active/Deployed: bg --green-subtle, text --green-profit
    Paper: bg --blue-subtle, text --blue-info
    Paused: bg --bg-subtle, text --text-muted
    Failed: bg --red-subtle, text --red-loss

Sort Indicators:
  Chevron icon, 12px
  Active: --amber-500
  Inactive: --text-disabled
```

### 7. Charts

**Equity Curve (lightweight-charts):**
```
Background: transparent (inherits card background)
Grid lines: rgba(255,255,255,0.03) — barely visible
Crosshair: --amber-500 with 1px dashed lines
Price line: --amber-400, width 2px
Volume bars: rgba(255,179,0,0.15)
Positive candles: --green-profit (fill), #16A34A (border)
Negative candles: --red-loss (fill), #DC2626 (border)
Trade markers:
  Long entry: ▲ --green-profit
  Long exit: ▼ --green-profit (outlined)
  Short entry: ▼ --red-loss
  Short exit: ▲ --red-loss (outlined)
Tooltip: card-glass variant, mono-md for values
```

**Monte Carlo Fan Chart (Recharts):**
```
Percentile bands (from outer to inner):
  5th-95th: rgba(255,179,0,0.05) fill
  10th-90th: rgba(255,179,0,0.08) fill
  25th-75th: rgba(255,179,0,0.12) fill
  Median (50th): --amber-500, solid line, 2px
  Actual equity: --text-primary (#F5F5F7), solid line, 2px
Axis labels: mono-sm, --text-muted
Grid: rgba(255,255,255,0.03)
```

**Forge Score Breakdown (Recharts radar):**
```
Polygon fill: rgba(255,179,0,0.12)
Polygon stroke: --amber-500, 2px
Dots: --amber-400, 6px, with 2px --bg-surface border
Axis labels: caption, --text-muted
Grid rings: --border-subtle
```

**Monthly Returns Heatmap:**
```
Color scale (red → neutral → green):
  < -5%: #DC2626
  -5 to -2%: #991B1B mixed with surface
  -2 to 0%: --bg-overlay
  0 to 2%: rgba(34,197,94,0.2)
  2 to 5%: rgba(34,197,94,0.4)
  > 5%: #22C55E
Cell: border-radius 6px, 2px gap
Text: mono-sm, --text-primary, centered
```

### 8. Forge Score Ring

The circular progress indicator — a signature UI element.

```
Size: 120px (large) | 64px (medium) | 40px (small)

Ring:
  Track: --bg-subtle, 6px stroke
  Fill: conic-gradient from --amber-700 to --amber-300 (based on score)
  End cap: round
  Animation: 1200ms ease-out on mount (draws from 0 to score)

Center:
  Score number: display (large) or mono-lg (medium), --text-primary
  "/100" suffix: caption, --text-disabled

Color thresholds:
  0-39:  --red-loss track fill
  40-59: --amber-800 track fill
  60-79: --amber-500 track fill (default)
  80-100: --green-profit track fill

Glow (large only):
  filter: drop-shadow(0 0 12px rgba(255,179,0,0.25))
```

### 9. Modals & Overlays

```
Backdrop:
  Background: rgba(8,8,10,0.80)
  Backdrop-filter: blur(8px)

Modal:
  Background: --bg-elevated
  Border: 1px solid --border-default
  Border-radius: 18px
  Box-shadow: 0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)
  Max-width: 560px (default), 800px (wide), 1100px (full)
  Padding: 32px

  Header: h2, --text-primary, 24px bottom margin
  Footer: flex, justify-end, gap 12px, top border --border-subtle, pt 24px, mt 24px

Animation:
  Enter: scale(0.96) opacity(0) → scale(1) opacity(1), 200ms ease-out
  Exit: scale(1) opacity(1) → scale(0.98) opacity(0), 150ms ease-in
```

### 10. Inputs & Form Controls

```
Text Input:
  Height: 44px
  Background: --bg-subtle
  Border: 1px solid --border-default
  Border-radius: 10px
  Padding: 0 14px
  Font: body-sm, --text-primary
  Placeholder: --text-disabled

  Focus:
    Border-color: --amber-500
    Box-shadow: 0 0 0 3px rgba(255,179,0,0.12)
    Outline: none

Select / Dropdown:
  Same as input
  Dropdown panel: --bg-elevated, border-radius 12px, shadow same as modal
  Option hover: rgba(255,179,0,0.06)
  Option active: bg --gradient-forge-subtle, text --text-amber

Toggle:
  Track: --bg-subtle (off), --amber-500 (on)
  Thumb: --text-primary (white)
  Size: 44px x 24px, thumb 20px
  Transition: 200ms ease
```

### 11. Badges & Status Pills

```
Base:
  Display: inline-flex
  Height: 24px
  Padding: 0 10px
  Border-radius: 6px
  Font: micro, weight 600

Variants:
  amber:    bg rgba(255,179,0,0.12),   text --amber-500,     border 1px solid rgba(255,179,0,0.20)
  green:    bg --green-subtle,          text --green-profit,  border 1px solid rgba(34,197,94,0.20)
  red:      bg --red-subtle,            text --red-loss,      border 1px solid rgba(239,68,68,0.20)
  blue:     bg --blue-subtle,           text --blue-info,     border 1px solid rgba(59,130,246,0.20)
  violet:   bg rgba(139,92,246,0.12),   text --violet-regime, border 1px solid rgba(139,92,246,0.20)
  neutral:  bg --bg-subtle,             text --text-secondary,border 1px solid --border-subtle

Dot indicator (before text):
  Width: 6px, Height: 6px, border-radius: full
  Color: matches text color
  Margin-right: 6px
  Animation (active): pulse 2s infinite (opacity 0.5 → 1 → 0.5)
```

### 12. Toast Notifications

```
Position: bottom-right, 24px inset
Max-width: 420px

Container:
  Background: --bg-elevated
  Border: 1px solid --border-default
  Border-radius: 12px
  Padding: 16px 20px
  Box-shadow: 0 16px 48px rgba(0,0,0,0.4)

  Left accent bar: 3px, full height, border-radius left
    success: --green-profit
    error: --red-loss
    warning: --amber-500
    info: --blue-info

Animation:
  Enter: translateX(100%) → translateX(0), 300ms spring(damping: 20, stiffness: 300)
  Exit: opacity(1) → opacity(0), translateY(8px), 200ms ease-in
  Auto-dismiss: 5s (configurable)
```

---

## Page Specifications

### Page 1: Dashboard (Overview) — `/`

The command center. Everything at a glance.

```
┌─────────────────────────────────────────────────────────────┐
│  Page Header                                                │
│  "Dashboard"  h1                        [Last sync: 2m ago] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │Today P&L │  │Forge     │  │Active    │  │Max DD    │   │
│  │$2,847.50 │  │Score: 87 │  │Strats: 3 │  │$1,240    │   │
│  │▲ +12.3%  │  │ ◐ ring   │  │• • •     │  │▂▃▅ bar   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                             │
│  ┌────────────────────────────────┐  ┌──────────────────┐   │
│  │  Equity Curve (30d)            │  │ Strategy Status  │   │
│  │  ╱╲  ╱╲╱╲  ╱╲                │  │ ES Momentum  ● ▲│   │
│  │ ╱  ╲╱    ╲╱  ╲╱              │  │ NQ MeanRev   ● ▬│   │
│  │                    chart       │  │ CL Breakout  ◐ ▼│   │
│  │  lightweight-charts            │  │                  │   │
│  └────────────────────────────────┘  │ Forge Scores     │   │
│                                      │ Radar chart      │   │
│  ┌────────────────────────────────┐  └──────────────────┘   │
│  │  Recent Trades (table)         │                         │
│  │  Symbol | Entry | Exit | P&L   │  ┌──────────────────┐   │
│  │  ES     | 5420  | 5435 | +$750 │  │ Alerts Feed      │   │
│  │  NQ     | 19200 | 19150| -$250 │  │ ⚠ Drawdown > 2% │   │
│  │  ...                           │  │ ✓ Backtest done  │   │
│  └────────────────────────────────┘  └──────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Page 2: Strategies — `/strategies`

```
Header: "Strategies" h1 + [+ New Strategy] primary button

Filter Bar:
  Status dropdown | Tags multi-select | Sort by dropdown | Search input

Strategy Cards (grid, 3 columns):
  ┌────────────────────────────┐
  │  ES Momentum         ● Active│
  │  "Trend-following on ES..."  │
  │                              │
  │  Forge Score    Sharpe  Win% │
  │  ◐ 87          2.4    68%   │
  │                              │
  │  Monthly P&L sparkline       │
  │  ╱╲_╱╲╱╲_╱╲                │
  │                              │
  │  [View] [Backtest] [Paper]   │
  └────────────────────────────┘

  Card hover: border-color --border-amber, subtle lift
```

### Page 3: Strategy Detail — `/strategies/:id`

```
Hero section:
  Strategy name (h1) + status badge + tags
  One-sentence description
  Action buttons: [Run Backtest] [Start Paper] [Edit Config] [Archive]

Tabs: Overview | Backtests | Monte Carlo | Trades | Config

Overview tab:
  - Forge Score ring (large, 120px) with breakdown radar
  - Performance summary table (Sharpe, Sortino, Max DD, Win%, etc.)
  - Equity curve (full width)
  - Monthly returns heatmap
  - Regime performance breakdown

Config tab:
  - JSON editor (Monaco-style) with syntax highlighting
  - Parameter table: name, value, range, description
  - Max 5 parameters enforced (visual indicator)
```

### Page 4: Backtests — `/backtests`

```
Table view (default):
  Columns: Strategy | Timeframe | Period | Trades | Net P&L | Sharpe | Max DD | Forge Score | Status | Date
  Row click → detail page

Status column values:
  Running (with progress bar, amber fill)
  Completed (green dot)
  Failed (red dot)
  Queued (gray dot with pulse)
```

### Page 5: Backtest Detail — `/backtests/:id`

```
Top metrics strip: Net P&L | Sharpe | Sortino | Max DD | Win Rate | Profit Factor | Expectancy

Full-width equity curve with trade markers (lightweight-charts)
Drawdown chart below (area chart, red fill)

Side panels:
  - Trade list (sortable table)
  - MAE vs MFE scatter plot
  - Win/Loss distribution histogram
  - Monthly returns heatmap
  - Holding period distribution
```

### Page 6: Monte Carlo — `/monte-carlo/:id`

```
Fan chart (hero element, full width):
  Percentile bands with amber gradient fills
  Median line prominent
  Actual equity overlay

Risk metrics grid:
  - Probability of ruin
  - Expected max drawdown (95th percentile)
  - Confidence of reaching target ($250/day)
  - Worst-case scenario P&L

Simulation parameters panel:
  - Number of simulations (default: 10,000)
  - Confidence interval selector
  - Distribution method (bootstrap / parametric)
```

### Page 7: Data Pipeline — `/data`

```
Symbol coverage table:
  Symbol | Timeframe | Earliest | Latest | Records | S3 Path | Status
  ES     | 1m        | 2019-01  | 2024-12| 1.2M    | s3://... | ✓ Fresh
  NQ     | 5m        | 2019-01  | 2024-12| 240K    | s3://... | ✓ Fresh

Data source status cards:
  Databento: $XX credits remaining
  Massive: Connection status (green dot or red)
  Alpha Vantage: Requests today / limit
```

### Page 8: AI Agents — `/agents`

```
Agent cards:
  ┌────────────────────────────────────┐
  │  🔬 OpenClaw Strategy Scout   ● Active│
  │  Last run: 2h ago                    │
  │  Ideas found: 12 | Passed: 3        │
  │  Sources: Reddit (4), Academic (6)   │
  │  [View Pipeline] [Run Now]           │
  └────────────────────────────────────┘

Discovery pipeline funnel:
  Ideas Scraped → Filtered → Backtested → Passed MC → Deployed
  47            → 23       → 12         → 3          → 1
  Visual funnel narrowing left to right, amber gradient fill
```

### Page 9: Paper Trading — `/paper`

```
Live session header:
  Large P&L display (real-time, font: display)
  Session duration timer
  [Stop Session] danger button

Position cards (live):
  Symbol | Side | Entry | Current | Unrealized P&L | Duration
  With real-time price blinking on update

Execution quality panel:
  Average slippage | Fill rate | Latency
  Slippage by time-of-day chart
  Live vs Backtest drift chart
```

### Page 10: Settings — `/settings`

```
Sections (vertical tabs or accordion):
  - API Keys (masked inputs, reveal on click)
  - Alert Configuration (thresholds, channels)
  - Data Sources (enable/disable, credentials)
  - Trading Rules (prop firm rules display)
  - System (theme preferences, export data)
```

---

## Animation & Motion

### Philosophy
Animations are functional, not decorative. They communicate state changes and spatial relationships. Fast, precise, no bounce.

### Timing Functions
```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);       /* primary — snappy exit */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);    /* symmetric transitions */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* subtle overshoot (modals only) */
```

### Duration Scale
```
instant: 100ms  — toggle, badge update
fast:    150ms  — hover states, button press
normal:  200ms  — card transitions, tab switch
smooth:  300ms  — modal enter, sidebar collapse
slow:    500ms  — page transition, chart draw
paint:  1200ms  — Forge Score ring animation, equity curve draw-in
```

### Key Animations

**Page transition:** Fade in from opacity 0 + translateY(8px), 300ms --ease-out
**Card hover lift:** translateY(-2px) + shadow expand, 200ms
**Sidebar collapse:** Width 260px → 72px, 300ms --ease-in-out, icons cross-fade
**Metric counter:** Number count-up on mount, 800ms --ease-out
**Sparkline draw:** SVG stroke-dashoffset animation, 600ms --ease-out
**Chart data update:** Crossfade with 150ms opacity transition
**Toast enter:** slideInRight 300ms spring, auto-dismiss after 5s
**Forge Score ring:** Conic gradient draw from 0 → value, 1200ms --ease-out
**Table row enter:** Staggered fade-in, 50ms delay per row, 200ms each
**Real-time price blink:** --amber-50 background flash, 400ms fade-out

---

## Glassmorphism — Selective Use Only

Glass effects are used sparingly for elevated, floating elements only. Never on primary cards or content containers.

```css
.glass-panel {
  background: rgba(20, 20, 24, 0.70);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
}
```

**Used on:** Command palette (Cmd+K), chart tooltips, floating action panels
**NOT used on:** Sidebar, cards, tables, modals (these use solid backgrounds)

---

## Ambient Background — The Forge Glow

A signature element that gives Trading Forge its identity. Subtle warm gradient orbs on the void background that the glass panels can interact with.

```css
.app-background {
  background: #08080A;
  position: relative;
}

.app-background::before {
  content: '';
  position: fixed;
  top: -20%;
  right: -10%;
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, rgba(255,179,0,0.04) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}

.app-background::after {
  content: '';
  position: fixed;
  bottom: -10%;
  left: -5%;
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(212,146,10,0.03) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}
```

> These are extremely subtle — you should barely notice them. They provide warmth to the void without creating distraction. On data-heavy pages, reduce opacity further.

---

## Responsive Behavior

```
≥1440px: Full layout, sidebar expanded, 4-column metric strip
1280-1439px: Sidebar auto-collapsed to 72px, 4-column metrics
1024-1279px: Sidebar hidden (hamburger toggle), 3-column metrics
768-1023px: Single column, stacked cards, simplified charts
<768px: Not primary target (desktop-first) but graceful degradation
```

---

## Iconography

**Library:** Lucide React (consistent with shadcn/ui)
**Size:** 20px default, 16px small, 24px large
**Stroke:** 1.5px (lighter feel than default 2px)
**Color:** Inherits text color, never colored independently except active nav (amber)

Key icons:
```
Dashboard:    LayoutDashboard
Strategies:   Brain
Backtests:    BarChart3
Monte Carlo:  Waves
Data:         Database
Agents:       Bot
Paper Trading: PlayCircle
Positions:    TrendingUp
Settings:     Settings
Alerts:       Bell
Audit Log:    FileText
Search:       Search
```

---

## Tailwind Config Extensions

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        void: '#08080A',
        base: '#0E0E12',
        surface: '#141418',
        elevated: '#1A1A20',
        overlay: '#22222A',
        subtle: '#2A2A34',
        forge: {
          50: '#FFF8E1',
          100: '#FFECB3',
          200: '#FFD54F',
          300: '#FFCA28',
          400: '#FFC107',
          500: '#FFB300',
          600: '#F59E0B',
          700: '#D4920A',
          800: '#B27A08',
          900: '#8B6106',
        },
        profit: '#22C55E',
        loss: '#EF4444',
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        'card': '14px',
        'modal': '18px',
        'button': '10px',
        'input': '10px',
        'badge': '6px',
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.2)',
        'card-hover': '0 8px 32px rgba(0,0,0,0.3)',
        'modal': '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
        'forge-glow': '0 0 24px rgba(255,179,0,0.15)',
        'toast': '0 16px 48px rgba(0,0,0,0.4)',
      },
      animation: {
        'score-ring': 'score-draw 1200ms cubic-bezier(0.16,1,0.3,1) forwards',
        'fade-in': 'fade-in 200ms cubic-bezier(0.16,1,0.3,1)',
        'slide-up': 'slide-up 300ms cubic-bezier(0.16,1,0.3,1)',
        'price-blink': 'price-blink 400ms ease-out',
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
      },
    },
  },
};
```

---

## Lovable Implementation Notes

### Tech Stack (within Lovable)
- **React + TypeScript** (Lovable default)
- **TailwindCSS** with custom config above
- **shadcn/ui** components as base, restyled to match spec
- **Recharts** for custom analytics charts
- **lightweight-charts** (TradingView) for price/equity charts
- **Lucide React** for icons
- **Framer Motion** for page transitions and mount animations

### shadcn/ui Component Restyling
Override these shadcn components to match the spec:
- `Card` → bg-surface, border-subtle, border-radius-card
- `Button` → primary uses gradient-forge, secondary uses bg-elevated
- `Input` → bg-subtle, focus ring amber
- `Table` → header bg-elevated, no alternating rows
- `Badge` → use the badge variant system defined above
- `Dialog` → modal spec with glass backdrop
- `DropdownMenu` → bg-elevated, amber hover
- `Tabs` → ghost style, active tab has amber bottom border
- `Toast` → bottom-right, accent bar left

### File Structure
```
src/
├── components/
│   ├── ui/           (shadcn overrides)
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── TopBar.tsx
│   │   └── PageLayout.tsx
│   ├── dashboard/
│   │   ├── MetricCard.tsx
│   │   ├── EquityCurve.tsx
│   │   ├── ForgeScoreRing.tsx
│   │   ├── RecentTrades.tsx
│   │   └── AlertsFeed.tsx
│   ├── strategies/
│   ├── backtests/
│   ├── monte-carlo/
│   ├── charts/
│   │   ├── FanChart.tsx
│   │   ├── ReturnsHeatmap.tsx
│   │   ├── ScatterMAEMFE.tsx
│   │   └── ForgeRadar.tsx
│   └── common/
│       ├── StatusBadge.tsx
│       ├── PLValue.tsx
│       └── Sparkline.tsx
├── pages/
│   ├── Dashboard.tsx
│   ├── Strategies.tsx
│   ├── StrategyDetail.tsx
│   ├── Backtests.tsx
│   ├── BacktestDetail.tsx
│   ├── MonteCarlo.tsx
│   ├── DataPipeline.tsx
│   ├── Agents.tsx
│   ├── PaperTrading.tsx
│   └── Settings.tsx
├── lib/
│   ├── api.ts
│   ├── formatters.ts    (P&L, dates, percentages)
│   └── constants.ts
└── styles/
    └── globals.css      (CSS custom properties from this spec)
```

---

## Summary — Design DNA

| Principle | Implementation |
|---|---|
| **Dark authority** | Near-black backgrounds with blue-violet undertone |
| **Amber warmth** | Gold accent system that feels like forge fire, not neon |
| **Data density** | Tables, numbers, charts — respect the operator's intelligence |
| **Quiet motion** | Fast, functional animations — no bounce, no jelly |
| **Typographic hierarchy** | Mono for money, sans for everything else |
| **Selective glass** | Only floating elements get blur — content stays solid |
| **Ambient glow** | Subtle warm radial gradients on the void background |
| **Zero chrome** | No decorative borders, no gradients for gradients' sake |

Trading Forge doesn't look like a crypto bro dashboard. It doesn't look like Aspire. It looks like what happens when Bloomberg Terminal aesthetics meet modern dark glassmorphism — institutional confidence with premium warmth.
