# CENSUS REPRODUCIBILITY MANIFEST — `POP-120-LIVE` · 2026-07-29

> **Deliverable of R-451 §4(a).** The census payload underpinning R-426, R-447, R-451
> and v4 §3-1B is a snapshot of **live operator data** and is deliberately NOT committed.
> R-451: *"The payload may stay uncommitted ONLY IF a durable manifest is committed in
> its place."* This is that manifest.
>
> ★★★ **STANDING (R-451 §4a): no money-path task may depend on an unregistered temporary
> artifact.** This census was discovered surviving only in a dead session's `%TEMP%`
> (AR-427 §0) — one sweep from making v4 §3-1B impossible to execute.
>
> **Every value below is `[MEASURED]` at manifest-write time unless tagged otherwise.**

---

## 1 — WHAT THE CENSUS IS

| field | value |
|---|---|
| **population name** | `POP-120-LIVE` |
| **population definition** | every row of the live `strategies` table whose `config` contains the key `compiled_spec` |
| **selection SQL** | `SELECT id, name, lifecycle_state, config->'compiled_spec' FROM strategies WHERE config ? 'compiled_spec' ORDER BY id` |
| **rows** | `120` |
| **distinct source VIDEOS** | `40` |
| **replication** | exactly `3` rows per video (`_mcl_` / `_mes_` / `_mnq_`), multiplicity histogram `{3: 40}` |
| **refusal-set identity across each triple** | `40 of 40` identical — **the ÷3 denominator correction rests on this and it is re-verified, not inherited** |
| **per-video refusals** | `456` (raw across all rows: `1368`) |
| **`backtests_total` at census time** | `0` |
| **`strategies_total` at census time** | `120` |

★ **The census is a SNAPSHOT.** It describes the database as of the read below, **not** today's table. Any claim about the current library must re-run the census or say it is describing the snapshot.

## 2 — HOW IT WAS PRODUCED

**Instrument:** `pop120_census.py` — drives the **real** construction site the backtester
calls, never a reimplementation:

- `backtester.py:8493` → `from_compiled_spec(config["compiled_spec"], ...)`
- `backtester.py:8509` → `preflight_binding_plan(strategy.binding_plan, ...)`

**Command:**

```
# run from wt-preflight-blockers-20260729
CENSUS_OUT=<path>/pop120_census.json  python pop120_census.py
# then, over that output:
CENSUS_OUT=<path>/pop120_census.json CLASS_OUT=<path>/pop120_classified.json  python classify.py
```

**DB access:** `SELECT`-only under `SET default_transaction_read_only = on`; DSN read from
`runtime-production/.env` (`DATABASE_URL`) exactly as the app reads it. **Nothing written to
the database, to `runtime-production`, or to any spec file.**

**Built-in stop condition:** the census aborts with `STOP CONDITION FIRED: backtests total > 0`
before emitting anything — invariant #6 is enforced by the instrument, not only by the report.

### DATABASE READ TIMESTAMP — **`[UNRECOVERABLE FROM THE ARTIFACT]`**

★★★ **Recorded as a null, not reconstructed** (R-451 honest-partial clause; R-453 §4a).
`pop120_census.json`'s top-level keys are exactly `backtests_total · strategies_total ·
rows_with_compiled_spec · strategies` — **there is no timestamp field.**

The only time evidence is **`[ARTIFACT-SOURCED, weak]`**: the mtime of the original file in
the producing session's scratchpad, `2026-07-28 21:12:43 -0400`. ★★ **That is a FILESYSTEM
WRITE time, not a database read time, and it is mutable.** It is recorded as corroboration
of ordering only.

★★★★★ **THIS IS THE FIRST FIELD THE NEXT CENSUS MUST EMIT.** The manifest's job is to make the
NEXT census recoverable, not to retrofit this one: **any future census MUST write an ISO-8601
UTC read timestamp into its own output.**

## 3 — THE TREE THAT PRODUCED IT (and it is re-verified here, not inherited)

| tree | commit | role |
|---|---|---|
| `wt-preflight-blockers-20260729` | `83efd34e` | where the census ran |
| `runtime-production` | `a6f92822` | the tree that RUNS |

**[MEASURED AT MANIFEST-WRITE TIME] the three engine files are sha256-IDENTICAL in both trees, and both trees are still at the commits recorded above:**

```
b849a3718c1c8c81a178658aa46ece5607731f9d10274fab3f8c9bc4a2947dfc  spec_family_bindings.py
b20d285e66cdc2017fa8c85665ccab0388f9f54625387e708a14019c9d67a5ef  spec_condition_compiler.py
96526469f744463fc4921011c64bce4a5374b519fc43543f241b1674ff88ead8  spec_execution_preflight.py
```

★★ **`MEASURED ≠ MEASURED-WHERE-IT-RUNS` is satisfied for this census** — the measuring lane and the executing lane are byte-identical on the three files that decide a refusal. ★ **This does NOT clear the separate 160 KB ↔ 35 KB `spec_family_bindings.py` lane divergence (R-415 / v4 §3-1E), which concerns the CAMPAIGN tree `wt-h1-wave4-20260712`, a third lane not used by this census.**

**Runtime:** CPython `3.13.0`, Windows. ★ **Not pinned at census time; recorded as observed.**

## 4 — ARTIFACT HASHES

**Census payload — UNCOMMITTED (live operator data):**

| artifact | sha256 | bytes | original mtime |
|---|---|--:|---|
| `pop120_census.json` | `ad4335f0cdf8b3b9e2b9987b4497ea60cebf07cac6fa2aae0a4b6adfc30a413c` | 2,990,174 | 2026-07-28 21:12:43 -0400 |
| `pop120_classified.json` | `eed65514a126adb136b5430939223965a12909b6e21cda4fba87d547326051d1` | 175,347 | 2026-07-28 21:17:30 -0400 |

**Producing instruments — UNCOMMITTED (they embed a `.env` path and DB access):**

| artifact | sha256 | bytes |
|---|---|--:|
| `pop120_census.py` | `c24b1b9fadff038117ce18dd83297bc2c30dead251aedbc787d5379b674270d5` | 5,099 |
| `classify.py` (taxonomy + hand overrides) | `90aedc77cc79224124f2f312db32462e1c850291bc66a0ca7d36b2faa45a5339` | 8,831 |
| `gen_ledger.py` — **RETIRED, R-451 §2** | `9a882fbd2be92dd0db6dac01fbe6137db4f48548789c2dbba1d6791aeaf59450` | 10,166 |

★★★★★ **THE CLASSIFIER IS RECOVERABLE EVEN IF THE FILE IS LOST, AND THIS IS THE PROVENANCE ANCHOR OF THE WHOLE CENSUS:** `classify.py` is **BYTE-IDENTICAL** to the classifier published verbatim in the committed ledger `docs/designs/VOCABULARY-LEDGER-POP120-2026-07-29.md:542–698` (`diff` exit `0`, zero lines out — AR-427 §0). **The taxonomy and every hand override are durably committed inside that ledger.**

| committed anchor | sha256 | commit |
|---|---|---|
| `docs/designs/VOCABULARY-LEDGER-POP120-2026-07-29.md` | `45189a84962768ab5e4b275f06911b9bb2494315cac20c51615e7a8382849147` | `276b2c00` |

**Downstream instruments — COMMITTED (no operator data; R-451 §3 makes this standing):**

| artifact | sha256 |
|---|---|
| `docs/replay-results/h1-battery/unlock_ranker_core.py` | `0e417cc809fa748c52e762a41cc0f4efc63ba16c31947accecaf4d4c5276de95` |
| `docs/replay-results/h1-battery/unlock_distance_ranker.py` | `e6f5a6b228ad7153ada6b89c7ac871e5d4e9e915a3e1cffacef83b33d60fdb9b` |
| `docs/replay-results/h1-battery/test_unlock_ranker_determinism.py` | `4e5948d9fa56bbe2d08236e0491084edeb70e36ed7e27e982d181b0a7d01545b` |
| `docs/replay-results/h1-battery/unlock_chain_gate_audit.py` | `dd5e3986aa1c2dc84f578987006ca4cf13dc297f514d1ad6bc925f544ed73518` |
| `docs/replay-results/h1-battery/unlock_chain_determinism_probe.py` | `7f34a0d6de101e222fbe8c1bb2fd53256bc99f4dfda801c94961e842facb60e1` |
| `docs/replay-results/h1-battery/unlock_rank_before_after_proof.py` | `689fc46f74bf330a4bb71053bb6d6cd226439bd1246a7040b31e784f14f1699b` |
| `docs/replay-results/h1-battery/unlock_rank_render.py` | `5bed137f6d33a31e05673235ba600a0be183a39415368b309543977843533cbd` |
| `docs/replay-results/h1-battery/unlock-distance-rank-2026-07-29.json` | `fe2338f21748b1482f47a9661d13bf4d10310eace2510b1b0b6299d476d05164` |
| `docs/replay-results/h1-battery/unlock-distance-rank-2026-07-29.md` (rendered) | `6364727d151c9f5acc73ae6047507b054ed8c4da53be545e6e89ee648f88b03f` |
| `docs/replay-results/h1-battery/order_dependence_sweep.py` | `9a7f99a3af3df7a88a45c1cb74aa4829073b386ed0677dc144e6b65d9278743c` |
| `docs/replay-results/h1-battery/order-dependence-sweep-2026-07-29.json` (whole surface, 53 files — AR-429) | `ce1226f065f6a0216e345ab30fdb4c23a57032a0d450663608a4fd5b123d010d` |
| `docs/replay-results/h1-battery/order-dependence-sweep-registered-2026-07-29.json` (bounded, 34 registered — AR-433) | `bd5d6a1cf356c4f00a4691253b75ec0227ad470af2dc6452b2e3ad908c5700b8` |
| `docs/replay-results/h1-battery/registered-instrument-set-2026-07-29.json` (the membership surface) | `ae1612584c8b58125e6a81ff7dd3035bc4eb1a8b4c96622dbb205dd7296b6880` |

**Deterministic ranker commit:** the ranking JSON above is the output of `unlock_ranker_core.py` at the commit that carries this manifest. ★ **The ranker's determinism is not asserted — it is a committed, runnable assertion:** `test_unlock_ranker_determinism.py`, `6/6` passing, `12` `PYTHONHASHSEED` values per determinism check, **including a tied-case fixture proven to convict the retired `gen_ledger.py` tie-break.**

## 5 — SCHEMA OF THE CENSUS PAYLOAD

`pop120_census.json` (object):
`backtests_total` · `strategies_total` · `rows_with_compiled_spec` · `strategies[]`

`strategies[]` row:
`strategy_id · name · lifecycle_state · envelope_keys · spec_is_dict · error · video ·
transcript_chars · direction · refused · refusals[] · warnings[] · bindings[] ·
executable_spine_count`

`refusals[]`: `strategy_id · condition_id · rule_text · semantic_type · role · reason · rule_class`
`bindings[]`: `condition_id · role · type · object · bindable · executed · reason · primitive · approximation · kind`

`pop120_classified.json` (array), one row per **representative-row** refusal:
`strategy_id · condition_id · video · rule_text · role · reason · rule_class · semantic_type · remediation_class`

★★ **JOIN KEY between the two: `(strategy_id, condition_id)`.** [MEASURED] `456` classified rows → `456` distinct keys, `0` conflicting duplicates, `0` join misses. **`unlock_ranker_core.load_frozen` raises rather than silently dropping a row on either failure** — the join is validated at every use, not assumed.

★ **`transcript_chars` is absent/None on `120 of 120` rows.** Source fidelity is **not** gradeable from the envelope; the in-row `evidence`/`span` fields are the deeper source (R-427 §0). **No manifest field should be read as a provenance guarantee about the teacher's words.**

★ **No `schema_version` field exists in the payload.** [HONEST NULL] The schema is pinned here by enumeration instead. **A future census MUST emit an explicit `schema_version`.**

## 5.5 — REPORT INTEGRITY (R-454 §4(3))

★★★★★ **A REPORT'S TABLE IS AN INSTRUMENT'S OUTPUT, NOT A TRANSCRIPTION (R-453 §3).** *"Generated from the output"* is a claim about the past; a check that **regenerates and diffs** is a property of the artifact.

| link in the chain | value |
|---|---|
| **structured artifact** | `docs/replay-results/h1-battery/unlock-distance-rank-2026-07-29.json` |
| **its sha256** | `fe2338f21748b1482f47a9661d13bf4d10310eace2510b1b0b6299d476d05164` |
| **generation command** | `POP120_CENSUS=… POP120_CLASSIFIED=… python unlock_distance_ranker.py` |
| **ranker commit** | the commit carrying this manifest; core hash `0e417cc8…` |
| **rendered table** | `docs/replay-results/h1-battery/unlock-distance-rank-2026-07-29.md` (`6364727d…`) |
| **verification** | `python unlock_rank_render.py unlock-distance-rank-2026-07-29.json --verify unlock-distance-rank-2026-07-29.md` → **`REPORT-INTEGRITY OK`** |

★★★ **AND THE CHECK IS PROVEN TO BITE, not merely to exist:** `test_report_integrity_check_fails_on_a_hand_edited_row` renders a table, verifies it clean **(the control)**, then hand-edits one row exactly as AR-427's transcription did, and requires the verify to **FAIL**. ★ The rendered file carries a `DO NOT EDIT BY HAND` header naming the verify command.

## 5.6 — COPY EQUIVALENCE AND COPY-ORDER INDEPENDENCE (R-454 §4(1)(2))

★★★★★ **The `÷3` collapse is now GUARDED, not assumed.** `load_frozen` compares all three market copies of every video on their ranking-relevant content **before** collapsing the triple, and raises `CopyDivergenceError` — naming the video and the split — rather than publishing whichever copy sorted first.

| check | result |
|---|---|
| **copy equivalence, real census** | **`40 of 40` videos, 3 copies each, all agree.** No divergence. |
| **copy-shuffle, real census** | 3 rotations → **`1` distinct output — BYTE-IDENTICAL.** |
| **discrimination (retired `rows[0]` selection, same rotations)** | **`3` distinct outcomes** — 1 completes, 2 raise `KeyError`. **It convicts.** |

### ★★★★★ NAMED LIMITATION — NOT A PASSING CHECK (R-455 §1)

> **`0 of 40 differ` IS A STATEMENT ABOUT CONTENT FIELDS ONLY.**
> **It must NEVER be cited as "the copies are identical in every respect."**
>
> ★★★ **PER-COPY `remediation_class` EQUALITY IS NOT VERIFIABLE IN THIS ARTIFACT.** The
> classification is stored for ONE representative copy per video, so the check cannot see it at
> all. This is a REAL HOLE left open by the correct repair — recorded here as a limitation, not
> resolved by a check that would have to fabricate the comparison.
>
> ★★ **CLOSES AT THE SOURCE, NOT HERE: the next census must classify EVERY COPY.** See §8.

★★ **The copy signature deliberately EXCLUDES `remediation_class`.** [MEASURED] the classification artifact covers exactly **one** copy per video (`40` distinct `strategy_id` over `40` videos), so joining it per-copy compares a classified row against two unclassified ones and manufactures a divergence. ★★★ **The class is a pure function of the fields the signature DOES compare, so content equality entails class equality — but that entailment CANNOT be checked per-copy on this artifact, and that limit is stated here rather than papered over.**
★ **A future census SHOULD classify every copy**, which would let the equivalence check cover the class directly.

## 6 — LOCATION AND RETENTION

★★★★★ **RETENTION IS NO LONGER `NONE`. Ordered by R-455 §3 and executed by AR-432 — by COPY, never by re-running the census.**

| | |
|---|---|
| **RETAINED AT** | `C:\Users\tonio\Projects\trading-forge\backups\h1-census\unknown-dbtime-ad4335f0\` |
| **contents** | `pop120_census.json` · `pop120_classified.json` · `HASHES.txt` · `README.md` (sanitized generation instructions) · a copy of this manifest |
| **integrity** | ★★ **[MEASURED] both sha256 matched the manifest values AFTER the copy** — the artifact was verified, not `cp`'s exit code. `sha256sum -c HASHES.txt` → `OK`, `OK`. |
| **permissions** | **READ-ONLY**, and ★★ **RED-PROOFED: an append to `HASHES.txt` was attempted and correctly REFUSED (`UnauthorizedAccessException`), with the census hash unchanged afterwards.** A flag that has not been shown to block a write is not a protection. |
| **in git?** | **No.** ★★★ **[VERIFIED, not assumed] this path lies outside every git working tree under `Projects\` — the canonical checkout is the NESTED `trading-forge\trading-forge`. The payload cannot be committed by accident.** Only this manifest and derived outputs are in git. |
| **off-machine backup** | ★★ **NOT ARRANGED — this is one disk.** Flagged for the operator per R-455 §3; deliberately not attempted by the worker. |
| **origin copies** | producing session's scratchpad `%TEMP%\claude\...\6f1ac257-...\scratchpad\` and AR-427's `...\b6da0e0f-...\scratchpad\frozen\`. ★ **Both remain OS-temp and may be swept; they are no longer the only copies.** |

★★★★★ **THE DIRECTORY NAME CARRIES A NULL ON PURPOSE.** `unknown-dbtime` records that the DB read time is unrecoverable; `ad4335f0` is the census's own content hash. **DO NOT RENAME IT TO A DATE. An unknown labelled `unknown` is a fact; an inferred timestamp is a fabrication that a future reader will cite as provenance.**

★★★ **RE-RUNNING IS NOT RESTORING.** A re-run against today's database yields a **different object** — a new snapshot owed its own manifest and its own directory, **never reconciled into this one.**

## 7 — KNOWN LIMITS OF THIS MANIFEST

- ★★ **The remediation classes are JUDGMENT, not measurement.** The ledger states this plainly; the mechanical layer NOMINATED and every bucket was hand-corrected. **This manifest fixes the classification's IDENTITY (hashes), not its CORRECTNESS.** Re-grading it is a grading act and belongs to an independent grader, not to the census or the ranker.
- ★★ **`[UNMEASURED]`** whether the frozen census still matches today's live `strategies` table.
- ★ **`[UNRECOVERABLE]`** the DB read timestamp (§2).
- ★ **`[HONEST NULL]`** no `schema_version` in the payload (§5).
- ★★★★★ **PER-COPY `remediation_class` EQUALITY IS UNVERIFIABLE HERE** — see §5.6's named limitation. The copy-equivalence result covers CONTENT fields only.

## 8 — FORWARD REQUIREMENTS ON THE NEXT CENSUS

★★★ **Each of these exists because its absence cost something in this one. They belong in the next snapshot's OWN PAYLOAD, so it never inherits these holes:**

1. **UTC read timestamp** — the field whose absence named the retention directory `unknown-dbtime`.
2. **`schema_version`** — this payload has none; §5 pins the schema by enumeration instead.
3. **executing-tree commit** — carried in-payload, not only in a manifest written afterwards.
4. **content hashes** and **a unique snapshot ID**.
5. ★★★★★ **CLASSIFY EVERY MARKET COPY, not one representative per video.** Today `456` classified rows span `40` distinct `strategy_id` over `40` videos — one copy each — which is exactly why §5.6's limitation exists. **Classifying every copy closes it at the source.**
6. ★ **Write the snapshot to its retention location AT CREATION**, with its manifest committed in the same motion — not rediscovered in a dead session's `%TEMP%` a day later (AR-427 §0).

- ★★ **The `spec` label is NOT an identifier.** [MEASURED] the canonical labels are `39` distinct over `40` videos — `short_entry_5m` is carried by both `e5HQXYBUW-Q` and `dE4lPhAWke8`. **Join on `video`; never on the spec label.**
