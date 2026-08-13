# AR-1120 (worker) — AR-1119 §9.2 PRE-FLIGHT: **STOP, CONTRADICTION FOUND.** THE REAL CERTIFIED sVkm RECORD DOES NOT EXIST. NOTHING BUILT, NOTHING COMMITTED.

**Seat:** Claude Code worker
**Date:** 2026-08-13
**Governing ruling:** AR-1119 (gpt-rulings `9c0d14cd`)
**Engineering branch:** `h1-wave4-sealed12-driver`
**Engineering head measured:** `d8fa19580da49fbfd4490ccaa0f2c5a326619939` — **identical to the head AR-1119 inspected.** No drift.
**Ear:** armed on `origin refs/heads/external-advisor/gpt-rulings @ 9c0d14cd`, `2s` poll, delivery proven (the ARMED line arrived as a chat notification, not a log file).
**Work performed:** read-only pre-flight. **No code written. No commit. No grader dispatched.**

---

## 1. HEADLINE

**Your §3.2 and §3.8 require compiling the REAL certified sVkm record. `[MEASURED HERE]` that record does not exist anywhere I can reach**, and §3.2 explicitly forbids every remaining route to the four role bindings.

sVkm is `sVkmZklJDHI`. It is **not** in the 13 committed Tier-A certified provenance records, **not** in the 11-spec Tier-A compile census, and there is **no certified-record table in the database**. The DB holds sVkm's raw **transcript** (25,071 chars) — but a transcript is not a certified record, and `produce_spec_artifact_from_record()` consumes the latter.

**I did not guess, did not narrow the unit, and did not build the unblocked ~70% ahead of your answer** — your §7 says this is ONE unit and forbids an intermediate "persistence complete" victory. **One decision from you unblocks it.**

---

## 2. EVERY §2 PREMISE OF AR-1119 CONFIRMED — I RE-MEASURED, I DID NOT RELAY

All at pin `d8fa1958`, in the worktree `C:\Users\tonio\Projects\wt-h1-wave4-20260712`.

| Your claim | My measurement | Verdict |
|---|---|---|
| §2.2 canonical producer unreachable | `produce_spec_artifact_from_record` defined `spec_producer.py:1024`; **every** caller is under `src/engine/tests/` — zero non-test callers | **CONFIRMED** |
| §2.2 no entry point exists | `spec_producer.py` has **no** `__main__`, **no** `argparse`, **no** `def main` | **CONFIRMED** |
| §2.4 TS would drop the field | `source_timeframe_roles` appears **0 times** in all `.ts` under `src/` and `scripts/` | **CONFIRMED** |
| §2.5 hash seam | `spec_producer.py:748` `"spec_hash": _spec_hash(spec_body)`, `_spec_hash` defined `:758` | **CONFIRMED** |
| §2.6 factory lacks role params | `from_compiled_spec` signature = `compiled_spec, symbol, timeframe, trace, strategy_name, restore_condition_ids, opening_range_candidate`. **No** `source_timeframe_roles`, **no** `opening_range_source_frame` | **CONFIRMED** |
| §2.6 constructor accepts them | `SpecConditionStrategy.__init__` `:521-522` accepts both; `:576-577` assigns them | **CONFIRMED** |
| §2.7 dead local | `grep -rn _cls_source_timeframe_roles` over `*.py` = exactly **2** lines, `backtester.py:7534` (init) and `:7537` (assignment). **Zero reads.** | **CONFIRMED** |

**One correction to a locator, not to a conclusion.** §2.6 places the Band C factory at `backtester.py:9799`. `[MEASURED]` `:9799` is the **call site**; `from_compiled_spec` is **defined** at `src/engine/spec_condition_compiler.py:2832`. The file I would have to edit for §3.6 is therefore `spec_condition_compiler.py`, which AR-1119 never names in a path. Your conclusion is unaffected — I flag it because your §3 file scope reads narrower than the work requires.

**Prior art `[checked]`:** `system_inventory.py --check` exits **0 / FRESH** — the map matches the tree, so its unreachable classification is current, not a stale answer about a tree that no longer exists. Grep for `source_timeframe_roles|opening_range_source_frame|compile entry point` over `ADVISOR-RULINGS.md` = 0, `AGENT-REPORTS.md` = 1. **None of §3 has already landed.**

---

## 3. THE CONTRADICTION, WITH ITS CONTROLS

### 3.1 sVkm is `sVkmZklJDHI`

`[MEASURED]` `docs/designs/corpus-v3-IMPLEMENTATION-PLAN-2026-07-05.md:21` lists `sVkmZklJDHI`(risk,1m) among the corpus videos; the id recurs across the corpus/partition artifacts. This is a **real source video**, one of the 40.

### 3.2 No certified sVkm record exists — target null, control positive

Certified records live as frozen JSON in `COMMITTED_PROVENANCE_DIR = docs/replay-results/h1-battery/tier-a-extraction-provenance` (defined `opening_range_lowering.py:55`). That directory holds **13** records.

```
grep -rl "sVkmZklJDHI"  <provenance dir>/   -> exit 1, ZERO files
grep -rl "st5e-YJRfKc"  <provenance dir>/   -> _MANIFEST.json          [POSITIVE CONTROL]
manifest contains 'sVkmZklJDHI' -> False
manifest contains 'st5e-YJRfKc' -> True                                [POSITIVE CONTROL]
tier-a-compile-census.json contains 'sVkmZklJDHI' -> False
tier-a-compile-census.json contains 'st5e-YJRfKc' -> True              [POSITIVE CONTROL]
```

**The null is not a failed search:** the identical probe finds the control in the same files by the same method. `_MANIFEST.json` states the population itself — `files 13, matched_to_census_specs 11, dropped_not_clean 2`, preserved at `R-588` from a now-dead session scratchpad. **sVkm was never in it.**

### 3.3 The DB has sVkm's TRANSCRIPT but no certified record

Read-only probe (no write, no schema change, secret never printed):

```
youtube_evidence_archive rows                 : 40
sVkmZklJDHI                                   : ('sVkmZklJDHI', 25071)   <- transcript EXISTS
st5e-YJRfKc                                   : []                       <- absent, see 3.4
tables matching %extract%/%spec%/%record%/%certif%/%strateg%  : 19 listed,
   NONE is a certified-extraction-record table
```

So the **evidence** for sVkm is reachable; the **certified record object** the producer consumes is not. AR-1118 disclosed it never queried the DB — **this closes that gap, and it does not rescue the unit.**

### 3.4 The obvious substitute does not carry sVkm's semantics — I checked before proposing it

`st5e-YJRfKc__s0` is the **golden used by five test modules** and the natural candidate to re-point at. `[MEASURED]` its record contains `30 minute` ×5, `15 minute` ×2, `5 minute` ×2, and **`1 minute` / `one minute` ×0**. It is the **R-736 5/15/30 opening-range teacher, a different teacher**, exactly as `[svkm-vs-or-golden-two-sources]` recorded — and independently, it is **absent from the 40-row transcript archive** while sVkm is present, which is a second, non-overlapping way of saying they are not the same source.

That matters mechanically, not just semantically: `svkm_role_execution.py:100` pins

```
SVKM_EXPECTED_ROLE_TIMEFRAMES = {OPENING_RANGE_WINDOW:'5m', BREAKOUT_CONFIRMATION:'1m',
                                 FVG_DETECTION:'1m', ENTRY_COMPLETION:'1m'}
```

and `:137` **refuses any role set that is not that combination.** A record teaching 5/15/30 with no 1m execution **cannot** produce those four bindings, and forcing them would be precisely the "hardcoded sVkm values inserted after compilation" your §3.2 forbids.

### 3.5 Why this is a STOP and not something I route around

§3.2's forbidden list — `strategy.timeframe`, `trigger_tf`, `recoverSpecTimeframe()`, "lowest timeframe", confidence-0.4 backfill, hardcoded values, **test fixture injection** — closes every path that survives the record's absence. §3.8's acceptance witness **begins** with "REAL certified sVkm record". **There is no reading of §3.2/§3.8 I can satisfy at this pin without either fabricating source semantics or running an extraction campaign you have not authorized** (`0-CTRL.2` lists a new campaign as not auto-authorized).

---

## 4. WHAT IS *NOT* BLOCKED — AND WHY I STILL DID NOT BUILD IT

Record-independent and buildable today, in your §7 order:

| Step | Status | Note |
|---|---|---|
| §3.1 thin Python entry point → producer reachable | **UNBLOCKED** | reachability is record-agnostic |
| §3.4 TS `SpecArtifactBody`/`parseSpecArtifact` transport | **UNBLOCKED** | starts from 0 occurrences |
| §3.6 factory pass-through into `SpecConditionStrategy` | **UNBLOCKED** | pure wiring, `spec_condition_compiler.py:2832` |
| §3.7 real direct 5m frame | **UNBLOCKED — data confirmed, see below** | |
| §3.2 real sVkm carrier from certified evidence | **BLOCKED** | no record |
| §3.3 carrier under `spec_hash` + 4 mutations | **PARTIAL** | mechanism buildable; *sVkm* values are not |
| §3.5 persist/reload the **real sVkm** artifact | **BLOCKED** | no record |
| §3.8 vertical acceptance witness | **BLOCKED** | begins at the missing record |

**§3.7 is deliverable and I nearly mis-called it a second blocker.** `data_cache/MES/` holds only `15min` + `daily` and an **empty** `ratio_adj/`. But `load_ohlcv` (`data_loader.py:746`) maps `MES→ES` via `MICRO_TO_FULL`, and `data_cache/ES/ratio_adj/` holds **real `1min.parquet` AND `5min.parquet`** with provenance sidecars. So real 1m execution + real **direct** 5m source (no resampling) are both loadable. **I report the near-miss because the bare directory listing would have justified a false blocker, and you need to know which of my nulls were probed.**

**I did not build the unblocked steps** because your §7 states this is one engineering unit and explicitly forbids an intermediate "persistence complete" report while the executing instance is unreachable. Landing 4 of 8 steps and reporting would be that report wearing different words. **Say the word and steps 1/3/5/6 go in immediately** — they are on the critical path under every resolution below.

---

## 5. THE ONE DECISION I NEED

**Where does the certified sVkm record come from?**

- **R1 — authorize a certified extraction of `sVkmZklJDHI`.** Its transcript is present (25,071 chars) and reachable. This produces the genuine record and keeps §3.2/§3.8 exactly as written. Cost: an extraction run, which is a scope you must open, and `[transcript-audit]` gates its quality before it may be trusted as source authority.
- **R2 — re-point the vertical witness to a certified record that exists.** `[MEASURED]` **none of the 13 teaches a 5m-window/1m-execution role set**, so the sVkm role table and its validator would both have to change, and the unit stops being the sVkm slice.
- **R3 — split the unit**, landing §3.1/§3.4/§3.6/§3.7 as an ingress spine now and holding §3.2/§3.5/§3.8 for the record. This contradicts your §7 as written, so it is yours to grant, not mine to assume.

**My recommendation: R1, with R3's spine landed in parallel.** R1 is the only option where the producer emits a fact it is actually the authority for — the same principle that made you choose B2 over B1. The spine is record-independent, on the critical path under every branch, and holding it back buys nothing.

---

## 6. DISCLOSURES

- **Read-only DB access.** I connected to `DATABASE_URL` and ran three `SELECT`s. No write, no schema change, no credential printed. If you consider even read access outside §3's scope, say so and I will not repeat it — but it is what converted AR-1118's RELAYED gap into a measurement.
- **My table-name probe is a pattern match, not a closure.** I searched `%extract%|%spec%|%record%|%certif%|%strateg%`. A certified-record table named outside those five patterns would not have been found. The disk-side absence is separately control-probed and does not depend on this.
- **The `st5e-YJRfKc` DB query returned empty, so it is a weak control for connectivity** — the sVkm row returning data is the positive witness that the query mechanism worked. Its emptiness is a real finding (consistent with the golden's quotes matching none of the 40 archived transcripts), not an instrument failure.
- **My timeframe scan of the 13 records is crude token counting**, used only to *rank* candidates. The load-bearing claim — sVkm's absence — rests on exact id greps with positive controls in three separate artifacts, not on that scan.
- **I have not re-derived the TS entry-point closure**; §2.1/§2.4 reachability is read from AR-1118 plus my own zero-occurrence grep.
- **No test was run, no suite measured, no regression claimed.** Nothing to red-proof: nothing was built.
- **Performance remains BLOCKED.** No grade dispatched — your §6 puts the independent grade after §9.2/§9.3/§9.4, so it is not yet pre-authorized.

---

## 7. POSITION

Head `d8fa1958`, working tree carries only pre-existing untracked docs from prior seats — **I added nothing**. §9.1 stays closed at the consumer boundary. §9.2 is **NOT STARTED and NOT CLAIMED**, held on the §5 decision. The ear is armed at `9c0d14cd` and will fire on your next push.
