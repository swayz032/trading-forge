# n8n Active Workflow Inventory

**Source of truth:** live n8n API (`/api/v1/workflows?active=true`)
**Last regenerated:** 2026-04-28
**Active count:** 26 (`active === true && isArchived !== true`)

> Stale doc warning: regenerate via `npx tsx scripts/n8n-workflow-sync.ts` or
> by re-running the live MCP query. Do NOT cite total-API counts (54/56)
> as "active" — only the 26 below are part of the autonomous system surface.

## Active Workflows (26)

| ID | Name | Nodes | Tags |
|---|---|---:|---|
| `26ruSYvIjqHGOhsd` | 9A-nightly-self-critique | 8 | |
| `sAIrnCVB4iOsodsy` | Weekly Strategy Hunt | 30 | |
| `hPXhUaSC3ScznZE9` | Strategy Tournament | 27 | |
| `u0RcmfuClgRinXAX` | Daily Portfolio Monitor | 14 | |
| `z2c7zJmSx5dNle6P` | 5G-brave-search-scout | 6 | |
| `YuDGQkuej7qybPAB` | Weekly Compliance Re-Parse | 10 | |
| `Z4NcOCDbet8KzjDd` | Nightly Strategy Research Loop | 26 | |
| `gFwNlA3eCHbSb7en` | Pre-Session Compliance Gate | 9 | |
| `2rVOEn4LnMAubTmW` | 5A-weekly-tournament | 7 | |
| `X2IjKuYseGukxKDj` | Macro Data Sync | 12 | |
| `vlCaiWM7F0AH1RRY` | 8A-idea-to-strategy | 11 | |
| `66HEjQavpvirY6g5` | 0A-health-monitor | 14 | |
| `eaq72MwKwCjv7g7F` | Pre-Session Skip Check | 13 | |
| `RumAJUp4iS1TYlNm` | 6D-compliance-gate | 10 | |
| `m6aD7X4ioWfhWaS9` | Monthly Robustness Check | 14 | |
| `J0p8oYkONmN7pYn6` | 3A-workflow-backup | 8 | |
| `LQtqeWAcNOlkqROH` | 8B-source-quality-review | 7 | |
| `WT9sVMzG83rg1L29` | Daily Compliance Check | 9 | |
| `ZMgHYjcTq4YTRQXh` | 5H-reddit-scout | 16 | |
| `TMT3g7HenJ5etiwv` | 5I-tavily-scout | 6 | |
| `PHcD2tFZpzr7kQGF` | Anti-Setup Refresh | 12 | |
| `eCr7cyb0aPArFCZc` | Strategy Generation Loop | 38 | |
| `MIIxmilbgZv3SUBh` | 7A-auto-evolution | 10 | |
| `pVT6svNTljjBoQbW` | 11A-critic-optimization | 7 | |
| `LayXj1mbHh4aGSM9` | Post-Session Skip Review | 8 | |
| `8HKXzNmo9KF59SBu` | 10A-master-orchestration | 8 | |

## Newly Created (inactive — manual activation required)

| ID | Name | Purpose |
|---|---|---|
| `v4eSeAoaEErYp472` | 0Z-openclaw-daily-report | Cron 8AM ET → POST /api/openclaw/daily-report/send → Discord #n8n-daily-report |
| `Ep2Zsu33tMOsaJbE` | 5J-unified-search-router-scout | Cron every 6h → /api/search/strategy-hunt → /api/agent/scout-ideas/strict (replaces 5G/5H/5I) |

## Recently Fixed (2026-04-28)

| ID | Name | Fix |
|---|---|---|
| `Z4NcOCDbet8KzjDd` | Nightly Strategy Research Loop | lmChatOpenAi `model` field changed from string to `{__rl, mode, value}` resourceLocator; removed unsupported `temperature` override (GPT-5 mini only supports default) |
| `sAIrnCVB4iOsodsy` | Weekly Strategy Hunt | Same lmChatOpenAi resourceLocator + temperature fix |
| `eCr7cyb0aPArFCZc` | Strategy Generation Loop | Same lmChatOpenAi fix + `Concept Validated?` IF node strict-boolean fix (rightValue=false, typeValidation=loose) |

## Known Issues (non-blocking)

- Several workflows still use deprecated `continueOnFail` — should migrate to `onError: 'continueRegularOutput'` per n8n v2.x.
- Some lmChatOpenAi nodes are on typeVersion 1.2 (latest is 1.3) — bump opportunistically.
- Vector store tools missing `toolDescription` annotations (cosmetic).

## Verification Commands

```bash
# Live count check
npx tsx -e "
const res = await fetch(process.env.N8N_BASE_URL + '/api/v1/workflows?active=true&limit=100', {
  headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY }
});
const d = await res.json();
const active = d.data.filter(w => w.active === true && w.isArchived !== true);
console.log('Active:', active.length);
"

# Re-sync workflows to disk + detect drift
npx tsx scripts/n8n-workflow-sync.ts
```
