# Backtest Concurrency Contract — Full Detail

> Moved verbatim from CLAUDE.md §14b during the 2026-08-18 token-optimization pass.

## §14b. Backtest Concurrency Contract (Phase 14)

**Production-grade concurrency hardening shipped 2026-05-19** after a server crash caused by 6 concurrent backtests × 4 WF parallel workers = 24 simultaneous Python subprocesses → OOM.

### Capacity limits (tunable via .env)

| Env var | Default | Effect |
|---|---|---|
| `MAX_CONCURRENT_BACKTESTS` | `3` | POST /api/backtests returns HTTP 429 when this many are in-flight |
| `WF_MAX_WORKERS` | `2` | Max parallel walk-forward windows per backtest subprocess |
| `BACKTEST_TIMEOUT_MS` | `1800000` (30 min) | Individual backtest hard timeout |
| `BACKTEST_STALENESS_DAYS` | `30` | Promotion blocked if latest backtest is older than this many days (lifecycle TESTING→PAPER and PAPER→DEPLOY_READY gates); write `lifecycle.backtest_stale` audit row and ask operator to re-run |
| `MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION` | `5` | Pass 2B F-9: return_bootstrap warns when projected `n_days > 1.5×` daily history and HARD-CAPS at this multiple. Prevents silently extrapolating MC firm-survival 100× beyond observed return distribution. |

**Load math:** 3 concurrent × 2 WF workers = 6 Python subprocesses. At ~400 MB each = ~2.4 GB for backtest workers — safe on the 32 GB Skytech tower (RTX 5060 8 GB VRAM).

### 429 handling

When `MAX_CONCURRENT_BACKTESTS` is reached, POST /api/backtests returns:
```json
{ "error": "backtest_concurrent_cap", "retry_after_seconds": 30, "active": 3, "cap": 3 }
```
Caller must retry after 30s. Do not queue or block — the 429 is the backpressure signal.

### Orphan cleanup policy

True orphan = `status='running'` for **more than 60 minutes**. On server restart, only rows older than 60 min are swept to `failed`. Rows younger than 60 min are presumed live at the time of crash — left unchanged for operator inspection.

Error message for swept rows: `"Backtest exceeded 1h+ runtime; swept as orphan on server restart."`

This unambiguously distinguishes:
- "Server restart killed a freshly-started run" → row is NOT swept (< 60 min)
- "This row was abandoned for over an hour" → row IS swept (> 60 min)

### Promotion-gate override

For dedicated promotion-gate runs (1 backtest at a time, maximize speed):
```env
WF_MAX_WORKERS=4
MAX_CONCURRENT_BACKTESTS=1
```

### Health endpoint

`/api/health` now includes:
```json
{ "backtestConcurrency": { "active": 2, "cap": 3, "saturated": false } }
```

---


# Tech Stack — AI Agents Full Detail (Ollama/gemma4 config, model-router)

> Moved verbatim from CLAUDE.md §15 during the 2026-08-18 token-optimization pass.

## §15. Tech Stack

- **API Server:** Express.js 5 + TypeScript (`src/server/`)
- **Database:** PostgreSQL on Railway + Drizzle ORM (`src/server/db/schema.ts`)
- **Backtest Engine:** Python + vectorbt + Polars + DuckDB (`src/engine/`)
- **AI Agents:** TypeScript + Ollama (`gemma4:e4b-it-qat` — the ONE local model) + GPT-5-mini/GPT-5.4 (cloud primary for reasoning roles; Ollama is the local fallback). **2026-07-03 tower-model consolidation:** the tower serves exactly ONE local model, `gemma4:e4b-it-qat`, tied to the YouTube/transcript extraction system. The old multi-model layout is RETIRED and no longer pulled: `gemma4:e2b`, `deepseek-r1:14b`, `qwen2.5-coder:7b`, `phi4-mini`, `nomic-embed-text` (and the earlier `qwen3-coder:30b`/`trading-quant`). Every role config + every cloud-role Ollama fallback in `model-router.ts` now points at `gemma4:e4b-it-qat`. Do NOT re-pull the retired models; repoint any stale reference to `gemma4:e4b-it-qat`. Architecture (transcript_extractor): /api/chat (not /api/generate) + JSON Schema as `format` object (GBNF grammar-constrained sampling, Ollama 0.5+) + temperature=0.1/top_p=0.95/top_k=64 + NO `think` field (Ollama bug #15260 silently drops schema enforcement on gemma4 when think:false is set — omit entirely) + literal "Return JSON matching the schema." in user message. Install: `ollama pull gemma4:e4b-it-qat`. Schema enforcement: `TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA=false` escapes to `format:"json"` string mode. Override model via `TRANSCRIPT_EXTRACTOR_LOCAL_MODEL` env var (must include tag — bare `gemma4` does NOT resolve in Ollama). Panic-revert via `TRANSCRIPT_EXTRACTOR_FORCE_CLOUD=true`. Override the parameter-evolver model via `PARAMETER_EVOLVER_MODEL` env var. **Embeddings caveat:** gemma is an instruct model, not a dedicated embedder — its `/api/embeddings` dim ≠ nomic's 768, so the graveyard similarity gate stays effectively bypassed until stored vectors are recomputed. **Live n8n follow-up:** Railway workflows still reference retired models — repoint via n8n REST API.
- **Orchestration:** n8n on Railway since Pass 21 — `https://n8n-production-84ff.up.railway.app`
- **Data Lake:** AWS S3 (Parquet, ratio-adjusted continuous contracts)
- **Dashboard:** React + Vite + TailwindCSS (`Trading_forge_frontend/amber-vision-main/`)
- **Data Providers:** Databento (historical), Massive Starter (delayed aggregates, ~10-min nominal delay — D5; the internal PAPER engine's feed, not real-time WS), Alpha Vantage (indicators + sentiment)
- **Execution:** TradingView Premium → TradersPost → MFFU/Topstep (current); TopstepX API direct (future) — (PAPER-state strategies use the internal engine exclusively as of M3 2026-07-17 — see §8)
- **Hosting:** Hybrid — Skytech tower (Ollama + Python backtest + NSSM services) + Railway (Postgres + n8n + tf-relay)
- **Quantum:** IBM Quantum Platform + AWS Braket (challenger-only Phase 0)

