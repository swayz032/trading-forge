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
| `docs/replay-results/h1-battery/unlock_ranker_core.py` | `aa18c70322d0aace12f0102318a7a6fac8b37dfc41a77dfb7ab3942a7825910a` |
| `docs/replay-results/h1-battery/unlock_distance_ranker.py` | `e6f5a6b228ad7153ada6b89c7ac871e5d4e9e915a3e1cffacef83b33d60fdb9b` |
| `docs/replay-results/h1-battery/test_unlock_ranker_determinism.py` | `c67bd8418dad8b9dbc89b9ed2a5c22d686fc7754093fcc86f4a43f3fb4eb332b` |
| `docs/replay-results/h1-battery/unlock_chain_gate_audit.py` | `dd5e3986aa1c2dc84f578987006ca4cf13dc297f514d1ad6bc925f544ed73518` |
| `docs/replay-results/h1-battery/unlock_chain_determinism_probe.py` | `7f34a0d6de101e222fbe8c1bb2fd53256bc99f4dfda801c94961e842facb60e1` |
| `docs/replay-results/h1-battery/unlock_rank_before_after_proof.py` | `735160650f05dfd6a81b7bfb955a91532edc0553381603c2d961c28170bf416b` |
| `docs/replay-results/h1-battery/unlock-distance-rank-2026-07-29.json` | `ecae2593ec04df4615a4e3dd7f7c755ef55861aa53afe2038e7cb30f59581246` |
| `docs/replay-results/h1-battery/order_dependence_sweep.py` | `beaf112e6b8717a4bd690dec75dd536871673a78b75aa6c72021e85c76cda0cb` |
| `docs/replay-results/h1-battery/order-dependence-sweep-2026-07-29.json` | `ce1226f065f6a0216e345ab30fdb4c23a57032a0d450663608a4fd5b123d010d` |

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

## 6 — LOCATION AND RETENTION

| | |
|---|---|
| **current location** | producing session's scratchpad, `%TEMP%\claude\C--Users-tonio-Projects-trading-forge\6f1ac257-3b6e-4ceb-8bb1-7411f6a28957\scratchpad\` |
| **working copy** | AR-427's session scratchpad, `.../b6da0e0f-.../scratchpad/frozen/` (hash-verified identical) |
| **retention** | ★★★★★ **NONE. Both locations are OS-temp and may be swept without warning.** |
| **committed?** | **No** — live operator data |
| **recoverable?** | **Yes, by RE-RUNNING the census** (§2) against the live DB from `runtime-production` @ `a6f92822`. ★★ **A re-run will NOT be byte-identical if the `strategies` table has changed since the snapshot; that is a different census and must be given its own manifest, never reconciled into this one.** |

★★★ **RETENTION POLICY, PROPOSED (needs a ruling — it implies a storage location for operator data and that is not mine to choose):** a census that any ruling depends on should be copied to a **non-temp, backed-up, access-controlled** path at creation, and its manifest committed in the same motion. **Until such a location is named, every census this campaign relies on is one `%TEMP%` sweep from unrecoverable.**

## 7 — KNOWN LIMITS OF THIS MANIFEST

- ★★ **The remediation classes are JUDGMENT, not measurement.** The ledger states this plainly; the mechanical layer NOMINATED and every bucket was hand-corrected. **This manifest fixes the classification's IDENTITY (hashes), not its CORRECTNESS.** Re-grading it is a grading act and belongs to an independent grader, not to the census or the ranker.
- ★★ **`[UNMEASURED]`** whether the frozen census still matches today's live `strategies` table.
- ★ **`[UNRECOVERABLE]`** the DB read timestamp (§2).
- ★ **`[HONEST NULL]`** no `schema_version` in the payload (§5).
- ★★ **The `spec` label is NOT an identifier.** [MEASURED] the canonical labels are `39` distinct over `40` videos — `short_entry_5m` is carried by both `e5HQXYBUW-Q` and `dE4lPhAWke8`. **Join on `video`; never on the spec label.**
