<!-- GENERATED FILE — DO NOT EDIT.
     Source of truth: scripts/ops/recovery-evidence.cjs
     Regenerate:      node scripts/ops/render-runsheet.cjs --write
     The evidence STATE of each leg is a closed typed value; this table is rendered from it,
     so a drill cannot be claimed by editing prose. KEY FINDINGs are free text and are
     explicitly NOT tool-governed — see the note under the table. -->

# Cold Recovery — Runsheet

> **EVIDENCE HEADER.** This runsheet is **NOT** drilled as a whole.
> 1 of 6 legs carry a drill receipt: **db**.
> Every other leg states its own lesser evidence level. A blanket claim is never made anywhere
> in this document, and cannot be — the levels come from a closed enum, not from prose.

**Run the verifier, do not read the checklist:** `node scripts/ops/verify-recovery.cjs`
Exit `0` all PASS · `2` something inconclusive · `3` a capability is genuinely absent.

---

## Evidence map

| leg | capability | evidence level | KEY FINDING |
|---|---|---|---|
| **1 · Database** | restore + reach | **DRILLED + RECEIPTED** — docs/disaster-recovery-db.md · AGENT-LOGS 2026-07-02 | prod is **PostgreSQL 17.10** — a v16 `pg_dump` REFUSES with `server version mismatch`. Install pg**17**, not "latest". |
| **2 · Services** (Tier A) | API actually serving | **DESIGNED — NOT DRILLED** | *(none yet — a drill would produce one)* |
| **3 · Scheduled tasks** (Tier B) | expected tasks registered **and enabled** | **DESIGNED — NOT DRILLED** | ★ **3 of 6 are ABSENT on the tower** — `TF-Rails-Divergence`, `TF-Rails-WorktreeTTL`, `TF-CI-Runner`. Found only once the check stopped hand-listing names. |
| **4 · WSL runner** (Tier C) | a configured WSL distro | **DESIGNED — NOT DRILLED** | ★ **the prerequisite no prior recovery note lists.** `TF-CI-Runner` registers a WSL action, so a box with no distro registers it successfully and it does nothing. |
| **5 · Data lake** | DuckDB can read S3 | **BUILT + WITNESSED LIVE** | a footer-only read **PASSes on a corrupt object**. The gate must force a column decode (`SELECT *`), not `SELECT 1`. |
| **6 · Secrets/env** | the right `.env` resolves | **PARTIALLY BUILT** | boot **fail-OPENs** on missing secrets *by design*; `.env.example` is **not** a recovery manifest. |

**How this table is governed.** The **evidence level** column is generated from a closed set
of states (`DRILLED`, `WITNESSED_LIVE`, `DESIGNED_NOT_DRILLED`, `PARTIALLY_BUILT`), and a state that asserts a drill must
carry a receipt or the render refuses. **The KEY FINDING column is free text and is NOT
tool-governed** — a finding is human judgement about what a drill taught, not a completion
claim, and policing its prose would be the same open-set trap that made four rounds of
patching fail. Govern the state; declare the prose ungoverned.

**A second declared limit: RECEIPT CONTENT IS ASSERTED, NOT VERIFIED.** The schema enforces
that a drilled state *carries* a receipt and that a non-drilled state does not — it does not
open the receipt and check it says what it claims. Exploiting that needs a deliberate edit to
the typed source, which is a code-review threat, not a prose one: **no schema is closed
against its own author editing the source of truth.** Stated here rather than left implied,
because an undeclared limit is the same defect as an overclaiming guard.

**And a bounded scope on Tier B:** the expected task list is derived by globbing
`scripts/rails` and `scripts/soak`, so it cannot drift from the register scripts **in those
directories** — a register script added under a *third* directory would still be missed.

---

## The three tiers — ordered by PREREQUISITE, not preference

### Tier A — services (needs **ELEVATION**)
`scripts/install-tower-launcher.ps1` · `scripts/ops/install-tower-relay-nssm.ps1` — both say
"run once, as Administrator" in their own headers.
**Capability check:** the API answers `/api/health`. A non-200 still counts as UP — auth-gated
or slow is *serving*; only an unanswered request is a real failure.

### Tier B — node scheduled tasks (needs **node on PATH** + valid paths)
**Capability check:** every task the register scripts create is present **and not Disabled**,
matched by field. The expected list is DERIVED by globbing the register scripts, so a new one
is picked up without editing the check.
⚠ **Registration is necessary and NOT sufficient** — a Disabled task is registered and cannot
run, which is why Disabled is a FAIL here.

### Tier C — the WSL runner (needs **a configured WSL distro**)
`register-runner-task.ps1` registers a **WSL** action, not a node script.
**Capability check:** `wsl -l -q` lists at least one distro-shaped name.

---

## What the verifier proves, and what it does not

**Proves**, by exercising it: the DB answers · the API serves · the expected tasks are
registered and enabled · a WSL distro exists · **DuckDB can decode data from the lake**.

**Does not prove** that a *rebuilt* box reaches this state. Every check passing on a healthy
box is the expected result and says nothing about recovery. Only a real rebuild-the-box drill
tests that, and it is **operator-scheduled** because it touches irreversibles.

**UNKNOWN is not FAIL.** A checker that cannot run reports UNKNOWN; collapsing that into FAIL
would page an operator about a box that is fine.

---

## Recovery order (designed — not drilled)

1. Repo: `git clone`, then check out the branch the tower actually runs (CL-009 — the running
   checkout is manually updated and has drifted).
2. Secrets: place `.env`. Resolution honours `RAILS_ENV_PATH`/`SOAK_ENV_PATH` and finds a
   nested sibling checkout; `.env.example` is **not** a complete manifest.
3. `npm ci` — then verify `node_modules/.bin` is **populated**, not just that packages exist.
   A directory existing is a count; resolving its entry point is the inventory.
4. Database: `docs/disaster-recovery-db.md` (the drilled leg — pg17 client required).
5. **Tier A** (elevated) → **Tier B** → **Tier C** (install a WSL distro *first*, or the runner
   task is inert).
6. `node scripts/ops/verify-recovery.cjs` — every leg PASS or explained.

---

## Secrets/env — what to set on a rebuilt box

**Set these 10.** Generated from `scripts/ops/recovery-env-manifest.cjs`; every row's
class is cross-checked against the code by `node scripts/ops/verify-env-manifest.cjs`.

| variable | leg | class | if it is missing |
|---|---|---|---|
| `DATABASE_URL` | db | **★ OPTIONAL — SILENTLY DEGRADES + REQUIRED** | ★ 5 of its read sites default to `""` instead of failing — notably src/server/lib/boot-migration-runner.ts:1020, where the MIGRATION RUNNER proceeds with an empty URL. So DATABASE_URL is loud in 107 places and SILENT in 5, and the 5 are the ones that matter on a rebuilt box. · every DB path. ★ CORRECTED: the recovery verifier's db leg reports **UNKNOWN** (`database_url_absent`), NOT FAIL, when this is unset — verified by running `legDb()` with it removed. FAIL fires only when the URL is PRESENT but the database is unreachable. The earlier text claimed FAIL and was false; UNKNOWN-is-not-FAIL is deliberate (a checker that cannot run must not condemn the box), so the runbook must say what actually happens. |
| `AWS_ACCESS_KEY_ID` | s3 | **★ OPTIONAL — SILENTLY DEGRADES + OPTIONAL — working default** | S3 auth. duckdb-service.ts:83 falls back to `""` and SETs it as the DuckDB s3 key — the box BOOTS HEALTHY and is silently S3-blind. The lake read fails later, far from the cause. · `local:<path>` sentinel — synthetic-regime-bank-service.ts:185 skips the S3 upload and returns a local path when the credential trio is unset. THAT consumer degrades gracefully and on purpose; the duckdb-service consumer does not. |
| `AWS_SECRET_ACCESS_KEY` | s3 | **★ OPTIONAL — SILENTLY DEGRADES + OPTIONAL — working default** | S3 auth, identically to AWS_ACCESS_KEY_ID — duckdb-service.ts:84 defaults to `""`. The pair is the canonical 'boots healthy, S3-blind' shape. · `local:<path>` sentinel — synthetic-regime-bank-service.ts:185 skips the S3 upload and returns a local path when the credential trio is unset. THAT consumer degrades gracefully and on purpose; the duckdb-service consumer does not. |
| `AWS_REGION` | s3 | **★ OPTIONAL — SILENTLY DEGRADES** | ★ CORRECTED BY THE VERIFIER, against my own hand-declaration. I classed this OPTIONAL_FALLBACK on the strength of `?? "us-east-1"` at duckdb-service.ts:82 — but 3 sites default to `""` (data_loader.py:52, deepar_forecaster.py:181, and s3_capability_probe.py:67, which is OUR OWN leg-5 probe). An empty region silently mis-targets S3 rather than failing. |
| `DISCORD_CH_CRITICAL_ALERTS` | alerting | **★ OPTIONAL — SILENTLY DEGRADES** | ★ the HIGHEST-SEVERITY alert channel. `src/discord/bot.ts` CHANNEL_MAP defaults it to `""` — unlike compliance/skip/macro/tournament/alerts/governor, which carry a hardcoded fallback ID — so an unset var leaves critical alerts with NO destination. Since 2026-07-20 the route answers 503 `channel_unconfigured` naming the exact variable, so the failure is DIAGNOSABLE; the degradation (no delivery) is unchanged. Verified live: the running tower HAS it set, so this is a REBUILD gap, not a live blindness. |
| `DISCORD_CH_WORKFLOW_ERRORS` | alerting | **★ OPTIONAL — SILENTLY DEGRADES** | n8n workflow failures lose their destination when unset (empty default, no fallback ID). Same shape as CRITICAL_ALERTS, lower severity. |
| `DISCORD_CH_N8N_DAILY_REPORT` | alerting | **★ OPTIONAL — SILENTLY DEGRADES** | the daily report silently has nowhere to go when unset (empty default, no fallback ID). Lowest severity of the four — a missing daily report is noticed; a missing critical alert is not. |
| `DISCORD_CH_STRATEGY_FINDS` | alerting | **★ OPTIONAL — SILENTLY DEGRADES** | strategy-find posts lose their destination when unset. Already declared in `.env.example` (unlike the other three were), so the rebuild path is covered — listed for completeness of the empty-default class, not because it is a gap. |
| `SLUMDAWG_WEBHOOK_SECRET` | alerting | **★ OPTIONAL — SILENTLY DEGRADES** | ★ FOUND BY THE CLASS-COVERAGE CHECK, not by hand — it sits outside CHANNEL_MAP and I would have missed it. `src/discord/bot.ts:743` defaults it to `""`; the signer then yields no signature, the headers are omitted, and the backend 401s the ingest. A `log.warn` fires (added by the deep-scan n8n F-1 fix), so it is not silent SERVER-side — but the user-facing ✅ reaction and "cooking now" ack are sent BEFORE the request, so the person in Discord still sees success. Residual of the same documented CRITICAL; the user-visible half is not closed. |
| `DISCORD_WEBHOOK_URL` | alerting | **★ OPTIONAL — SILENTLY DEGRADES** | ★ THE SYSTEM-WIDE ALERT CHOKEPOINT — unset means EVERY Discord notification is silently off: notify()/notifyCritical() behind 200+ call sites (startup-config validation, DLQ failures, paper-recon, crash paths) plus the dead-man's-heartbeat fallback. `notification-service.ts:301` reads it BARE and the guard `if (!webhookUrl) return;` sits on the NEXT line, so nothing is logged and no caller can tell — `notify()` returns void. The service's own docstring declares the silent no-op, which makes it intended behaviour, not a bug — but intended-and-silent is exactly what a recovery runbook must surface. Verified live: PRESENT + non-empty on the tower, so this is a REBUILD gap, not live silence. |

**★ Read the SILENTLY DEGRADES rows twice.** Those do not fail loudly — the box boots healthy and
is quietly less able. `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` default to `""` and get SET as
the DuckDB S3 credentials, so an unconfigured box reports itself fine and cannot read the lake.
That is the "boots healthy, S3-blind" shape this manifest exists to surface.

**5 recovery-relevant vars are deliberately NOT listed** (`S3_BUCKET`, `S3_PROBE_KEY`, `TF_HEALTH_URL`, `RAILS_ENV_PATH`, `SOAK_ENV_PATH`) —
each has a working default, so absence is *correct*. Listing them would train you to skim the list,
which is the failure mode this triage prevents. **A count of undeclared vars is not an inventory of
recovery risk:** the repo reads ~617 env vars and ~323 are absent from `.env.example`; almost all
of that gap is noise, and enumerating it would bury the 10 rows above.

**Declared limits of the cross-check** — it adjudicates ONE property soundly (the silent-degradation
signature, an empty-string default) in both directions. It does **not** derive REQUIRED vs
OPTIONAL — cross-line guards make that undecidable line-locally, so those are human-declared.
And it is **static-only**: `RAILS_ENV_PATH` is read via `env[v]` and scores zero static sites,
so dynamic entries are SKIPPED and the skip is reported, never silently passed.

---

## Real incident — SEPARATE AND GUARDED

**Do not run anything in this section as part of a rehearsal.**
Restore-over-production lives in `docs/disaster-recovery-db.md` under its own heading and is
**operator-only**. A drill step must never be able to fire a real recovery.

---

## Open items (operator)

- **The deploy gap (CL-009).** The tower's checkout is updated **manually**; a push is inert on
  the box until a manual pull + API restart, and it pulls **both lanes**.
- **A real cold-recovery drill.** Touches irreversibles; operator-scheduled. Until it runs, the
  tiers stay at their stated evidence levels.
