# Slumdawg Analyst — Anam.ai Integration (Wave 26 Pass G)

Real-time avatar agent that breaks down Trading Forge / Slumdawg Bot activity in plain English for the non-technical Slumdawg Traders community.

---

## Architecture

```
Community member (browser/phone)
    │ voice or text
    ▼
Slumdawg Analyst (Anam.ai)  ← GPT OSS 120B + Slumdawg persona + 5 tools
    │
    │ tool call HTTPS POST
    ▼
n8n (Railway) — 5 webhooks: /webhook/slumdawg/{ingest-youtube,activity-today,journal-today,status-now,lifecycle}
    │
    │ HTTP via TF_BACKEND_PUBLIC_URL (tf-relay)
    ▼
TF API (Skytech) — /api/admin/slumdawg/* read-only endpoints
    │
    ▼
Response → Anam → spoken / displayed to user
```

---

## 5 capabilities

| # | User asks | Tool called | TF endpoint |
|---|---|---|---|
| 1 | "Ingest this YouTube URL: [paste]" | `ingest_youtube_strategy(url)` | POST /api/admin/slumdawg/ingest-youtube |
| 2 | "What did the bot do today?" | `get_bot_activity_today()` | GET /api/admin/slumdawg/activity-today |
| 3 | "What did GPT write about today?" | `get_trade_journal_today()` | GET /api/admin/slumdawg/journal-today |
| 4 | "What's the bot doing right now?" | `get_market_status_now()` | GET /api/admin/slumdawg/status-now |
| 5 | "How's strategy X / show library" | `query_strategy_lifecycle(name?)` | GET /api/admin/slumdawg/lifecycle/:name? |

Every endpoint returns a `baby_jargon_summary` field — the safe sentence Anam can speak verbatim.

---

## Setup (one-time, ~15 minutes manual)

### Step 1 — TF endpoints (already shipped)

Files committed to repo:
- `src/server/routes/slumdawg.ts` — 5 endpoints with HMAC auth + plain-English translators
- `src/server/index.ts` — router wired at `/api/admin/slumdawg`
- `.env` — `ANAM_API_KEY` + `SLUMDAWG_WEBHOOK_SECRET` added

Restart the API to load. Verify:
```bash
curl http://localhost:4000/api/admin/slumdawg/activity-today | jq .baby_jargon_summary
```

### Step 2 — Import n8n workflow (5 minutes)

1. Open n8n: https://n8n-production-84ff.up.railway.app
2. Workflows → ⋯ → **Import from File** → select `docs/slumdawg-analyst/05-n8n-workflow.json`
3. Verify `TF_BACKEND_PUBLIC_URL` env var is set in n8n (should be `https://tf-relay-production.up.railway.app` per CLAUDE.md §15a)
4. **Activate** the workflow (top-right toggle)
5. Note the 5 webhook URLs — they'll look like `https://n8n-production-84ff.up.railway.app/webhook/slumdawg/<name>`

### Step 3 — Configure Anam.ai (5 minutes)

Open https://lab.anam.ai/build/afb9ea0a-82e6-4339-9709-6c6e76d05814 (your Slumdawg Analyst persona).

1. **PROMPT → SYSTEM PROMPT** — replace with contents of `01-system-prompt.md` (everything below the front-matter)
2. **PROMPT → 02 FIRST GREETING** — paste Option A from `02-greeting.md`
3. **PROMPT → 03 KNOWLEDGE → Upload document** — upload `04-knowledge-doc.md`
4. **TOOLS tab** — add 5 tools from `03-tools-schema.json`. For each:
   - Set the `endpoint` field to the matching n8n webhook URL from Step 2
   - Set HTTP method (POST for ingest, POST for all read-only too if Anam requires — n8n webhooks accept POST)
5. Verify LLM is set to **GPT OSS 120B** (your current setting, confirmed in screenshot)
6. **Publish**

### Step 4 — Smoke test (5 minutes)

Open Slumdawg Analyst → click PLAY → say:

| Prompt | Expected | Verifies |
|---|---|---|
| "What did Slumdawg do today?" | Spoken summary with real numbers from `audit_log` + `paper_positions` | Tool #2 round-trip |
| "What's happening right now?" | Spoken summary with open positions + regime | Tool #4 |
| "How many strategies are in the library?" | Spoken count + breakdown by stage | Tool #5 |
| "Show me the silver_bullet strategy" | Spoken status of that specific strategy | Tool #5 with name |
| "Ingest this video: https://youtu.be/LOcaRWcc1xI" | Acknowledgment + extraction kickoff | Tool #1 |
| "What did GPT say about today's trades?" | Spoken summary of trade_critique rows | Tool #3 |

---

## Anti-hallucination contract

The system prompt enforces:
- NEVER state a number/grade/strategy not from a tool call this turn
- ALWAYS translate stats to plain English (jargon table embedded)
- ALWAYS include today's date when reporting daily activity
- ALWAYS prefer the `baby_jargon_summary` field verbatim

Each TF endpoint returns BOTH structured data AND `baby_jargon_summary`. The Anam LLM is told to lead with the summary.

---

## Security model

- TF endpoints under `/api/admin/slumdawg/*` are HMAC-authenticated via `X-Slumdawg-Signature` header (computed from `SLUMDAWG_WEBHOOK_SECRET`).
- n8n holds the secret as a credential, signs every request.
- Anam never has direct TF access — must go through n8n.
- **All 5 endpoints are READ-ONLY.** No admin actions exposed (no halt, no promote, no kill switch). Slumdawg Analyst is voice-only.

**To activate HMAC in production:** rotate `SLUMDAWG_WEBHOOK_SECRET` in both `.env` and n8n credentials, restart API. The route's dev-bypass logs a loud warning until the secret is rotated.

---

## File index

| File | What it is | Where to use it |
|---|---|---|
| `README.md` (this file) | Setup walkthrough | Reference |
| `01-system-prompt.md` | Slumdawg persona + jargon translations + tool usage rules | Paste into Anam PROMPT → SYSTEM PROMPT |
| `02-greeting.md` | First-message options | Paste into Anam PROMPT → 02 FIRST GREETING |
| `03-tools-schema.json` | 5 Anam tool definitions | Configure in Anam TOOLS tab |
| `04-knowledge-doc.md` | Trading Forge primer in plain English | Upload to Anam PROMPT → 03 KNOWLEDGE |
| `05-n8n-workflow.json` | n8n webhooks gateway | Import into n8n UI |

---

## What's next (Phase B+ ideas)

These were deferred from the original 10-door brainstorm. Each is an additive tool + endpoint:

- **Live trade narration** — SSE stream → Anam push → spoken commentary as trades fire
- **EOD trade autopsy voice loop** — auto-trigger Anam at session close to read journals aloud
- **Family-grade alerts** — per-family-member persona scoped to their accounts
- **Discord live presence** — Anam → OBS bridge → Slumdawg Traders Discord voice channel
- **Strategy walkthrough videos** — auto-generate 90-sec explainer when a strategy graduates
- **Voice debugging** — "Why didn't silver_bullet fire at 10am?" → audit_log query → spoken explanation
- **Vacation co-pilot** — daily 90-sec recap pushed to phone in operator-absent mode
- **Public landing page** — Anam embed at slumdawgtraders.com with sanitized read-only tools
