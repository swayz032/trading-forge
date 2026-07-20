# Cold Recovery — Runsheet (ops-experience, 2026-07-20)

> **EVIDENCE HEADER — read this first.** This runsheet is **NOT** "drilled".
> One leg is drilled. One is built and witnessed. Three are **designed and never executed**.
> Each section states its own evidence level, and a blanket claim is never made anywhere in
> this document. A recovery doc that reports uniform confidence it has not earned is the
> exact false-green the recovery is supposed to survive.

**Run the verifier, do not read the checklist:** `node scripts/ops/verify-recovery.cjs`
Exit `0` all PASS · `2` something inconclusive · `3` a capability is genuinely absent.

---

## Evidence map

| leg | capability | evidence level | KEY FINDING |
|---|---|---|---|
| **1 · Database** | restore + reach | **DRILLED + RECEIPTED 2026-07-02** | prod is **PostgreSQL 17.10** — a v16 `pg_dump` **REFUSES** with `server version mismatch`. Install pg**17**, not "latest". |
| **5 · Data lake** | DuckDB can read S3 | **BUILT + WITNESSED LIVE PASS** | a footer-only read **PASSes on a corrupt object**. The gate must force a column decode (`SELECT *`), not `SELECT 1`. |
| **A · Services** | API actually serving | **DESIGNED — NOT DRILLED** | *(none yet — a drill would produce one)* |
| **B · Scheduled tasks** | expected tasks **registered and enabled** (derived from the register scripts) | **DESIGNED — NOT DRILLED** | ★ **3 of 6 are ABSENT on the tower right now** — `TF-Rails-Divergence`, `TF-Rails-WorktreeTTL`, `TF-CI-Runner`. Found only once the check stopped hand-listing 3 names. |
| **C · WSL runner** | a configured WSL distro | **DESIGNED — NOT DRILLED** | ★ **the prerequisite no prior recovery note lists.** |
| **3 · Secrets/env** | the right `.env` resolves | **PARTIALLY BUILT** | boot **fail-OPENs** on missing secrets *by design*; `.env.example` is **not** a recovery manifest. |

**Nothing in this table may be upgraded without a receipt.** "Designed" becomes "drilled" only
after a real execution is logged in `AGENT-LOGS.md` with a date.

> ★ **KEY FINDING — Tier B, found 2026-07-20 by the verifier's own correction.**
> The first version of `verify-recovery.cjs` hand-listed **three** expected task names while
> the register scripts create **six**. It printed `all_registered` on a tower where
> `TF-Rails-Divergence`, `TF-Rails-WorktreeTTL` and **`TF-CI-Runner`** were absent — and
> `TF-CI-Runner` is the Tier-C runner task whose inertness is this document's headline gap.
> **Tier C reported green while the task it protects did not exist.**
> Expected names are now DERIVED from the register scripts, so the check cannot drift from
> the thing it checks. The tower currently reports **FAIL** on Tier B, correctly.

---

## The three tiers — ordered by PREREQUISITE, not by preference

The eight install/register scripts are not a sequence; they are three groups with different
things that must be true first. This is the half the scripts never carried.

### Tier A — services (needs **ELEVATION**)
`scripts/install-tower-launcher.ps1` · `scripts/ops/install-tower-relay-nssm.ps1`
Both state it in their own headers: **run once, as Administrator.**
**Capability check:** the API answers `/api/health`. A non-200 still counts as UP — auth-gated
or slow is *serving*; only an unanswered request is a real failure (the 07-11 false-positive).

### Tier B — node scheduled tasks (needs **node on PATH** + valid paths)
`register-{soak,cert-rig,full-lane,divergence,worktree-ttl}-task.ps1`
Five of six validate their `ScriptPath`/`WorkingDir` before registering.
**Capability check:** every task the register scripts create is present in `schtasks` **and not
Disabled** — matched by FIELD, not substring, and the expected list is DERIVED from those
scripts rather than hand-written.
⚠ **Registration is necessary and NOT sufficient** — a Disabled task is registered and cannot
run, which is why Disabled is a FAIL here, and see Tier C for the sharper version.

### Tier C — the WSL runner (needs **a configured WSL distro**)
`scripts/rails/register-runner-task.ps1` registers a **WSL** action
(`wsl -d <distro> -- bash -lc '… ./run.sh'`), not a node script — which is why it has no node
check, and why a Windows `Test-Path` against a WSL-internal path would be meaningless.
**Capability check:** `wsl -l -q` lists at least one distro.

> ★ **This is the gap.** A rebuilt box has **no WSL distro** until someone installs and
> configures one. The task registers **successfully** and then does nothing — a scheduled
> task that looks healthy and is inert. Every prior note treats the eight scripts as one
> undifferentiated pile, so an operator hits this wall with no warning.

---

## What the verifier proves, and what it does not

**Proves (per-capability, by exercising it):** the DB answers · the API serves · the tasks are
registered · a WSL distro exists · **DuckDB can decode data from the lake** (leg 5, wired here
— it previously had zero callers, and a capability check nobody invokes is a capability nobody
has).

**Does not prove:** that a **rebuilt** box reaches this state. Every check above passing on a
*healthy* box is the expected result and says nothing about recovery. Only a real
rebuild-the-box drill tests that, and it is **operator-scheduled** because it touches
irreversibles.

**UNKNOWN is not FAIL.** A checker that cannot run (no `wsl`, no `schtasks`, no pg driver)
reports UNKNOWN. Collapsing that into FAIL would page an operator about a box that is fine.

---

## Recovery order (designed — not drilled)

1. Repo: `git clone`, then **check out the branch the tower actually runs** (see CL-009 — the
   running checkout is manually updated and has drifted before).
2. Secrets: place `.env`. Resolution honours `RAILS_ENV_PATH`/`SOAK_ENV_PATH` and finds a
   nested sibling checkout; `.env.example` is **not** a complete manifest.
3. `npm ci` — then verify **`node_modules/.bin` is populated**, not just that packages exist.
   A directory existing is a count; resolving its entry point is the inventory.
4. Database: `docs/disaster-recovery-db.md` (**the drilled leg** — pg17 client required).
5. **Tier A** (elevated) → **Tier B** → **Tier C** (install a WSL distro *first*, or the runner
   task is inert).
6. `node scripts/ops/verify-recovery.cjs` — every leg PASS or explained.

---

## Real incident — SEPARATE AND GUARDED

**Do not run anything in this section as part of a rehearsal.**
Restore-over-production lives in `docs/disaster-recovery-db.md` under its own heading and is
**operator-only**. A drill step must never be able to fire a real recovery; that is why the two
paths are in different documents and never adjacent.

---

## Open items (operator)

- **The deploy gap (CL-009).** The tower's checkout is updated **manually** — there is no
  auto-deploy. A push is inert on the box until a manual pull + API restart, and it pulls
  **both lanes**. Unchanged, and the single largest open item.
- **A real cold-recovery drill.** Touches irreversibles; operator-scheduled. Until it runs,
  Tiers A/B/C stay **designed**, and this document says so.
