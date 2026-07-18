# H1 SEALED-12 TERMINAL-READ — CONDUCTOR RUNBOOK (2026-07-17)

> **STATUS: RE-FROZEN (R-034, 2026-07-17 — see ADDENDUM A + B + C at the end).** R-034: Phase-B now embeds the driver-derived enumerator inventory for the ONE consensus strategy (input faithfulness); PANELS are an operationalized named command `--dispatch panel --cid <cid>` (3 calibrated gpt-5.4 graders byte-unchanged, cap-guarded). Prior R-031 (see ADDENDUM B). R-031: raters are now TWO sequential stage-scoped dispatches per rater (Stage-1 blind roles committed BEFORE Stage-2's revealed conditions are ever in a prompt); the packet carries its own answer-store output_contract (values derived from the frozen ingesters); out-of-vocabulary answers HALT. Prior R-030: the CLI now OWNS each dispatch: it shells a no-tools (`--tools ""`, physically blind) `claude -p` with the transcript / rater-packet CONTENT embedded, strict-parses, and re-dispatches on non-compliant JSON up to a cap of 2 — the conductor runs ONE `--dispatch` command per seam and never shells `claude -p` or hands a transcript path to a subagent. Prior standing: RE-FROZEN (R-026.4, 2026-07-17). STEP 1 rewritten to the STAGED (emit-and-stop) sequence after the live Phase-A→consensus→Phase-B ordering gap was found + fixed (R-026 / staged CLI `e0e5dccc`, independently graded Band 7 SAFE): the sealed read is a stage loop (phase_a → fulfil Phase-B → certify → fulfil panels+raters → verdict), each stage emitting what to dispatch next. **Comprehension RE-PROBED on the amended staged steps (2026-07-17): a fresh reader answered the full staged sequence, "the DRIVER computes the consensus; you only READ its emit," and the HALT/no-retry/read-once rule — all verbatim from the steps.** Prior standing: ratified R-024 (amendments 1-3), staging-rehearsed zero-hints (R-023.1c). This is the ONLY document the seal-day clean-room conductor receives; self-contained on purpose. Do not edit — amend by dated addendum only.

---

## WHO YOU ARE (read this first)
You are the **clean-room conductor** for the H1 sealed-12 terminal read. You are a **process executor, not a judge.** The DRIVER is the brains — it builds packets, runs the fidelity checks, assembles certificates, computes the verdict, and re-verifies. Your ONLY job is to run the process below exactly and report the driver's verdict **verbatim**.

**BLINDNESS (absolute):** you do NOT open the video transcripts, any answer key, any "expected" result, any prior campaign document, or this campaign's history. You see ONLY what the driver's stages emit. If you find yourself wanting to read a transcript or judge whether an answer is "right," STOP — that is not your role.

**HALT DISCIPLINE (absolute):** if ANY step below prints a HALT / mismatch / refusal / error, you **STOP and report it verbatim**. You NEVER work around a HALT, retry it, edit inputs to get past it, or "fix" anything. A guard that fires is the instrument doing its job.

**READ-ONCE (absolute):** the sealed read is computed ONCE. No re-runs, no retries, beyond the one thing the driver itself does automatically (a single blind adjudication for an enumeration-unstable video, per the k=5 protocol — the driver handles that; you do not initiate it).

---

## STEP 0 — OPERATOR AUTHORIZATION GATE
Check whether the operator's go-token exists:
```
ls docs/designs/SEAL-GO.token
```
- **Absent** → the operator has NOT authorized the read. **STOP.** Report: "No SEAL-GO.token — the sealed read is not authorized." Do NOTHING else. (You NEVER create this file. Only the operator authors it, in his own words.)
- **Present** → proceed to STEP 1.

*(For a STAGING RUNBOOK REHEARSAL only — no token, spent videos: skip STEP 0 and run STEP 1 with `--mode staging`. Staging NEVER touches the sealed 12.)*

## STEP 1 — INVOKE THE DRIVER (sealed = a STAGED loop; staging = one shot)
The CLI pins the sealed-12 manifest (`docs/designs/h1-wave6-sealed-fresh-set-2026-07-12.json`, read from disk — never typed) and verifies the seal.

**Staging rehearsal (no token, spent videos):** one command, fully cached —
`python scripts/h1_seal_conductor_cli.py --mode staging` → it prints the verdict; go to STEP 5.

**Sealed read (token present):** the read runs in STAGES. You dispatch subagents, then invoke the next stage; each stage EMITS what you must fulfil next, then STOPS. Pick a fresh empty `<dir>` for `--work-dir` and use the SAME one every stage. The loop:
1. **Dispatch Phase-A (STEP 2):** for each of the twelve videos, dispatch FIVE blind Phase-A draws to the file paths the CLI's emit will name (`phase_a/<vid>/draw_<0..4>.json`).
2. **Run stage phase_a:** `python scripts/h1_seal_conductor_cli.py --mode sealed --stage phase_a --work-dir <dir>` → the DRIVER computes the consensus and emits, per video, the strategy list to extract (`emit/phase_a_consensus.json`), then STOPS. You do NOT compute the consensus — you only READ the driver's emit to know what to dispatch next.
3. **Dispatch Phase-B (STEP 2):** for each strategy the emit names, dispatch ONE Phase-B subagent → write the named `phase_b/<cid>.json`.
4. **Run stage certify:** `… --stage certify --work-dir <dir>` → it emits the panel requests + the two-stage rater packets (`emit/panel_requests.json`, `emit/rater_packets.json`), then STOPS.
5. **Dispatch panels + raters (STEP 3):** for each emitted cid, dispatch its panel → `panels/<cid>.json`; for each emitted packet, dispatch the TWO blind raters → the named `raters/…` files.
6. **Run stage verdict:** `… --stage verdict --work-dir <dir>` → it drives the read to the end, re-verifies, and prints the verdict. Go to STEP 5.

At ANY stage, a guard HALT (seal / identity / hash-mismatch / leak-scan / missing artifact) ⇒ STOP and report it verbatim (STEP 5). You NEVER re-run a stage to "get past" a HALT, and you never re-dispatch a draw already written (re-running a stage only re-reads files — read-once).

## STEP 2 — WHEN THE DRIVER ASKS FOR A LIVE EXTRACTION (sealed mode)
The CLI names **each required dispatch INDIVIDUALLY** — you never decide the granularity, and you **NEVER combine dispatches**. Each is a **fresh Claude subagent on the subscription channel** (Claude Code dispatch, interactive or headless `claude -p` — same subscription runtime; NEVER the API):
- **Phase-A is FIVE separate dispatches per video — draw N of 5 is its OWN fresh subagent, BLIND to the other four draws.** (The k=5 modal-consensus stability measure is only valid if the five draws are independent; one subagent doing five draws is correlated and silently corrupts the read. The driver — not you — combines the five draws into the consensus + stability.)
- **Phase-B is ONE fresh subagent PER STRATEGY** (single-draw), for each strategy the consensus produced.
- Set the model EXPLICITLY per dispatch: `claude-opus-4-8[1m]`.
- Give each subagent ONLY the frozen prompt the CLI names (enumerator-v1.2 for a Phase-A draw; frontier-v3.2 for a Phase-B strategy) **and the transcript PATH the CLI names — the subagent reads that file itself. You NEVER open, cat, or paste transcript contents** (that would break your blindness). Nothing else.
- The subagent writes its artifact byte-exact to the path the CLI names.
- Record the **dispatch record** the CLI asks for PER DISPATCH: `{requested_model: "claude-opus-4-8[1m]", resolved_model: <what actually ran>, channel_class: "subscription", dispatch_mode: "interactive"|"headless"}`. The driver's guard asserts each against the frozen identity — if it HALTs on a mismatch, STOP and report.

## STEP 3 — WHEN THE DRIVER ASKS FOR LIVE RATERS (sealed mode)
For each two-stage tier-3 packet the driver emits, dispatch **two independent blind raters = fresh Claude subagents, subscription channel, model set EXPLICITLY per dispatch** (`claude-opus-4-8[1m]`; never the API, never a different rater brain — the independent axis is the model-free locator + F-2 floor, not a different model). Each follows the driver's packet EXACTLY:
- Controls first; Stage-1 (role from the quote ALONE) committed BEFORE Stage-2 (revealed condition support) is shown — the driver's packet enforces the read-order lock; do not reorder.
- The two raters never see each other's answers and never see the reader's identity.
- Return each rater's answers to the CLI as instructed. The driver applies the control gate and composes the verdicts.
- If the driver's leak-scan HALTs a packet, STOP and report — never dispatch a HALTed packet.

## STEP 4 — LET THE DRIVER DO THE BRAINS
The driver (not you) runs the fidelity panels (completeness + conflation + enum axes, cross-vendor), assembles each certificate, applies the ≥60% video-unit bar on the structural fence, records economics + validity + scope lines, and independently re-verifies the verdict from the persisted artifacts. You do not judge any of this.

**Note — the anchor-locator is DRIVER-INTERNAL:** grounding each condition to its transcript quote uses a LOCAL model (gemma, propose-then-mechanically-verify) that the driver invokes itself. You do NOT dispatch a subagent for it and you do NOT touch it — it is part of the driver's automatic machinery. (The only things YOU dispatch as subagents are the extractions in STEP 2 and the two raters in STEP 3.)

## STEP 5 — REPORT THE VERDICT VERBATIM
When the CLI prints the final verdict block, report it **exactly as printed** — verdict, video-unit fraction, meets_bar, economics (with any ceiling flag), validity, and all scope lines. Add NOTHING. Interpret NOTHING. If validity is INVALID or any stage HALTed, report that verbatim as the outcome.

---

## THE ONLY OUTCOMES YOU REPORT
1. **A verdict block** (FIDELITY_PASS / FIDELITY_MISS with the fraction + riders + scope lines), reported verbatim; or
2. **A HALT** (no token / seal mismatch / identity mismatch / leak-scan / validity INVALID), reported verbatim.
Nothing else. You never add a judgment, a fix, or a retry.

---

## ADDENDUM A — 2026-07-17 (R-030): the CLI now OWNS each dispatch (no-tools, embedded content, bounded format-retry)

**This addendum SUPERSEDES the dispatch MECHANICS of STEP 2 (lines describing "dispatch a fresh `claude -p` subagent … give it the transcript PATH … the subagent reads that file itself") and the parallel dispatch mechanics of STEP 3.** The SEQUENCE (5 blind Phase-A draws/video, driver computes consensus, one Phase-B per strategy, two blind raters), the BLINDNESS / HALT / READ-ONCE disciplines, and STEPS 0/1/4/5 are UNCHANGED. What changes is HOW a single dispatch is performed.

**You no longer shell `claude -p` yourself, and you never hand a transcript path to a subagent.** For every dispatch, the CLI's emit (the `plan` stage's `phase_a_dispatches[].dispatch_command`, the `certify` stage's Phase-B and rater `dispatch_command_template`) names **ONE command**:

```
python <this CLI> --mode sealed --work-dir <wd> --dispatch <seam> [--video-id <V>] [--draw-index <i> | --strategy-index <i> | --rater-id <A|B>]
```

**You run that one command, verbatim, exactly as emitted.** Running it makes the CLI do all of the following itself (you do none of it):
- Read the fetched transcript (Phase-A/Phase-B) or the emitted rater packet (rater) from disk and **EMBED its CONTENT** into the model prompt. You never open, cat, or paste it — and now neither does the subagent.
- Shell a **fresh Claude subagent on the subscription channel** (`claude -p`, model set explicitly from the frozen identity) run with **`--tools ""` — NO tools at all.** The subagent is **physically blind**: with no Read tool it cannot open the transcript path, a cached answer, the manifest, or any file. It sees ONLY the embedded content. (Verified live: a `--tools ""` subagent asked to read a planted secret returned `NOTOOLS_CONFIRMED`.)
- Strict-parse the subagent's stdout. If it is not a single clean JSON object, the CLI **re-dispatches automatically up to 2 times (3 attempts total)**, quarantining each non-compliant output. **This bounded, format-only re-dispatch is the CLI's own mechanism — it is NOT a read-once violation and NOT something you initiate:** you still run the ONE command once; the CLI yields exactly ONE ingested draw. If the CLI prints **`HALT: dispatch NON-COMPLIANT … exhausted`** (the model never emitted clean JSON in 3 attempts), you **STOP and report it verbatim** (HALT discipline — you never re-run it).
- Wrap the compliant output into the ingested artifact (identity from the frozen record, dispatch record embedded) at the path the emit names. **You no longer hand-record the dispatch record** — the CLI fills `resolved_model` from the actual dispatch and asserts it against the frozen identity itself; a mismatch HALTs, and you report it.

**STEP 3 raters, the same way:** run the emitted `--dispatch rater --rater-id <A|B>` command per rater. The CLI embeds the emitted rater packet (which carries its own instructions) with `--tools ""` and writes `raters/<id>.json`. You never open the packet or hand it to a subagent by path.

The instrument-surface wrapper text + the exact invocation are recorded in `docs/designs/h1-dispatch-wrapper-params-addendum-2026-07-17.md`. Independently graded BAND 8 SAFE (doer≠grader, all mutations RED). Everything else in this runbook stands.

---

## ADDENDUM B — 2026-07-17 (R-031): raters are TWO sequential stage-scoped dispatches

**This addendum SUPERSEDES the rater dispatch in STEP 3 / Addendum A ("run the emitted `--dispatch rater --rater-id <A|B>` command per rater").** The R-030 §4 live rehearsal showed a single rater dispatch embedded BOTH the blind Stage-1 view AND the revealed Stage-2 conditions in one prompt — breaking the two-stage read-order lock (Stage-1 blind role-from-quote must be committed BEFORE Stage-2's revealed conditions are seen). R-031 ruled: split into two sequential dispatches per rater.

**For each rater (A, B), run TWO commands the certify emit names, IN ORDER:**
```
python <this CLI> --mode sealed --work-dir <wd> --dispatch rater --rater-id <A|B> --rater-stage stage1
python <this CLI> --mode sealed --work-dir <wd> --dispatch rater --rater-id <A|B> --rater-stage stage2
```
Running each command makes the CLI embed ONLY that stage's blind view + the packet's own output_contract into a no-tools `claude -p` (the Stage-1 prompt PHYSICALLY excludes the revealed Stage-2 conditions), strict-parse, retry-on-non-compliant up to the cap, enforce the packet's closed vocabulary (an out-of-vocabulary role/support — or a blank Stage-2 `support_justification` — HALTs), and MERGE the stage into `raters/<id>.json`. You still never open the packet or shell `claude -p` yourself. If either stage prints a HALT, STOP and report it verbatim. Everything else in this runbook stands.

---

---

## ADDENDUM C — 2026-07-17 (R-034): PANELS are a named dispatch; Phase-B is scoped

The seam-enumeration + input-faithfulness laws (R-033/R-034) found that the pipeline dropped the calibrated inter-stage inputs. Two conductor-visible changes:

- **STEP 2 Phase-B is now SCOPED.** You still run `--dispatch phase_b --video-id <V> --strategy-index <i>`; the CLI now embeds the transcript PLUS the driver-derived enumerator inventory for that ONE consensus strategy (name, entry/exit summaries, variants, element_inventory), so the frontier extracts the intended strategy accountable to its inventory. You do nothing differently — the CLI threads it mechanically (you stay blind).
- **STEP 4 PANELS are now an operationalized named command.** For each cid the certify emit names, run:
```
python <this CLI> --mode sealed --work-dir <wd> --dispatch panel --cid <cid>
```
This makes the CLI run the THREE calibrated gpt-5.4 graders (byte-unchanged) fed the threaded inventory + sealed extraction + transcript, cap-guarded, and write `panels/<cid>.json`. It is a cross-vendor gpt-5.4 call (real metered $, under the standing envelope with the mid-run hard-cap armed) — NOT a no-tools `claude -p`. A cap breach or missing input HALTs; STOP and report. Everything else stands.

---

*Runbook authored 2026-07-17 by the working agent under R-023.1a; ratified R-024, staging-rehearsed (R-023.1c), re-frozen R-026.4, amended + re-frozen R-030 (Addendum A), amended R-031 (Addendum B), and amended R-034 (Addendum C). Amend by dated addendum only.*
