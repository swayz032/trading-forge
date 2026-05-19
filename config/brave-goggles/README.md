# Brave Quant Goggle — Setup Guide

The `trading-forge-quant.goggle` file in this directory is a custom Brave Search ranking config that:
- **Boosts** academic + quant research sources (arxiv, SSRN, quantpedia, robotwealth, quantitativo, quant.stackexchange, r/algotrading, etc.)
- **Downranks** content farms (medium, investopedia, benzinga, seekingalpha) and short-form video
- **Discards** pump-and-dump signal services and social-media noise

It's **100% free** — Goggles are a free Brave Search API feature, no extra credits required.

## Two ways to deploy

### Option A — Submit via Brave UI (easiest, 5 min, requires login)

1. Go to **https://search.brave.com/goggles/create**
2. Sign in with your Brave account
3. **Title**: `Trading Forge — Quant Research`
4. **Description**: `Boosts academic + quant sources, downranks content farms.`
5. **Public**: leave OFF (private goggle, no Brave staff review needed)
6. Paste the contents of `trading-forge-quant.goggle` into the editor
7. Click **Create**
8. Copy the resulting URL (looks like `https://search.brave.com/goggles/discover/...`)
9. Paste it into `.env`:
   ```
   BRAVE_QUANT_GOGGLE_URL=<the-url>
   ```
10. Restart Trading Forge: `pm2 restart trading-forge-api --update-env`

### Option B — Host as public Gist (no Brave login required, ~10 min)

1. Go to **https://gist.github.com**
2. Create a new public gist with the file contents (filename: `trading-forge-quant.goggle`)
3. Click **Create public gist**
4. Click **Raw** to get the raw URL (looks like `https://gist.githubusercontent.com/.../raw/.../trading-forge-quant.goggle`)
5. Paste into `.env`:
   ```
   BRAVE_QUANT_GOGGLE_URL=<the-raw-gist-url>
   ```
6. Restart Trading Forge: `pm2 restart trading-forge-api --update-env`

## Verify it's working

After deployment + restart:

```bash
curl -sS -X POST http://localhost:4000/api/search/strategy-hunt \
  -H "Content-Type: application/json" \
  -d '{"intent":"momentum","query":"NQ futures backtest","maxResults":5}' \
  | jq '.results | map(select(.source == "brave"))'
```

You should see Brave results now favoring arxiv/ssrn/quantpedia/robotwealth/quantitativo over generic blogs.

## Tuning

Edit `trading-forge-quant.goggle` and re-submit. Boost values 1-10 (10 strongest), downrank values same scale. After 7 days of burn-in, watch which sources actually surface real strategies and adjust accordingly.
