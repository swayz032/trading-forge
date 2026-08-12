# AR-1038 — WORKER — REAL LIBRARY REACHED (120 STRATEGIES) · **THE TIER-A FIXTURES AND THE PRODUCTION LIBRARY ARE DISJOINT POPULATIONS** · ORB FAMILY = **16 SOURCE VIDEOS BY TEACHER PROSE** (my type-based count of 2 was wrong — §3)

> ⚠️ **THIS TITLE WAS ITSELF WRONG ON FIRST PUBLISH** (`aa64e6fe`), where it read
> `ORB FAMILY = 2 SOURCES` while §3b of the same file already said 16. **That is precisely the
> over-scoped-headline error GPT corrected in AR-1037 and which §0 of this report accepts —
> committed again, one section below the paragraph accepting it.** Corrected here and left visible
> rather than silently amended. ★ `THE HEADLINE IS THE CLAIM MOST PEOPLE WILL EVER READ.`

```
RULING : AR-1037 (gpt-rulings db7bb787) §5 ORB-subset scan · §11.4 (library access) — NOW UNBLOCKED
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81   origin/h1-wave4-sealed12-driver
TREE   : C:\Users\tonio\Projects\wt-h1-wave4-20260712
STATE  : READ-ONLY against the DB. **NO PRODUCTION CODE MUTATED. NO COMMIT. NO SERVICE DEPLOYED.**
         One operator-ordered config repair to the worktree `.env` (§2) — gitignored, untracked.
```

## 0. THE FINDING THAT REFRAMES AR-1036 AND AR-1037

> 🛑🛑 **ZERO of the local tier-A fixture stubs exist in the production library.**
> `select distinct video from strategies where video = any(<the 9 local ORB stubs>)` → **0 rows.**
> **The golden `st5e-YJRfKc__s0` — the source this entire OR-V1.0 campaign has been built on — is
> NOT IN THE PRODUCTION LIBRARY AT ALL.**

They are **two disjoint populations**. So:

- AR-1037's `7/7 approximated ⇔ executes` correlation describes **13 fixture records**, and says
  **nothing measured** about the 120 production strategies. GPT's over-scope rejection was correct
  and, as it turns out, **understated** — the sample was not a small slice of the library, it was
  **not a slice of it at all.**
- AR-1038's earlier local expansion (35 stubs, 9 ORB) is likewise a **fixture-corpus** fact.

★★★★★ **`A SAMPLE THAT SHARES NO MEMBER WITH THE POPULATION IS NOT A SMALL SAMPLE — IT IS A
DIFFERENT POPULATION WEARING THE WORD "LIBRARY".`**

## 1. THE REAL LIBRARY, MEASURED

Live DB: project **`Trading Forge`** → service **`Postgres-KcfX`** → `sakura.proxy.rlwy.net:34357`,
PostgreSQL 18.4.

```
TOTAL strategies                       = 120
lifecycle                              : CANDIDATE=117  NEEDS_ARCHETYPE=3
distinct source videos                 = 40
shape                                  : 40 videos × 3 instruments (MES / MNQ / MCL)
strategies carrying persisted compiled_spec = 120 / 120
```

★ **Every production strategy already carries a persisted `compiled_spec`** — so MP2's transport
repair is live-relevant to all 120, not to a fixture.

## 2. §11.4 CLOSED BY THE OPERATOR — AND THE TRAP THAT CAUSED IT

**TWO Railway projects exist and their names differ only by case and a space.**

| project | state | Postgres | endpoint |
|---|---|---|---|
| `trading-forge` (hyphen) | **RETIRED** — `Postgres`/`n8n` `latestDeployment=None`, `tf-relay` `FAILED` | dead | `switchback…:36475` |
| **`Trading Forge`** (space) | **LIVE** — `Postgres-KcfX`, `trading-forge`, `n8n` all `SUCCESS`/active | **`Postgres-KcfX`** | **`sakura…:34357`** |

The `.env` token was a **project token scoped to the RETIRED project**, so `railway status`
*succeeded* while pointing at the wrong project and `railway list` returned `Unauthorized`.
★★★ **`AUTHENTICATING SUCCESSFULLY IS NOT AUTHENTICATING TO THE RIGHT PLACE.`**

**The one-shot diagnostic** — zero-credential Postgres `SSLRequest` (8 bytes, no password), with
each host as the other's control:

```
sakura.proxy.rlwy.net:34357     ALIVE — backend answered "S"      <- LIVE
switchback.proxy.rlwy.net:36475 DEAD  — ECONNRESET                <- RETIRED (control)
```

Because **no credentials are sent**, password/auth/client-library are excluded in one probe.
⚠️ And a bare TCP connect to the DEAD host **succeeds** — a retired Railway proxy accepts TCP at
the edge while routing nowhere. **`WHEN A CONNECTION DIES BEFORE YOU SEND CREDENTIALS, IT IS NOT A
CREDENTIAL PROBLEM.`**

**Operator supplied the live project token and ordered the config repaired.** Done, verified:
`.env` `DATABASE_URL` → `sakura:34357`; `RAILWAY_TOKEN` → live project. **Verified by reading
`.env` the way the app does → `strategies = 120`, and `railway status` → `Project: Trading Forge`.**
`git check-ignore -v .env` confirmed **ignored, untracked, never committed** *before* any secret was
written; the previous `.env` was backed up outside the repo. **No token appears in this report, any
commit, or memory.**

## 3. THE ORB FAMILY — MY ENUMERATION WAS WRONG TWICE; THE OPERATOR CORRECTED IT

🛑 **READ §3b FIRST. §3a's "2 sources" is a SUPERSEDED UNDER-COUNT, retained (not deleted) so the
error is visible.**

### 3b. THE CORRECTED ENUMERATION — **16 VIDEOS**, NOT 2

Operator, mid-task: ***"make sure you read the transcripts, it's multiple ORB teachers in
library."*** He was right.

**My §3a query enumerated by the COMPILER'S CONDITION TYPE** (`spec` contains `OPENING_RANGE*`).
That only finds teachers whose words the compiler **already typed** as an opening-range condition.
**A teacher who teaches the same setup in different language is invisible to it** — and the
compiler's typing is precisely what is under suspicion in this campaign.

★★★★★ **`ENUMERATING BY THE COMPILER'S OWN CLASSIFICATION ASKS THE SUSPECT TO PICK THE LINEUP.`**

Re-enumerated over the **teacher's verbatim prose** in the compiled spec (21 synonym terms:
`opening range` · `orb` · `first 5/15/30 minutes` · `9:30` · `range high/low` · `opening candle` ·
`market open` · `first bar` · …):

```
videos scanned : 40
videos whose TEACHER PROSE carries opening-range language : 16      (type-based search found 2)
CONTROLS  positive('the') = 34/40    negative(nonsense) = 0/40
```

**The strongest ORB-family candidates, by explicitness:**

| video | sample row | prose markers |
|---|---|---|
| `oDLt9zh33LE` | `opening_range_breakout_orb_mcl_5m` | opening range · orb · range high · range low · first candle |
| `e5HQXYBUW-Q` | `short_entry_mcl_5m` | opening range · orb |
| **`c8VLqF0XDR4`** | `long_entry_or_short_entry_mcl_15m` | **orb · first 30 minutes** — *invisible to the type search* |
| **`deymRD3kSD0`** | **`look_i_use_range_breakouts_confirmation_…`** | **930** — *the row NAME itself says range breakouts **with confirmation*** |
| `NMUd0oX_7Pg` | `hammer_candle_long_side_mcl_5m` | first 15 minutes · opening candle · market open |

★★★ **`deymRD3kSD0` is the highest-value lead in this report.** The golden source died on
`breakout_confirmation_semantics` — *the teacher never said what confirms the break*. **This row's
generated name asserts a teacher who explicitly discusses range breakouts AND confirmation.** If
that prose specifies the observation rule, it is exactly the §7-criterion-2 source the campaign has
been missing. **NOT YET READ — this is a name-level lead, not a measured finding.**

⚠️ **Control anomaly worth surfacing:** the positive control `'the'` matched only **34/40** specs.
**6 of 40 videos' compiled specs apparently lack even the word "the"**, which suggests near-empty
or degenerate spec payloads. Unexplained, not chased, flagged.

### 3a. SUPERSEDED — the type-based search (2 sources)

Enumerated **semantically** (compiled spec contains `OPENING_RANGE*`), not by name:

| source video | sample row | instruments |
|---|---|---|
| `oDLt9zh33LE` | `opening_range_breakout_orb_mcl_5m` | ×3 (MES/MNQ/MCL) |
| **`e5HQXYBUW-Q`** | **`short_entry_mcl_5m`** | ×3 (MES/MNQ/MCL) |

⇒ **6 rows, 2 teachers.**

★ **The name search found only `oDLt9zh33LE`.** `e5HQXYBUW-Q` compiles an opening-range condition
while its generated name (`short_entry_…`) says nothing about ORB. **Had I enumerated by name — the
obvious approach — I would have reported half the family and called it the family.**
`[unenumerated-ladder]` again: **the enumeration rule is the claim.**

**Query controls (both required, both ran):** positive `'condition'` → **120/120**; negative
nonsense token → **0/120**. So the `ilike` really discriminates and `2` is not an artifact of a
silently-failing predicate. *(My first attempt DID fail silently-ish — `operator does not exist:
jsonb ~~ unknown`, because `::text` bound to the key not the result. It errored loudly rather than
returning 0, which is the good failure.)*

**First look at `oDLt9zh33LE` (all three rows identical spec):**
`spec_hash 5cb76b21c0fe7990` · `direction='both'` · `entry_trigger_id='ENABLE_ENTRY:trade entry#0'`.
⚠️ **`ENABLE_ENTRY` maps to `spine_conjunction_trigger` → `_h_non_gating`** in `ENFORCED_DISPATCH`.
**HYPOTHESIS, NOT MEASURED:** a trigger routed to the non-gating handler may not be a real entry
trigger at all. **I have not yet compiled these rows or called `execution_refusal()` on them** —
that is the next step and I will not pre-judge it.
⚠️ `direction='both'` on both ORB sources ⇒ AR-1037 §5's EMA-proxy concern is **live** for them.

## 4. WHAT THIS DOES **NOT** SAY

- **No claim that the production library has no faithful source.** I have measured 6 ORB rows'
  identity fields only. **Nothing about the other 114 strategies / 38 videos has been measured.**
- **No verdict on either ORB source.** Not compiled, not refusal-checked, no mechanics table yet.
- The AR-1037 approximation correlation is **not** re-asserted here in any form.

## 5. FINDINGS AGAINST MYSELF

1. **I nearly published a wrong AR.** A draft of this report concluded *"ALL THREE RAILWAY
   PRODUCTION SERVICES ARE DOWN"* and *"the `.env` host matches Railway's authoritative value, so
   the stored note about a moved DB does not apply."* **Both were true only of the RETIRED
   project.** The operator interjected — *"it's 2 of them on there… make sure you're on the right
   railway"* — before I pushed it. **The stored note was right and my "correction" of it was
   wrong.** ★ I had inverted a correct memory because I confirmed the endpoint against the wrong
   project's own copy of itself — **`BOTH SIDES OF THAT CHECK CAME FROM THE SAME PROJECT, SO
   AGREEMENT WAS NOT EVIDENCE`** (`[same-layer-agreement]`).
2. **I leaned on that memory earlier without measuring, then over-corrected against it.** Both
   directions were the same error: treating a stored claim as settled instead of as a claim.
3. **Four failed probe invocations** before a working one (bad relative import through the app
   module graph · `pg` not installed, this project uses `postgres.js` · Windows ESM needs a
   `file://` URL · `::text` cast bound to the JSON key). All mechanical, all loud, none produced a
   wrong reading.
4. **The AR-1037 headline over-scope is accepted** and is now shown to be worse than assessed (§0).
5. 🛑 **I enumerated the ORB family by the compiler's own condition type and reported `2`. The real
   answer from teacher prose is `16`.** The operator caught it. This is the SAME error shape as
   §5.1 and as `[i-measured]`: I measured a downstream artifact of the thing under suspicion and
   called it the population. **Both of my ORB enumerations were wrong — name-based (1) and
   type-based (2) — and only prose-based (16) survived a control.**

## 6. NEXT — DB-SIDE, AND IT NEEDS NOTHING FROM ANYONE

Per AR-1037 §5/§6, for each of the **2** real ORB sources: pull its transcript/extraction, compile
it, run `execution_refusal()`, and build the per-teacher mechanics table
(`OR window · exact breakout observation rule · confirmation/retest · direction rule · stop/target ·
trigger disposition · parameter survival · faithful executable y/n`).

**Then** widen beyond ORB across the other 38 videos if neither yields a faithful executable path.

**SEAT NOTE:** this session has run long and holds a lot of state. I am **not** handing off
mid-measurement, but the next natural boundary is after the 2-source mechanics table — a fresh seat
could take it from this AR plus the live `.env` without re-deriving anything. Ear armed on this
branch.
