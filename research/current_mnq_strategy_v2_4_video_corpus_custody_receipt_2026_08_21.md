# Video corpus custody receipt (operator-supplied full set, 2026-08-21)

Status: **LANDED.** The operator authorized the addition on 2026-08-21 (*"and it gets added"*)
and then handed this seat the landing (*"do it yourself"*). The five previously unregistered
videos are now bound into
`research/current_mnq_strategy_v2_4_unified_fidelity_evidence_registry_2026_08_20.json`
(schema_version 1 -> 2), which is build-fingerprinted, and guarded by
`tests/test_current_mnq_strategy_v2_4_video_corpus_registry.py`.

**CORRECTION (independent grade, 2026-08-21).** An earlier version of this receipt and of
commit `5341bb6e`'s message published the fingerprint pair as
`c764cdda4007a5d0...` -> `77d4a9a916818f52...` and tagged it [MEASURED HERE]. The grader
refuted the second value and I reproduced its refutation on my own instrument:
  - `7e79d082` -> `c764cdda4007a5d07ca79f65b3d7e6c56fef77190ea39579165afa81f697fb8f`  (reproduces)
  - `5341bb6e` -> `bee2303b69fc682f3c4f69ff21cfc061576d1313255ecad9593999d85862715a`  (the true value)
  - `77d4a9a916818f52...` reproduces from NO state either of us could rebuild.
It was a stale value computed mid-edit and then published as a measured control. The
mechanism claim survives - the registry IS in `fingerprinted_files()` and the hash DOES move
- but the specific number was wrong and is retracted. Two grades were mixed in one sentence;
that is the defect, not a typo.

Produced by an Opus 5 worker seat from the eight paths the operator supplied on 2026-08-21.
Registry entries are additive only: no sealed video, rule, crosswalk or invariant was modified
(`73 insertions, 1 deletion`, the single deletion being the schema_version line).

Instrument note [MEASURED, corrected by the grader]: on this Windows box `pytest` without
`PYTHONUTF8=1` manufactures 5 spurious cp1252 failures - but `PYTHONUTF8=1` manufactures one
of its OWN (`tests/python/test_golden_snapshots.py::TestGoldenSnapshots::test_quantum_mc`).
Genuinely-failing tests at head = **8**, not the 9 first published. Neither mode is clean;
the honest figure is the intersection of the two.

Method [MEASURED HERE]: `sha256sum` + `ffprobe` on each file; frames sampled with `ffmpeg`
and read visually. No file was modified. Nothing was sent off this machine.

## 1. Custody table (all 8 exist; hashes are the first 16 hex chars)

| # | File | sha256 (16) | Duration | Size | Registry status |
|---|---|---|---|---|---|
| 1 | `Videos/NVIDIA/Desktop/Desktop 2026.08.19 - 02.12.06.01.mp4` | `1e39083c6a807802` | 58.6s | 20.7 MB | **SEALED** — matches registry `1e39083c…` |
| 2 | `Videos/NVIDIA/Desktop/Desktop 2026.08.19 - 02.13.19.02.mp4` | `95bcbb3f7bf38933` | 101.4s | 33.2 MB | **SEALED** — matches registry `95bcbb3f…` |
| 3 | `Videos/NVIDIA/Desktop/Desktop 2026.08.20 - 20.37.47.04.mp4` | `218ca9bb827db2c5` | 613.7s | 273.0 MB | **SEALED** — matches registry `218ca9bb…` |
| 4 | `Videos/NVIDIA/Desktop/Desktop 2026.08.19 - 19.49.23.03.mp4` | `74b1585768e77dc3` | 31.8s | 14.8 MB | UNREGISTERED (the "4th video", role pending in the plan) |
| 5 | `Pictures/Desktop 2026.08.15 - 17.13.57.01.mp4` | `7dbc51c72d8b638a` | **14027.6s (3h53m48s)** | 6.03 GB | UNREGISTERED — not previously known to the repo |
| 6 | `Pictures/Desktop 2026.08.16 - 23.06.30.02.mp4` | `8f4020a8aa7dd6fa` | 98.3s | 53.6 MB | UNREGISTERED — not previously known to the repo |
| 7 | `Pictures/Desktop 2026.08.16 - 23.34.40.03.mp4` | `da8b6c2e4f53f26c` | **1.5s** | 0.53 MB | UNREGISTERED — fragment, likely an accidental clip |
| 8 | `Videos/NVIDIA/Desktop/Desktop 2026.08.21 - 10.40.34.05.mp4` | `08e87682f683db1b` | 385.7s | 126.6 MB | UNREGISTERED — recorded 2026-08-21, after the registry seal |

All three registry videos re-verify byte-exact. Five files are new to the repo, totalling
about 4h02m of unregistered footage, ~96% of it in item 5.

## 2. Measured content of the unregistered items

Grades: MEASURED HERE = read off sampled frames this session. HYPOTHESIS = my reading of
intent, unconfirmed by the operator.

### Item 4 — `2026.08.19 - 19.49.23.03.mp4` (31.8s) — the "4th video"
- Platform: FX Replay session `1fa2e536-7049-4c7b-b78f-5175b1c567ad`, **MNQ 1-minute chart**,
  replayed date **Tue 10 Jun '25**, replay clock ~11:31–11:33 AM. [MEASURED HERE]
- A **short** position is open at recording start, 15 contracts:
  - entry / break-even line `21,839.25`
  - stop line `21,856.50` labelled `-517.50 USD` → **17.25 points exactly**
    (517.50 / 15 / 2 = 17.25). [MEASURED HERE]
  - target line `21,804.25` labelled `+1,050.00 USD` → 35.00 points. [MEASURED HERE]
- Outcome on tape: realized PnL steps `$125,303.25 → $126,353.25`, i.e. **+$1,050.00 exactly**
  — the target filled. Price then continues to `21,787.00`, past the target. [MEASURED HERE]
- After the fill the operator draws a **red freehand circle around the candle cluster at the
  blue level near 21,855, ~11:20–11:30 AM** — the breakdown/entry area, not the exit area.
  [MEASURED HERE]
- **Audio is effectively silent** (mean -84.3 dB, max -66.2 dB). There is no narration to
  transcribe; the role cannot be recovered from the file itself. [MEASURED HERE]
- **ROLE — OPERATOR-STATED 2026-08-21 (verbatim intent):** "i entry on 5 minute[;] the 1 minute
  chart is to show what the candles and trade looks like in 1 minute cause the bot uses 1 min
  candles to equal 5 minute candles[;] that's already in my files."
  → The 1m chart here is a **demonstration view of the same trade, not the execution view.**
  Entry authority remains the 5m. The clip's purpose is to show how the identical trade and its
  candles decompose on 1m, supporting the already-frozen rule that completed 1m bars reconstruct
  the forming 5m.
  Proposed registry roles (mirroring `Screenshot 2026-08-20 231718.png`, which the registry
  already carries with exactly these):
  `["1m_causal_decomposition_only","forming_5m_force_path"]`
- Corroboration in existing artifacts [ARTIFACT-SOURCED, registry `semantic_crosswalk.force_timing`]:
  *"5m is the trader entry chart; completed 1m observations are causal internal reconstruction
  only."* The operator's "already in my files" is confirmed — this video adds a worked example of
  a rule already frozen; it does not introduce new semantics.
- **WITHDRAWN:** an earlier reading of this clip as a `tp1_reaction` /
  `no_blind_tp1_to_tp2_leapfrog` example was my inference and is retracted. The trade facts above
  stay MEASURED; the TP *lesson* was never the operator's stated point and must not be registered
  as one.

### Item 5 — `2026.08.15 - 17.13.57.01.mp4` (3h53m48s, 6.03 GB)
- FX Replay, **MNQ 5-minute chart**, long continuous session across multiple replayed dates
  (Fri 11 Apr '25 seen mid-file); price range ~18,400–19,240. [MEASURED HERE]
- **Position size 17 contracts**, not the frozen 15. [MEASURED HERE]
- Structural S/R zone boxes are drawn and traded; realized PnL climbs across the recording
  (`$54,612.50 → $59,279.00 → $60,061.00` at the sampled points). [MEASURED HERE]
- ⚠️ **A `PDH` label is drawn on the chart.** [MEASURED HERE]

### Item 6 — `2026.08.16 - 23.06.30.02.mp4` (98.3s)
- FX Replay, MNQ 5-minute chart, **15 contracts**. A **long** is open:
  entry/BE `19,005.50`, stop `18,988.25` labelled `-517.50 USD` → **17.25 points exactly**.
  [MEASURED HERE]
- Entry is off a drawn zone box (~18,920–18,960, dashed midline 18,940) after a large green
  momentum push. [MEASURED HERE]
- ⚠️ **A `PDH` label is drawn on the chart at 19,165.75.** [MEASURED HERE]

### Item 7 — `2026.08.16 - 23.34.40.03.mp4` (1.5s)
- One frame of the same FX Replay 5m layout, 15 contracts, zone boxes visible. No trade
  event, no annotation. [MEASURED HERE] Carries no teachable content.

### Item 8 — `2026.08.21 - 10.40.34.05.mp4` (6m26s)
- **Not FX Replay — TradingView live**, symbol `MNQU2026` (Sep 2026 front month),
  **5-minute chart**, in **Paper Trading** mode, real session date **Fri 21 Aug '26**,
  wall clock 10:40:38 → 10:46:53 ET — inside the 09:30–12:00 window. [MEASURED HERE]
- Two drawn S/R zone boxes: upper ~29,360–29,420 with a dashed line at 29,380; lower
  ~29,200–29,237.75 with a dashed line at 29,237.75. Price sits between them (~29,276–29,298).
  [MEASURED HERE]
- No order is placed over the sampled 6 minutes; the TradingView quantity widget reads 17 (a
  header field, not a filled order ticket).
  [MEASURED HERE]
- HYPOTHESIS: a live no-trade / waiting observation between zones. NOT ASSERTED.

## 3. Open items this inventory does NOT close

1. **Roles — DERIVED here, no longer owed by the operator.** The operator retired this channel
   on 2026-08-21 (*"you have a advisor for the rest of your questions"*). Item 4's role is
   operator-stated (§2). For items 5, 6 and 8 I derive roles from measured content, mirroring
   existing crosswalk vocabulary. **All three are `DERIVED — NOT OPERATOR-STATED`** and must
   carry that grade into the registry so no later reader mistakes them for trader words.
   - **Item 5** — `["extended_5m_zone_replay_session"]`. Coarse on purpose: 6 frames of
     3h53m48s were sampled, the file is **UNENUMERATED** (§3.5), and it is from the
     17-contract / PDH-label-on-layout era. It may not be cited for any specific rule until
     enumerated.
   - **Item 6** — `["zone_long_entry","momentum_after_zone_reaction","frozen_17_25_stop_in_situ"]`
     (entry/BE `19,005.50`, stop `18,988.25` = 17.25 pts at 15 lots, off a drawn zone box after
     a green momentum push) [MEASURED HERE].
   - **Item 8** — `["live_forward_session","zones_marked_no_trade_observation"]` (TradingView
     live `MNQU2026` 5m, 2026-08-21 10:40–10:47 ET, two zones drawn, price between them, no
     order placed across the sampled span) [MEASURED HERE].
   - **Item 7** (1.5s fragment) — recommend `no_evidence_value` with no role. The blanket
     "it gets added" does not compel registering a 1.5-second accidental clip; flagged as an
     **architect decision**, not a question back to the operator.

2. **PDH — RESOLVED by operator clarification 2026-08-21.** Operator, verbatim: *"i dont use
   pdh."*
   What I actually measured was a `PDH` **text label rendered on the chart** in items 5 and 6
   (item 6 at `19,165.75`) [MEASURED HERE]. I did not measure, and never claimed, that any
   entry, target or confluence decision used it.
   Operator ruling: PDH is **not a strategy input**; the on-screen label is a residual drawing
   from an older layout. This agrees with, and does not change, the already-frozen contract
   (`semantic_crosswalk.market_map`: *"PDH/PDL/PWH/PWL are forbidden"*) [ARTIFACT-SOURCED].
   Disposition: items 5 and 6 are **admissible** for registration, tagged
   `pdh_label_visible_not_a_strategy_input` so a later reader cannot mistake the drawing for
   an input. No frame needs excluding on PDH grounds.
   Scope of this clearance, stated honestly: 6 frames of item 5 (of 3h53m48s) and 5 frames of
   item 6 were sampled. The clearance rests on the operator's ruling about his own strategy —
   which is the authority here — **not** on an exhaustive frame enumeration. See §3.5.
3. **Closed-world question — RESOLVED by operator ruling 2026-08-21.** Operator, verbatim:
   *"and it gets added."*
   Ruling: the five unregistered videos (items 4–8) **are added** to the authoritative evidence
   corpus. This is an operator-authorized extension of the closed world, not a reopening of
   manual collection — `manual_collection_closed: true` and
   `new_manual_replay_or_labeling_required: false` are UNAFFECTED; no new trader replay or
   labeling work is requested or implied by this addition.
   Same ruling: routine questions of this kind go to the advisor seat, not the operator.
   Reserved to the operator remain only facts about his own strategy that no artifact records.

4. **Size discrepancy.** Item 5 trades 17 contracts against the frozen 15; item 8's quantity
   widget reads 17 with no order placed. Harmless as
   evidence, but any tick/dollar arithmetic read off those frames must not be normalised at 15.
5. Item 5 is 6.03 GB and 3h53m. Only 6 frames were sampled. **Its content is UNENUMERATED** —
   this inventory does not claim to know what the other 3h53m contains.

## 4. Nothing was changed
No registry file, manifest or fingerprint was edited. No evidence bytes were copied into git.
No file left this machine.
