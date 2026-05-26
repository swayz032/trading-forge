# Library Health Dashboard Queries

Wave 26 Pass G B3 (2026-05-26)

These SQL queries let the operator run a point-in-time health check of the
strategy library: confluence depth, factor quality distribution, directional
coverage, and archetype diversity.

Run any query via Drizzle Studio (`npm run db:studio`) or directly against the
Railway Postgres instance.

---

## 1. Factor quality distribution

*"Is the library improving its confluence depth?"*

Reads the `factor_quality` field written into `config.entry_quality` by the
backfill script and by live graduations (via B2 Gate 2).

```sql
SELECT
  config -> 'entry_quality' ->> 'factor_quality' AS factor_quality,
  COUNT(*)                                        AS strategy_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM   strategies
WHERE  lifecycle_state NOT IN ('GRAVEYARD', 'RETIRED')
  AND  config -> 'entry_quality' ? 'factor_quality'
GROUP BY 1
ORDER BY 2 DESC;
```

Expected output columns: `factor_quality` | `strategy_count` | `pct`
Target health state: `rich` > 50%, `fallback_only` < 15%.

---

## 2. Strategies without factor_quality (missing B3 backfill)

*"Which strategies were graduated before B3 and still need retroactive classification?"*

```sql
SELECT id, name, lifecycle_state,
       config -> 'entry_quality' -> 'confluence_factors' AS confluence_factors
FROM   strategies
WHERE  lifecycle_state NOT IN ('GRAVEYARD', 'RETIRED')
  AND  NOT (config -> 'entry_quality' ? 'factor_quality')
ORDER BY created_at ASC;
```

If this returns rows after the backfill script has been run with `--apply`,
those rows were graduated after the backfill ran and have not yet been
classified by a live graduation (B2 Gate 2 not yet deployed).

---

## 3. Direction distribution (both vs single)

*"How many strategies are bidirectional vs single-direction?"*

```sql
SELECT
  config -> 'direction' AS direction,
  COUNT(*)              AS strategy_count
FROM   strategies
WHERE  lifecycle_state NOT IN ('GRAVEYARD', 'RETIRED')
GROUP BY 1
ORDER BY 2 DESC;
```

`"both"` = bidirectional (long + short entry conditions both present).
`"long"` / `"short"` = single-direction.
A high proportion of `"both"` is good — B1's new extraction prompt targets ≥3
factors AND bidirectional defaults.

---

## 4. Top 10 most-common confluence factors

*"Which confluence factors are the library converging on?"*

```sql
SELECT
  factor,
  COUNT(*) AS strategy_count
FROM (
  SELECT id,
         jsonb_array_elements_text(
           config -> 'entry_quality' -> 'confluence_factors'
         ) AS factor
  FROM   strategies
  WHERE  lifecycle_state NOT IN ('GRAVEYARD', 'RETIRED')
    AND  jsonb_typeof(config -> 'entry_quality' -> 'confluence_factors') = 'array'
) sub
GROUP BY factor
ORDER BY strategy_count DESC
LIMIT 10;
```

Watch for excessive `regime_match` / `structural_setup` dominance — these are
auto-floor factors (see `AUTO_FLOOR_FACTORS` in `confluence-quality-audit.ts`).
A healthy library shows diverse extracted factors alongside the floors.

---

## 5. Top 10 most-common entry indicator archetypes

*"Which entry archetypes are dominating the library?"*

```sql
SELECT
  config ->> 'entry_indicator' AS entry_indicator,
  COUNT(*)                     AS strategy_count
FROM   strategies
WHERE  lifecycle_state NOT IN ('GRAVEYARD', 'RETIRED')
  AND  config ? 'entry_indicator'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 10;
```

DSL compiler canonical values include: `archetype:bounce_off_level`,
`archetype:ict_bias_aligned_continuation`, `opening_range_breakout`,
`ema_crossover`, `mean_reversion`, `momentum_breakout`, etc.

---

## 6. Bidirectional rejection audit (recent)

*"How often is Gate 1 blocking incomplete bidirectional extractions?"*

```sql
SELECT
  result ->> 'rejection_reason' AS rejection_reason,
  result ->> 'empty_side'       AS empty_side,
  input  ->> 'strategy_name'    AS strategy_name,
  created_at
FROM   audit_log
WHERE  action = 'graduation.bidirectional_incomplete_rejected'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 7. Thin-confluence graduation history

*"How many strategies graduated with only auto-fallback factors?"*

```sql
SELECT
  input  ->> 'strategy_name'    AS strategy_name,
  result -> 'factor_quality'    AS factor_quality,
  input  -> 'confluence_factors' AS factors,
  created_at
FROM   audit_log
WHERE  action = 'graduation.thin_confluence_warning'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 8. Library-wide confluence depth over time (from audit_log)

*"Is extraction depth improving after B1's new Gemma prompt deployed?"*

```sql
SELECT
  DATE_TRUNC('day', created_at)   AS day,
  AVG(
    jsonb_array_length(input -> 'confluence_factors')
  )::NUMERIC(4,1)                 AS avg_factors_per_graduation,
  COUNT(*)                        AS graduations
FROM   audit_log
WHERE  action = 'graduation.factor_quality_classified'
  AND  (result ->> 'backfill')::boolean IS NOT TRUE   -- exclude backfill rows
  AND  created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;
```

Backfill rows (`metadata.backfill=true`) are excluded so the time series
reflects live extraction quality, not historical retroactive classification.

---

## Prometheus metrics (Grafana)

| Metric | Labels | Use |
|---|---|---|
| `tf_graduation_factor_quality_total` | `quality=rich\|thin\|fallback_only` | Track quality distribution over time |
| `tf_graduation_bidirectional_rejection_total` | `reason` | Track Gate 1 rejection rate |
| `tf_extraction_confluence_depth_histogram` | (buckets 0-5+) | Visualize extraction depth distribution |

---

*Last updated: Wave 26 Pass G B3 — 2026-05-26*
