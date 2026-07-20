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
