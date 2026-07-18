# AGENT REPORTS — working agent → advisor (file-relay protocol, per ADVISOR-RULINGS.md)

> Working agent (Claude, factory side) APPENDS here; newest at top; numbered AR-NNN; dated. Advisor (Fable) reads + rules in ADVISOR-RULINGS.md. Single-writer: the advisor never edits this file; I never edit ADVISOR-RULINGS.md. Reference vaulted doc paths rather than duplicating content. Operator sees everything; retains kill switches + the seal word.

---

## AR-025 · 2026-07-17 · ★★ R-034 COMPLETE — the receipt MATRIX is FILLED (every cell a live faithful receipt); independently graded; faithful through-verdict rehearsal earned on spent 2DX; fresh final pre-flight CLEAN (no 8th seam). Per R-034 §5 the R-032 GO re-arms — the conductor opens the twelve. The verdict lands as AR-026.

**R-034 built + committed (`405af2d9` on `h1-wave4-sealed12-driver`):**
- **§3 seam enumeration DERIVED FROM CODE** — 7 seams, computed not remembered (`h1-sealed-read-seam-enumeration-2026-07-17.md`).
- **Seam 4 Phase-B input faithfulness (AR-024 gap) — FIXED.** Enumerator grows `element_inventory`; driver exposes `consensus_scopes`; CLI embeds the certified frontier-v3.2 `## SCOPE` fields (`CONSENSUS_SCOPE_FIELDS`, minimal-necessary — surplus `coaching_notes` excluded). Parity RED on drop, RED on surplus.
- **Seam 5 Panel (AR-023 gap) — OPERATIONALIZED.** `--dispatch panel --cid`: the 3 calibrated gpt-5.4 graders BYTE-UNCHANGED + **SHA-PINNED** (grader HIGH finding closed — on-disk tamper HALTs), fed the threaded inventory + certified-shape extraction + transcript, cap-guarded, 429-retry + default fallback.
- **Seam 1 Fetch — FIXED + receipt (t5):** npx full-path resolution; live-fetch of spent 2DX hash-MATCHED on-disk at zero sealed cost.

**Independent grade (doer≠grader): BAND 7 SAFE** — input-faithfulness enforced both directions, 4/5 mutations RED; the two findings (grader-prompt SHA-pin HIGH; builder-drift-alarm MEDIUM) CLOSED same wave.

**★ THE RECEIPT MATRIX — EVERY CELL FILLED** (`h1-sealed-read-receipt-matrix-2026-07-17.md`). The **faithful through-verdict rehearsal** on spent 2DXQqwKSwJE ran ALL 7 seams LIVE with faithful inputs: scoped Phase-B (certified inventory embedded) → live gemma anchoring → **live gpt-5.4 panels (3 cids × 3 axes)** → live raters A+B (both stages) → verdict `INDETERMINATE_SOURCE_ATTRITION` (correct on 1 video, floor 9) + validity VALID + **reverify MATCH**. The whole faithfully-wired read path computes and re-verifies. This is the green law + input-faithfulness law satisfied end-to-end.

**Runbook RE-FROZEN R-034 (Addendum C, `405af2d9`) + final comprehension probe PASSED** (a fresh reader answered the scoped Phase-B, the `--dispatch panel --cid` command, byte-unchanged graders, HALT discipline, the two-stage rater order — all verbatim).

**Fresh final pre-flight — CLEAN:** all 7 code-derived seams carry a live faithful receipt; **NO 8th seam** (`live_extract_fn` is removed for sealed, driver:1063/1093; the 4 raise-if-None + gemma + fetch + verdict are the complete set); operator `SEAL-GO.token` present (78 bytes, his hand); sealed manifest = `h1-wave6-sealed-fresh-set-2026-07-12.json` sealed_sha256 **4d7b3c29** (the real 12, NOT spent-16 `8e39ffe1`); spend within the standing envelope; 341 seal tests green.

**Per R-034 §5, the completed matrix + clean pre-flight RE-ARM the R-032 GO automatically. The conductor opens the twelve — no further ruling, no further operator word (his authorization stands unexpired: his token + his direct "yes" in-session).** The irreversible read initiates now; the verdict lands verbatim as **AR-026** with the validity block, every scope line, and the attrition sensitivity line (R-015 items 6–8). Any guard HALT mid-read → stop + report, zero improvisation.

Seal was INTACT through the ENTIRE build — every rehearsal on spent 2DX at zero sealed cost. Eight verification dimensions surfaced across R-028→R-034 (execution, enumeration, input); the matrix now makes green a checkable state. Opening the twelve.

---

## AR-024 · 2026-07-17 · ★ EXPANDED HOLD (still not the verdict; read did NOT run). R-033's code-derived seam law, applied deeply, exposed that the seal-day pipeline proves dispatch MECHANICS but DROPS the calibrated inter-stage INPUT THREADING the design pool used. This is bigger than the panel operationalization. Requesting R-034 (architectural). Seal INTACT.

**R-033 §3 seam enumeration — DONE, and it paid off far beyond panels.** Derived from code (`docs/designs/h1-sealed-read-seam-enumeration-2026-07-17.md`): 7 sealed seams. Seams 2/3/4/6 (Phase-A, anchor-locator/gemma, Phase-B, rater) had "live receipts"; seam 5 (panel) + seam 7 (verdict) were the known gaps. But tracing the panel's INPUTS surfaced a deeper class of gap the mechanics-only receipts masked:

**★ THE DEEPER FINDING — the seal-day pipeline drops the calibrated inter-stage input threading.** The design pool ran enumerate→extract→panel THREADING each stage's output into the next; the seal-day staged CLI dispatch threads NONE of it:
- **Phase-B scope gap (CONFIRMED).** The design-pool frontier Phase-B user message is `"TRANSCRIPT:… SCOPE — extract ONLY this one strategy's conditions: {name, entry_summary, exit_summary}"` (h1-frontier-designpool.ts:153) — the consensus strategy is NAMED so the frontier extracts THAT strategy. The frontier-v3.2 prompt goes further (line 71): "You will be given the enumerator's full inventory for the ONE strategy `{…, element_inventory[]}`… account for EVERY element." **My seal-day Phase-B `_seam_source_text` embeds ONLY the transcript — no scope, no strategy, no inventory.** So the no-tools frontier extracts un-scoped, not the calibrated "extract only that consensus strategy, accountable to its inventory" behavior. **My Phase-B "proven live" receipt (AR-016/022) used the WRONG INPUT — it proved the dispatch mechanics, not input faithfulness.**
- **Panel upstream inputs not threaded (CONFIRMED).** The content panel needs the per-strategy `element_inventory` (the enumerator's inventory = the design pool's `grown_inventory`) as its TIER-A silencing checklist; the enum panel needs the `enumeration-exclusion-log`. Both are produced by Phase-A enumeration but the seal-day pipeline never threads them to Phase-B or the panels. So even once a `--dispatch panel` exists, its calibrated instruments would run WITHOUT their required inputs (degraded, not the certified graders).
- **Panel seam still not operationalized** (AR-023) + **verdict never run through** (seam 7).

**Root cause, named:** the R-030/R-031 dispatch rebuild made each seam a blind no-tools `claude -p` that embeds ONLY the transcript (or the rater packet). That is correct for BLINDNESS but it SEVERED the calibrated data flow the design pool relied on — the enumerator's per-strategy scope + inventory (Phase-A → Phase-B) and inventory + exclusion-log (Phase-A → panels). The green law caught "a seam never ran live"; this is its sibling — "a seam ran live but on the WRONG INPUT." Both are input-faithfulness failures the mechanics-only receipts can't see.

**I OWN THIS.** AR-016/AR-022 "proven live / all seams green" proved DISPATCH MECHANICS (no-tools, strict-parse, retry, wrap) — never that each seam receives the CALIBRATED INPUT the design-pool certification used. The seam-enumeration law + tracing each seam's INPUTS (not just its execution) is what exposed it. This is the honest state: the seal-day read pipeline is not yet a faithful replica of the certified design-pool pipeline.

**Requesting R-034 (architectural — I will NOT improvise faithful re-wiring of a calibrated multi-stage pipeline on a once-only read):** the question is how to thread the enumerator's per-strategy SCOPE + INVENTORY (Phase-A consensus → Phase-B, matching the certified frontier input) and the INVENTORY + EXCLUSION-LOG (Phase-A → panels) through the BLIND no-tools dispatch WITHOUT re-opening blindness — i.e. the CLI mechanically embeds the driver-derived scope/inventory (as it now embeds the rater packet), the conductor still never reads/judges. Then: operationalize `--dispatch panel` (p1 instruments byte-unchanged, their inputs now supplied), fix the fetch plumbing (seam 1), and run the FULL rehearsal THROUGH THE VERDICT on spent 2DX — the first receipt for the FAITHFULLY-wired whole path. Then grade + re-freeze + the completed seam checklist (every row a FAITHFUL live receipt) + final pre-flight → AR-025 → the R-032 GO re-arms.

**HOLD. Seal INTACT** — sealed 12 (`4d7b3c29`) + 77 (`701c3edb`) UNTOUCHED, nothing fetched, nothing spent. Seventh catch, and the deepest: the read pipeline needs faithful re-wiring, not just the panel pipe AR-023 scoped. Better found now, at zero sealed cost, than as a corrupt verdict. Requesting R-034.

---

## AR-023 · 2026-07-17 · ★ PRE-FLIGHT HOLD (this is NOT the verdict — the read did NOT run). R-032 GO received + operator's direct "yes" received; at the final pre-flight I caught a CRITICAL never-executed seam that would have SPENT the exam with no verdict: the PANEL seam is not operationalized and has never run live. Correcting AR-022. Holding. Requesting R-033. Seal INTACT.

**I did NOT open the twelve.** R-032 ruled GO and the operator, asked directly in-session, answered "yes" — authorization complete. Before dispatching ANY sealed phase_a, I ran the pre-flight checks that don't touch the twelve. One failed, hard.

**★ THE CATCH — the read has FOUR live seams, not three; the 4th (panels) is a never-executed, non-operationalized seam.** My R-030/R-031 receipts proved Phase-A + Phase-B + rater live, but every micro-rehearsal STOPPED before panels + verdict. Verified from code:
- **No operationalized panel dispatch.** phase_a/phase_b/rater each emit a `--dispatch` command; the panel seam emits NONE (cli.py plan: only those three have `dispatch_command`; the panel shape carries only an `output_path_template`). The runbook (STEP 4/§39) says "dispatch its panel" with no mechanism — the same self-not-describing gap the rater seam had before R-031.
- **Required on the sealed path + REAL live spend.** `run_panels_and_certify_stage` raises if `live_panel_fn` is None in sealed mode (driver:1490); the sealed branch calls `live_panel_fn(cid, strategy, video_id)` — annotated "REAL cross-vendor spend seam" (driver:1357) — returning `{conflation, enumeration_consistency, completeness}` (gpt-5.4). The conductor's `_make_conductor_panel_fn` reads `panels/<cid>.json` and HALTs if missing.
- **Never run live.** The rehearsal/staging branch LOADS CACHED panels ("no live call", driver:1341-1347). So `live_panel_fn` has NEVER been exercised on seal-day format — the panel→certify→verdict path is unproven live.

**Consequence if I had opened it:** phase_a (60 draws) + phase_b would READ and SPEND the twelve sealed transcripts, certify would emit panel_requests, then the conductor would have NO command + NO proven mechanism to produce `panels/<cid>.json` → HALT → NO verdict. The once-only exam burned for nothing — the exact catastrophic half-read the whole fail-closed design exists to prevent.

**★ I OWN THIS MISS.** AR-022 claimed "all three seam classes proven live … the generalized green law is satisfied end-to-end." That was WRONG — there are FOUR seams; I omitted panels. R-032's "no never-executed seam remains in the read path" rested on that incomplete claim. The green law (R-028 §4) is NOT yet satisfied: the panel→verdict path never executed. This is a sixth trigger-time catch — fail-closed holding at the last inch, before the irreversible spend, not after.

**Proposed resolution (R-033 — I implement + independently grade + prove live on SPENT 2DX before any re-approval):**
1. **Operationalize a panel dispatch** producing `panels/<cid>.json = {conflation, enumeration_consistency, completeness}` per cid via the existing gpt-5.4 path (`h1_flex_content_panel_v32.py` content axis + `h1_conflation_check.py` conflation + the enum axis; OPENAI_API_KEY IS present in `.env`) — a `--dispatch panel` (or equivalent named command) so the blind conductor has a runbook-named mechanism, same shape as the rater seam fix.
2. **Run the FULL micro-rehearsal THROUGH THE VERDICT on spent 2DX** — the first live exercise of panels + Module-C certificate + Module-D + Module-E verdict math end-to-end (the genuine green-law receipt for the whole read path, not just the three claude seams).
3. Independent grade (doer≠grader); runbook/params addendum + re-freeze; comprehension probe.
4. Corrected green claim + re-approval, then the operator's go stands and the conductor opens the twelve.

**HOLD. Seal INTACT** — sealed 12 (`4d7b3c29`) + 77 (`701c3edb`) UNTOUCHED, token standing, no sealed transcript opened, nothing spent. The verdict AR-023 R-032 reserved will be a later AR once a real read runs; this AR-023 is the pre-flight hold that precedes it. Requesting R-033.

---

## AR-022 · 2026-07-17 · R-031 LANDED + independently graded BAND 8 + runbook re-frozen + probed. The RATER receipt is RE-EARNED LIVE — ALL THREE seam classes now proven live on spent 2DX. The read is BUILD-COMPLETE and FULLY GREEN. Holding ONLY on the operator's open-the-twelve go. Seal INTACT.

**R-031 both gaps closed (committed on `h1-wave4-sealed12-driver`):**
- **§1 — the packet carries its own `output_contract`** (`ae324c93`; `build_rater_packets` / `_rater_output_contract`): stage-scoped answer-store shape + allowed values + commitment. Values DERIVED, never retyped (§a1) — roles from the packet's own `closed_taxonomy` keys; support from `pilot_conveyor.SUPPORT_VALUES` (the exact set `support_verdict_from_stage2_response` accepts, :1382/1408). Shape+values+commitment ONLY (§a2). §3's premise ("the packet carries its instructions") is now TRUE.
- **§2 — VERIFIED then SPLIT.** Confirmed from code the single dispatch embedded BOTH `stage1_view` and `stage2_items` (read-order lock broken). Split into TWO sequential stage-scoped no-tools dispatches per rater: the Stage-1 prompt PHYSICALLY EXCLUDES `stage2_items` (`_seam_source_text` projection), so the blind role read cannot see the revealed conditions; Stage-2 embeds them; the wrap MERGES both into `raters/<id>.json`. Fresh-context Stage-2 is strictly tighter than the pilot's same-session reveal.
- **§a4 — out-of-vocabulary HALTs, never coerces** (`_wrap_rater_parsed` + `_rater_allowed_values`): an out-of-vocab role/support, or a blank Stage-2 justification, HALTs fail-closed; the allowed set is read from the EMITTED packet's own contract (single-sourced). §a5 — the pre-R-031 contaminated rater answer was QUARANTINED (never consulted).

**Independent grade (doer≠grader): BAND 8 SAFE** — all four mutations flip RED (derived-vocab, the read-order-lock split, vocab-HALT, merge-not-clobber); no CRITICAL/HIGH; two LOW findings closed same-wave (derivation test hardened with synthetic taxo keys; added a derived-contract→CLI-enforcement integration test). 323 passed / 3 skipped.

**★ RATER RECEIPT RE-EARNED LIVE** (spent 2DXQqwKSwJE, never the twelve): certify re-emitted `output_contract`-bearing packets → rater A **Stage-1 ingested 38 roles**, **Stage-2 ingested 28 support judgments**, both stage-scoped, 0 format-retries, guards passing. **★★ ALL THREE SEAM CLASSES ARE NOW PROVEN LIVE ON SPENT MATERIAL: Phase-A (5 blind draws) + Phase-B (3 strategies) + rater (both stages).** The generalized green law is satisfied end-to-end.

**Runbook RE-FROZEN (`149608a6`, Addendum B) + final comprehension probe PASSED** — a fresh clean-room reader answered the two-ordered-commands-per-rater, the Stage-1 physical exclusion of Stage-2 conditions, no-tools blindness, out-of-vocab HALT, and stop-and-report, verbatim (and caught a blank-justification doc omission, now closed). Params addendum §5/§6 records the two-dispatch structure + the R-030 §4 live-found fixes.

**★ THE SEALED-12 TERMINAL READ IS BUILD-COMPLETE, FULLY GREEN, AND EXECUTABLE END-TO-END.** Every seam graded (doer≠grader) at the 7-8 pre-live ceiling, every seam class proven LIVE on spent material, runbook re-frozen + comprehension-proven, five trigger-time catches across R-030/R-031 with zero corruption and zero sealed spend. **I am holding ONLY on the operator's explicit go to open the twelve** — the irreversible multi-hour live read is his ignition, not mine; the standing `SEAL-GO.token` authorizes it but I will not initiate the once-only read without his word at this final boundary. Sealed 12 (`4d7b3c29`) + 77 (`701c3edb`) UNTOUCHED; no sealed transcript opened.

---

## AR-021 · 2026-07-17 · R-030 §1–§6 LANDED + independently graded BAND 8 + runbook re-frozen + probed; live micro-rehearsal on SPENT 2DX earned the phase_a/phase_b receipts AND caught 2 real seal-day bugs (fixed) — but surfaced ONE load-bearing gap that BLOCKS the read: the emitted rater packet is NOT self-describing. Requesting R-031. Seal INTACT.

**R-030 built, graded, frozen (commits on `h1-wave4-sealed12-driver`):**
- §1 `59535e05` — R-028 plan machinery + F-1 strict parser + R-029 exact bar.
- §2/§3 `f4a06cce` — the CLI now OWNS each dispatch: `claude -p --tools ""` (PHYSICAL no-tools — live-verified `NOTOOLS_CONFIRMED` on a planted secret) with the transcript / rater-packet CONTENT embedded; mechanical format-retry (RawJsonNonCompliant only, cap 2, quarantine, run-total reported never gating); prompt via STDIN (variadic `--tools` would eat a positional prompt). **Independent grade (doer≠grader): BAND 8 SAFE — all 4 mutations flip RED, no silent-accept, no fabricated tests, rehearsal byte-identical.**
- §5 forensic → scope line recorded (design-pool held the Write tool; seal-day strictly tighter; certification stands, direction-safe). Params-record addendum `h1-dispatch-wrapper-params-addendum-2026-07-17.md`.
- §6 runbook RE-FROZEN `591c58a0` (Addendum A) + **final comprehension probe PASSED** (a fresh clean-room reader answered the full R-030 dispatch model verbatim).
- §4 `2a1bfb98` — the live micro-rehearsal (spent 2DXQqwKSwJE, never the twelve) caught **two real seal-day bugs the stubbed tests could never surface**, both fixed + tested: (1) `claude -p` refuses to launch nested in a Claude Code session → `_run_claude_p` unsets `CLAUDECODE`; (2) `run_dispatch` never wrote `dispatch_record.json` (the identity guards require it) → the CLI now fills it per §3.

**★ RECEIPTS EARNED (live, no-tools, spent 2DX):** plan (offline reuse) → **5 blind Phase-A draws (each 3 strategies, identity matches frozen, 0 retries)** → driver consensus → **3 Phase-B strategies (frontier prompt, 0 retries)** → certify emitted **3 REAL rater packets**. The whole extraction spine ran live end-to-end with ZERO format-retries — the format wrapper elicits clean JSON first-pass on real material.

**★ THE GAP THAT BLOCKS THE READ — the emitted rater packet is NOT self-describing (R-030 §3's premise was inaccurate).** §3 said "raters embed the driver-emitted packet content the same way — the packet carries its own `instructions`." It does NOT: `build_rater_packets` emits packets with keys `{cid, control_item_ids, stage1_view, stage2_items, strategy_index, target_item_ids, video_id}` and **no output-contract / instructions field.** So the no-tools rater, given the bare packet + the FORMAT-only wrapper, has no way to know the required answer-store SHAPE. Live result: the rater correctly UNDERSTOOD the task (it assigned `gate-strength` / `context` roles sensibly per item) but emitted the wrong CONTAINER — `{stage: "certify", packets: [{cid, stage1_adjudications: [{item_id, role, notes}]}]}` — instead of the flat `{stage1: {item_id: role}, stage2: {item_id: {support, support_justification}}}` the driver's `_make_conductor_rater_fn` ingests → the strict rater-wrap HALTed fail-closed (correct — no fabrication). Pre-R-030 this framing lived in the runbook prose that a REASONING conductor applied; now the conductor is blind and the CLI embeds only the bare packet, so that framing was lost.

**Proposed resolution (R-031 — I implement + independently grade on SPENT 2DX before the read):** make the packet genuinely self-describing, as §3 assumed — extend `build_rater_packets` (Module D) to emit an explicit `output_contract` per packet: the flat `{stage1, stage2}` answer-store shape + the allowed role values (`gate-strength|context|cannot-determine`) + support values (`confirmed|partial|denied`) + the read-order note (commit Stage-1 roles before Stage-2 support — already structurally enforced by `stage1_view` hiding Stage-2). The CLI embeds it with the packet; the no-tools rater then produces the ingestible shape. **This touches a graded Module-D instrument + the rating protocol on a once-only read, so I hold for your ruling on (a) packet-carries-its-contract [my lean — makes §3's premise TRUE] vs (b) a rater-specific CLI dispatch wrapper carrying the contract.** Either way it re-earns the rater receipt live before the twelve open.

**HOLD: I am NOT opening the twelve.** The rater seam must produce ingestible answers for the verdict to compute — the read is NOT fully green until R-031 lands + the rater receipt is re-earned. Phase_a/phase_b receipts stand; the rater receipt is BLOCKED. Seal INTACT — sealed 12 (`4d7b3c29`) + 77 (`701c3edb`) UNTOUCHED, token standing, no sealed transcript opened. On R-031: fix → independent grade → re-earn the rater receipt on spent 2DX → then the conductor opens the twelve (on the operator's go).

---

## AR-020 · 2026-07-17 · The CRITICAL silent-mis-parse (F-1) is FIXED. But the live micro-rehearsal (R-028.2, first genuine execution) surfaced TWO things that gate the sealed read — one a POLICY question, one a possible BLINDNESS/LEAK. Requesting R-030. Seal INTACT.

**R-028 built + the live micro-rehearsal RAN — the first real `claude -p` execution (not cached).** Plan-stage + wrap-stage + source-attrition are in; a real extraction ran on ONE SPENT design-pool transcript (`2DXQqwKSwJE`, never the twelve). It proved 3 seams live AND caught a CRITICAL the cached rehearsals could never surface:

**F-1 (CRITICAL, grader-found, now FIXED — staged, uncommitted):** the raw→draw ingestion (`_load_raw_json`) silently accepted a schema-EXAMPLE embedded in a model's prose as if it were the answer (mis-slice). Rebuilt strict + fail-closed: strip an optional ```json fence, then `json.JSONDecoder().raw_decode()` requiring the JSON to BEGIN the output (nothing but whitespace/fence before) and only whitespace after — any preamble/trailing prose/ambiguous double-object → new `RawJsonNonCompliant` HALT, no artifact written, no auto-retry. The two mis-parse cases now HALT (were silent-accept); 135 tests green; rehearsal path byte-unchanged; no hardcoded literals. Also tightened R-029 to the exact unrounded bar (`clean/readable_N >= 0.60`, 5/9 boundary test added = MISS). **This closes the last silent-wrong-answer path in ingestion.**

**★ But the same live run raised two matters I will NOT improvise past on a once-only read:**

**(1) POLICY — Phase-B reliably preambles → the strict parser over-HALTs.** With the strengthened prompt, Phase-A produced clean JSON that strict-parsed + round-tripped. **Phase-B did not:** despite the same firm "print ONLY the JSON" instruction, the frontier extraction emitted a prose preamble ("I have the transcript and the exact output schema… I'll produce a fresh… extraction") → the strict parser correctly HALTed fail-closed, no artifact. So strict-parse-only will stall on Phase-B in practice. I deliberately did NOT add an auto-retry in code — retry under a read-once discipline is your call. Options for your ruling: (a) a firmer/structured Phase-B prompt; (b) a BOUNDED re-dispatch on a NON-COMPLIANT raw only — since a non-compliant raw produced NO valid artifact, re-running arguably COMPLETES the dispatch rather than re-reading (the read-once unit is "a draw was ingested," and none was); (c) accept HALT-and-escalate as the terminal behavior (conductor reports NON-COMPLIANT, you adjudicate). My lean: (b) with a hard cap (e.g. 2) + every attempt logged, because it preserves fail-closed while not surrendering the read to model-formatting noise — but this is squarely your read-once law, so I hold.

**(2) ★ POSSIBLE BLINDNESS/LEAK — the extraction subagent can read BEYOND the transcript.** The emitted `claude -p` command (`_claude_p_template`, CLI :832) is `--allowedTools Read` **UNRESTRICTED** — Read is not scoped to the named transcript path; the subagent may read ANY file. The live Phase-B preamble is the tell: it CLAIMED it consulted "the pipeline's own cached artifacts for this video (both enumerated scopes resolved to `mean_reversion_scalp`…)" and pre-resolved `instrument_classification`. For a SPENT video the cached staging_v32 answer EXISTS on disk — a subagent that reads it is parroting the cache, not doing a fresh blind read, which would hollow out k=5 independence AND the fidelity measurement. On the sealed twelve there is no cache, but unrestricted Read still lets a subagent reach the manifest / other videos' data / campaign docs — a latent leak surface on the once-only read. **This must be closed before the twelve open.** Proposed fix (requesting your ruling on which — both touch the blindness law, one touches the runbook): **(i)** the CLI embeds the transcript CONTENT into the `claude -p` prompt (mechanical, conductor still never opens it) + emit with NO Read tool at all → the subagent physically cannot touch the filesystem = pure blindness (amends the runbook's transcript-by-PATH to transcript-by-embedded-content); or **(ii)** keep transcript-by-path but scope Read to ONLY that file (sandboxed work-dir / path-scoped allow-list) so the subagent can open the transcript and nothing else. I lean (i) — "can't read anything but what we hand it" is a stronger blindness guarantee than "asked to read only X" — but it changes the frozen runbook, so I hold for your word.

**Both gate whether the live read can run CORRECTLY, so I am NOT committing F-1 or touching the runbook/seal until R-030.** F-1 fix is staged + verified; the seal is INTACT (spent video only — sealed 12 `4d7b3c29` + 77 `701c3edb` UNTOUCHED, token standing, no sealed transcript opened). On R-030: fold the retry/blindness ruling into the dispatch template → re-grade (doer≠grader) → runbook operational addendum + re-freeze → final probe → the conductor opens the twelve.

---

## AR-019 · 2026-07-17 · R-027 GO acknowledged, `claude -p` pre-flight PASSES — but at the spawn boundary the runbook does NOT operationalize a LIVE dispatch for a blind conductor. Seal INTACT. Requesting R-028 (operational layer + a live micro-rehearsal).

**Pre-flight PASS:** `claude` CLI present (2.1.212); trivial headless `claude -p` returns cleanly. The dispatch runtime works.

**★ THE GAP (found reading the runbook against R-027 pin 1 — "runbook and NOTHING else" — before spawning):** the runbook operationalizes the SEQUENCE (staged loop) + the DISCIPLINE (5 blind draws, transcript-by-path, HALT/read-once) — and the comprehension probes proved a fresh reader UNDERSTANDS that. It does NOT operationalize a single LIVE DISPATCH: (a) the sealed manifest is IDs-only — the transcripts must be FETCHED live at read-time, and the runbook doesn't say how; (b) the exact frozen prompt FILE path per dispatch (Phase-A dispatch happens BEFORE stage phase_a, so the CLI names nothing for it); (c) the precise `claude -p` invocation; (d) the output→draw-JSON SCHEMA (`{count, strategy_refs, reader_identity, dispatch_record}`) the CLI ingests. A blind conductor (runbook only) cannot PRODUCE `draw_0.json` — it stalls at "how." And per your own R-023.1c law, **no one has ever EXECUTED a live dispatch** — every rehearsal was cached; the probes tested comprehension, not execution.

**Proposed resolution (R-028 — I implement + independently grade, staged on SPENT videos, before the twelve open):**
1. **A CLI `plan` stage (stage-0):** verifies the manifest, FETCHES/names the transcripts, and EMITS the complete per-dispatch instruction set for EVERY seam (Phase-A draws included): exact prompt path + transcript path + output path + expected JSON schema — reducing the conductor to running NAMED commands. This keeps the conductor a pure process executor and makes "the runbook" (+ the CLI's emitted plan) genuinely sufficient for a blind agent.
2. **A LIVE micro-rehearsal:** one REAL `claude -p` extraction on ONE SPENT design-pool transcript → verify it produces a draw the CLI actually ingests (schema round-trips, identity/dispatch guards pass). This is the first genuine execution of a live dispatch — proving the mechanics, not just the comprehension. Small subscription cost, spent video, NOT the twelve.
3. Runbook operational addendum (dated) pointing at the CLI-emitted plan; re-freeze; a final execution-comprehension probe.

**Seal INTACT — no transcript opened, token standing.** This is the fail-closed design holding at the last inch: the blind-conductor requirement (pin 1) collided with an unoperationalized live layer, caught BEFORE the spawn. Holding for R-028; on it: build → grade → live micro-rehearsal → the conductor opens the twelve.

---

## AR-018 · 2026-07-17 · Staged read + rater/panel sweep LANDED+graded (`e0e5dccc`); runbook re-amended+re-probed+RE-FROZEN (`2ec82f48`). The read is BUILD-COMPLETE. One execution-approach confirm before I open the twelve — R-027.

**R-026 closed:** staged (emit-and-stop) sealed read + the rater/panel seam sweep — independent grade **Band 7 SAFE** (2 independent paths + 2 mutation kills): the AR-017 gap is closed at the real `main()` entry (single-shot can't HALT mid-read); the non-pre-arranged-count is genuinely non-vacuous (grader reproduced with its own values — the count is CARRIED through emit→fulfil→resume, not hard-coded); rater/panel seam really swept (leak-scan traced into the HALT; wrong-packet HALT); read-once pinned (byte-identical re-emit + Phase-A/Phase-B hash-mismatch HALTs + reverify MATCH); rehearsal byte-unchanged (206+/0-). Token-assert fixed for the operator's real token (unchanged-since-import, stronger). Runbook STEP 1 re-amended to the staged loop, **comprehension re-probed** (a fresh reader answered the full staged sequence + "the driver computes the consensus, you only read its emit" + HALT/read-once, verbatim), **RE-FROZEN** `2ec82f48`.

**★ THE SEALED-12 READ IS BUILD-COMPLETE, GREEN, AND EXECUTABLE END-TO-END.** Fix + grade + re-frozen runbook = your R-026.5 precondition for the read to run. The standing operator token (`SEAL-GO.token`, his hand) authorizes it.

**One execution-approach confirm before the irreversible seal-break (R-027):** initiating the read OPENS the twelve (the extraction subagents read the sealed transcripts) and is a multi-hour LIVE operation — ~60 Phase-A draws (12×5) + Phase-B per consensus strategy + 12×panels (gpt-5.4, real API $) + two blind raters per packet, across three CLI stages. The runbook's dispatch mechanism is "Claude Code dispatch, interactive or **headless `claude -p`** (same subscription runtime)". Proposed execution: I spawn a **fresh clean-room conductor** (blind, receives ONLY the re-frozen runbook) that fulfils each dispatch by shelling out to `claude -p` (headless subscription) + runs the `--stage` CLI invocations + reports the verdict. Confirm that's the intended executor (vs. a different mechanism), and that I proceed with the live seal-break run now. I hold ONLY on this execution-approach confirmation — not on any new gate; everything is graded + frozen. On your go: the conductor runs, verdict verbatim, both outcomes honest.

Sealed 12 (`4d7b3c29`) + 77 (`701c3edb`) UNTOUCHED; token standing; no transcript opened. Holding for R-027.

---

## AR-017 · 2026-07-17 · ★ TOKEN CREATED by the operator's hand — but at execution I found a LIVE Phase-A→consensus→Phase-B SEQUENCING GAP the cached rehearsal masked. Read PAUSED, nothing corrupted. Requesting R-026.

**Gate satisfied:** `docs/designs/SEAL-GO.token` exists, non-empty, created by the OPERATOR'S OWN HAND (his PowerShell, not the agent — R-025 honored), content = the ratified words. Verified on disk. Authorization stands.

**★ THE GAP (found by reading the live path at the trigger, before dispatching):** the sealed extraction INTERLEAVES and the driver drives the order — `_collect_phase_a_draws` (5 per-draw dispatches) → the driver computes the modal consensus ITSELF (`_consensus_strategy_refs`: the modal draw's `strategy_refs`) → `_dispatch_phase_b` ONE per consensus strategy. But the CLI fulfills each `live_phase_b_fn(video_id, strategy_ref, idx)` by READING a PRE-WRITTEN `phase_b/<vid>__s<idx>.json`. **A blind conductor cannot pre-write the Phase-B files without already knowing the consensus** — which only exists AFTER the Phase-A draws + the driver's computation — and the FROZEN runbook explicitly tells the conductor "the driver combines the five draws" (i.e. do NOT compute it). So a blind conductor dispatches the 5 draws, then has no runbook-sanctioned way to know how many Phase-B dispatches to make → the single-shot CLI HALTs `ConductorArtifactMissing` on the first Phase-B read. Fail-closed (no corruption), but the read cannot COMPLETE end-to-end.

**Why the rehearsal/probe missed it:** staging is fully cached (no live dispatch); the CLI sealed tests used a pre-known fake work-dir where the consensus count was hard-coded to match. The runbook rehearsal proved the staging SPINE + the comprehension of the amended dispatch UNIT, but neither exercised the live Phase-A→consensus→Phase-B ORDERING. Honest scope correction to AR-015/AR-016: "green" covered the driver + guards + verdict math + the staging-executable spine; the LIVE seal-day dispatch harness has this one unproven seam, now surfaced.

**Proposed resolutions (your R-026 — I'll implement + independently grade before the read runs):**
- **(A) Two-phase CLI, preferred:** `--mode sealed` runs Phase-A (ingests the 5 pre-written draws per video), computes + EMITS the per-video consensus `strategy_refs` the conductor must fulfill, and STOPS; the conductor dispatches Phase-B per emitted ref + writes; a second CLI invocation resumes from the persisted Phase-A + the now-present Phase-B → C→D→E → verdict. Read-once preserved (each dispatch fired once; CLI ingestion is deterministic replay). Runbook STEP 2 amended to the two-phase sequence.
- **(B)** the conductor mechanically reads the driver-emitted consensus (same as A's emit step) — functionally A.

Token + authorization PERSIST (they do not expire); the sealed 12 (`4d7b3c29`) + 77 (`701c3edb`) are UNTOUCHED; the read has NOT started. Holding for R-026, then: fix → independent grade → conductor runs the once-only read → verdict verbatim.

---

## AR-016 · 2026-07-17 · ★★ GREEN IS TRUE. R-024 closed: per-draw fix landed+graded, runbook comprehension-probed + FROZEN. One-line sent to the operator.

**R-024.1 driver fix — DONE, Band 7 SAFE, committed `ef15a9db`.** The sealed extraction seam now dispatches PER-DRAW: 5 independent blind Phase-A draws per video (proven: 5N calls, draw_index 0..4, old per-video seam removed), the driver computes the k=5 consensus + stability itself, mode_n<4 → one adjudication dispatch, Phase-B one per consensus strategy; per-dispatch identity assertion (wrong model on ANY draw → HALT, never averaged). Grader: zero discrepancies, both safety mutations RED, and the rehearsal/staging path proven BYTE-IDENTICAL (independent stash/diff) — no prior grade regressed. Runbook amendments 1-3 folded in.

**R-024 comprehension probe — PASSED.** A fresh reader, on the amended sealed steps alone, answered verbatim: "FIVE Phase-A subagents; each gets the frozen prompt + a transcript PATH (never contents); Phase-B ONE per strategy; NEVER combine." Nothing missing. Per your R-024 closure, that FREEZES the runbook (`154eea2e`, status FROZEN).

**★★ THE SEALED-12 TERMINAL-READ DRIVER IS GREEN.** All units + the per-draw fix + the CLI + the FROZEN, rehearsed, comprehension-proven runbook — every piece independently graded (doer≠grader) at the 7-8 pre-live ceiling and committed. The executor exists, is proven a fresh reader can run it, and cannot touch the sealed set without the operator's `SEAL-GO.token`.

**Per R-024, the one-line has gone to the operator** (verbatim as you accepted in AR-015 — the token-creation template with the words HIS alone). The machine now STOPS. Sealed 12 (`4d7b3c29`) + 77 (`701c3edb`) PRISTINE; no token exists; his key is the only ignition. Nothing further runs until he writes it.

---

## AR-015 · 2026-07-17 · Conductor runbook + CLI LANDED (`2aed45d0`); ★ RUNBOOK REHEARSAL PASSED (blind, zero hints). Requesting R-024 ratification → then GREEN + the one-line.

**R-023.1a/b artifacts committed `2aed45d0`:** the conductor runbook (`docs/designs/h1-sealed12-conductor-runbook-2026-07-17.md`, DRAFT pending your R-024) + the thin CLI (`scripts/h1_seal_conductor_cli.py`, independent grade Band 7 SAFE — staging prints the verbatim verdict; sealed HALTs without `SEAL-GO.token`, rejects spent-16, HALTs on wrong-model dispatch; physically cannot create the token; grader's false-green spent-16 test fixed + mutation-proven same-wave).

**★ R-023.1c RUNBOOK REHEARSAL — PASSED.** A genuinely clean-room conductor (fresh subagent, handed ONLY the runbook, no campaign context, no hints) ran it in STAGING. Result: executed start to finish on the FIRST invocation; **ZERO points** where it guessed, improvised, or needed information the runbook didn't give; ran exactly one command (STEP-1 staging) and reported the verdict VERBATIM (FIDELITY_PASS, video-unit 3/3, both witnesses REJECTED on their correct axis, rehearsal_pass True); correctly took the staging carve-out (skipped STEP 0); never created a token; never opened a transcript/answer-key/history. Your own bar — "a runbook no fresh reader has executed is a claim" — is met: a fresh reader executed it cleanly.
- **Honest scope note:** the rehearsal is STAGING (per R-023.1c). The runbook's SEALED-mode STEP 2/3 (dispatch live subscription extraction subagents + two blind raters) are DESCRIBED but only EXECUTED on real seal day — not rehearsable without real subscription spend on the exam itself. The process discipline (blindness, HALT-and-report, read-once, verbatim-reporting) IS rehearsed; the live dispatch is exercised for real only under your go-token.

**Requesting R-024:** ratify the runbook (read from disk per your discipline). **On ratification, GREEN is TRUE** and I send the operator the one-line per R-023.1d. Drafted for your review (the mechanics are mine; the WORDS in the token are HIS alone — neither of us authors them):
> "Everything's green. The reader for the twelve is built, graded, and rehearsed; it will not touch the sealed set without your go-token. To authorize the once-only read, create the token IN YOUR OWN WORDS:
> `Set-Content -Path C:\Users\tonio\Projects\wt-h1-wave4-20260712\docs\designs\SEAL-GO.token -Value "<your own words authorizing the read of the twelve>"`
> Nothing runs until that file exists. Say go by writing it."

Sealed 12 (`4d7b3c29`) + 77 (`701c3edb`) PRISTINE; no token exists. Holding for R-024.

---

## AR-014 · 2026-07-17 · ★ THE DRIVER IS GREEN — all 9 units graded + committed, full-dress rehearsal PASSES. One question before the one-line: what executes on "go".

**Module F (full-dress rehearsal capstone, items 7/10/11): Band 7 SAFE, committed `d8c44f98`.** Drives the COMPLETE real A→E driver on the 3 spent videos; every stage genuinely exercised (receipt derived from real module markers — the vacuous-receipt gap the grader found is closed + mutation-proven same-wave). Both witnesses BOTH axes through the FULL pipeline (IyF→enum FAIL→REJECTED via full A→E; R5L890-FUSED→conflation REJECT via C→D→E) reach the verdict not-clean. Mixed-video rollup end-to-end. Deterministic re-verify (byte-identical across two processes). Drift guard both polarities (SHAs read from frozen files). No live call (spies fail-loud). Rehearsal verdict FIDELITY_PASS, validity valid.

**★ THE SEALED-12 DRIVER IS GREEN.** All 9 units built · independently graded (doer≠grader) at the 7-8 pre-live ceiling · committed · scope-locked · frozen instruments untouched:
A seal-gate (8, `935e85b7`) · B extraction (7, `94734243`) · identity-guard (7, `154691f6`) · channel-guard (7, `d3309eba`) · C panels+cert (7, `75dd73a0`) · leak-scan-rebuild (7, `df787008`) · D rater-layer (7, `8a0fff65`) · E verdict-math (7, `673b796b`) · F rehearsal (7, `d8c44f98`). R-017 pin-1 (adversarial leak-scan) + pin-2 (both witnesses/axes/rollup) both satisfied.

**Two honest items before I send the operator "Everything's green. Say go.":**
1. **What executes on "go" (your call, R-023):** per R-020.3 Option A, the seal-day read is run by a **fresh clean-room conductor** dispatching subscription-channel Claude subagents through this built+guarded driver (Module B's injected seam; identity/channel/dispatch-record guards armed; Module A refuses the sealed manifest without the operator's `SEAL-GO.token`). The driver is READY. Open: does F-green = the one-line (the conductor + live dispatch are spawned/wired at go-time following the driver runbook), OR is the **conductor runbook** (item-5 "receives ONLY the driver runbook") a remaining PRE-GO artifact I should author + you ratify first? I will NOT declare a premature "say go" if the go-time executor isn't ready. Name it.
2. **Economics seal-day note (ADDENDUM 7 / §2):** the rehearsal economics mean is 18.0 > the ~15 ceiling (design-pool videos: 2DX=26, DLwVqc=14, R5L890=14) — RECORDED, correctly NON-gating (economics ≠ fidelity). If the sealed 12 also exceed ~15 mean tier-3 adjudications, that is a SEPARATE affordability finding (the human-in-loop fork is costly), NOT a fidelity fail — surfaced now so it's not a surprise at read time.

Sealed 12 (`4d7b3c29`) + 77 (`701c3edb`) PRISTINE; no `SEAL-GO.token` exists. Holding for R-023.

---

## AR-013 · 2026-07-17 · R-022 leak-scan rebuild LANDED (`df787008`) + Module D re-graded SAFE, LANDED (`8a0fff65`) — 7 units down, E/F remain. + a ruff disclosure.

**Leak-scan rebuild (R-022.1/2): committed `df787008`, Band 7 SAFE.** Two-layer (keys everywhere / words spec-side word-boundary, "dri" eliminated) + cross-item check (full-string, quote-excluded). Both polarities verified on REAL 2DX packets. Pilot historiography addendum appended (R-022.4); 0/16 stands as-measured. R-022.3 paraphrase layer OUT (adversarial-only; revisit-trigger recorded).

**Module D (item 5) RE-GRADED SAFE Band 7, committed `8a0fff65`.** With the fixed scan: false-positive gone (7/7 rehearsal flow), Bypass-1 cross-item now HALTs (no rater, no certificate), Bypass-2 confirmed out-of-scope per R-022.3. All own properties intact (read-order lock, control-gate ≥4/5, rater independence/blindness, support-downgrade, compose-order A→B→C→D). Frozen instruments untouched.

**★ R-017 pin-1 verdict, stated for the record:** the adversarial leak-scan mandate found a measurement-corrupting FALSE-POSITIVE in a frozen safeguard (the "drift" HALT) AND two false-negatives — before the once-only read. It paid for itself, as you noted.

**DISCLOSURE (self-caught, honest — not hidden):** the `df787008` commit carries an INCIDENTAL whole-file annotation modernization in `pilot_conveyor.py` (`List[`→`list[`, `Dict/Tuple/Optional`, unused-typing-import removal, one `.encode("utf-8")`→`.encode()`) — 95 ruff edits reaching frozen functions (`finalize_certificate`, `aggregate`, `prepare_strategy`, `_build_tier3_packet`), from my running `ruff --fix --unsafe-fixes` instead of safe-only. **Verified 100% runtime-inert line-by-line + 153 tests green** (annotations don't execute; utf-8 is encode's default) — the graded leak-scan LOGIC is unchanged. Lesson recorded (use safe `ruff --fix` on instrument files). Flagging so a future diff of `df787008` touching `finalize_certificate` reads as benign modernization, not a semantic frozen-instrument change. If you want it reverted to a pure leak-scan-only diff, say so; I judged the inert noise lower-risk than 95-spot surgery on a frozen file.

**Progress: A(8)·B(7)·identity-guard(7)·channel-guard(7)·C(7)·leak-scan-rebuild(7)·D(7) LANDED. Remaining: E (verdict math — cert→video rollup + ≥60% + economics rider + validity block, R-022 content-boundary standing) · F (full-dress rehearsal — R-017 pin-2: both witnesses both axes + rollup-on-mixed-video). On F's grade: GREEN → stop → one-line to operator.** Proceeding to E.

---

## AR-012 · 2026-07-17 · Module D graded NOT-SAFE Band 5 — adversarial leak-scan (R-017 pin 1) found 2 bypasses in the FROZEN scan; with a design-intent nuance for your ruling

**Module D grade: NOT-SAFE Band 5.** Everything downstream VERIFIED — two-stage read-order lock, control-gate (≥4/5 both directions, mirrors frozen conductor), rater independence + reader-blindness, denied/partial support downgrade end-to-end, compose-order, ZERO frozen-instrument modification, 2/2 mutation kills, 145 regression passed. The blocker is solely the R-017 pin-1 adversarial leak-scan: 2 of 5 constructed leaks reach a live rater. Module D uses `blinding_leak_scan` faithfully (direct import, no reimplementation, no weakening — verified) and adds no supplementary check, so both bypasses are in the FROZEN `pilot_conveyor.blinding_leak_scan`.

**Bypass 1 — cross-item Stage-2 leak (check 3, `pilot_conveyor.py:702-710`).** Grader planted item X's `extracted_condition_text` into a DIFFERENT item Y's Stage-1-visible field → scan clean=True → dispatched. Root cause: check 3 is SAME-ITEM-scoped (`_item_json_excluding_quote`, `items_by_id.get(item_id)`). **NUANCE (your call):** that scoping is DELIBERATE — the frozen docstring argues "two DIFFERENT conditions can coincidentally share a transcript phrase... without either item's blinding being compromised — a blind rater never sees which item_ids share an extractor-side association." So a cross-item appearance may be PERMITTED by design, not a real blinding compromise. Open Q: is a cross-item planted paraphrase a real leak, or acceptable per the stated rationale? Making check 3 all-item would RE-INTRODUCE exactly the false-positives the same-item scoping was built to avoid.

**Bypass 2 — paraphrase bypass (check 2, `pilot_conveyor.py:676-679`).** Grader planted "the correct role and gold label for grading" (synonyms of denylisted `correct_role`/`gold_label`) → exact-substring denylist missed it → dispatched. **NUANCE:** this requires free prose the production `_build_tier3_packet` never emits (the builder writes structured fields, not answer-key sentences). Open Q: real threat, or adversarial-only artifact (the scan defends against BUILDER bugs, and there is no adversary crafting our own packets)?

**Combined with AR-011 (the "dri" FALSE-POSITIVE, clearly real — over-blocks "drift"), the frozen leak-scan now has a full picture: it OVER-blocks legitimate trader words AND (per the strict pin) UNDER-blocks 2 constructed shapes.** The false-positive is unambiguously real (demonstrated on real quotes). The 2 false-negatives carry the design-intent nuance above.

**Requesting R-022 — rule on:** (1) the "dri"/quote-scan false-positive (AR-011) — I recommend excluding `quote_anchor.verbatim` from check 2, matching check 3's frozen rationale; (2) whether the 2 constructed false-negatives are REAL threats requiring a fix (frozen-scan change vs a Module-D-dispatch supplementary check — all-item cross-compare + normalized tokens) or adversarial artifacts the frozen design already accounts for. **HOLDING:** Module D stays NOT-SAFE + uncommitted; no edit to the frozen scan until your ruling. This blocks E/F. Everything else in Module D is solid and ready to re-grade the moment the leak-defense question is settled.

---

## AR-011 · 2026-07-17 · ★ FROZEN LEAK-SCAN FALSE-POSITIVE (measurement-corrupting on the once-only read) — surfaced by Module D, needs your ruling

**Finding (confirmed by execution):** `pilot_conveyor.blinding_leak_scan` check 2 (the LEXICAL check, `pilot_conveyor.py:677`) serializes the WHOLE packet `sections` — **including the trader's `quote_anchor.verbatim`** — and substring-matches `_FORBIDDEN_TOKENS` (`:601`). The token `"dri"` (`:603`, a 3-char fragment) fires on real trader words: 2DX quotes contain **"Weak breakouts drift through a level"** and **"the stock drifted lower"** → `forbidden_token:dri` → fail-closed HALT. On the 3 spent rehearsal videos this HALTs **2/7 strategies** (`2DXQqwKSwJE__s1/s2`) — NOT a leak, a false positive on legitimate vocabulary.

**Systemic, not just "dri":** check 3 (the Stage-2 leak check) DELIBERATELY excludes the quote (`_item_json_excluding_quote`) with the frozen rationale *"a well-grounded anchor's quote is FREQUENTLY byte-for-byte identical to the condition it grounds — the anchor doing its job, not a leak."* **The exact same rationale applies to check 2**, which does NOT exclude the quote. Other tokens in the list are common-English too — `"verdict"`, `"outcome"`, `"tally"`, `"rationale"` — any of which a trader can naturally say, and any of which would HALT a legitimate condition on the twelve.

**Consequence (why load-bearing):** on the ONCE-ONLY seal-day read, this HALTs legitimate conditions → deflates `terminal_read_clean_fraction` → the ≥60% bar can FAIL for a SCAN FALSE-POSITIVE, not a fidelity miss. Measurement-corrupting on the irreversible read. (May also partly explain the sealed pilot's 0/16 — though the pilot is sealed and not re-run; flag for awareness only.)

**Question of intent:** is check-2-scans-the-quote intended (max-conservative fail-closed) or a defect? `"dri"` as a 3-char fragment looks unintended (every other token is a distinctive spec-side term/key). Either way the empirical effect corrupts the read.

**Recommendation (your ruling — frozen-safeguard change, I implement under independent grade):** exclude `quote_anchor.verbatim` from check 2's lexical scan (mirror check 3's frozen rationale) — still catches SPEC-SIDE leaks (our labels/keys/answer-key vocabulary), stops firing on the trader's own words. Do NOT weaken spec-side leak detection. Alternative: audit `_FORBIDDEN_TOKENS` for over-broad fragments. This blocks Module F (the ≥60% rehearsal would be deflated by the false-positives); it does NOT block Module D's grade (Module D uses the frozen scan faithfully and handles the HALT gracefully — the bug is in the scan, not the module). Holding on any edit to the frozen scan for your ruling (R-022).

---

## AR-010 · 2026-07-16 · Channel-class guard DONE (Band 7, `d3309eba`) — identity FULLY LOCKED; params record FROZEN; starting Module D

**Channel-class + dispatch-record guard (R-020.3/R-021.2): DONE, Band 7 SAFE, committed `d3309eba`.** `assert_dispatch_identity` makes the DISPATCH record authoritative (requested + resolved model + channel-class), self-report corroboration-only; HALTs on `api` channel, wrong requested/resolved model, unknown dispatch_mode, or a self-report that contradicts the dispatch. Sealed mode requires a dispatch_record (missing→HALT). 3/3 mutation kills, no bypass path, no hardcoded literals. Grader residual (non-blocking): no seal-day conductor yet injects a real dispatch_record — that's Modules D/E/F + the seal-day CLI. Params record DRAFT→FROZEN (R-021.1); completeness boundary stated in packet (R-021.3).

**IDENTITY IS NOW FULLY LOCKED:** model + Phase-A/B prompt SHAs + k + channel-class, all asserted from the frozen record / dispatch record at runtime, nothing hardcoded. Five units landed & graded: A (Band 8) · B (Band 7) · identity-guard (Band 7) · channel-class-guard (Band 7) · C (Band 7).

**Starting Module D (human-blind two-stage rater layer) on fresh context, R-017 pin-1 adversarial leak-scan mandate standing.** Reuses the pilot's frozen rater instruments read-only (`pilot_conveyor.blinding_leak_scan`, `_build_tier3_packet`, `verdict_from_rater_response`, `support_verdict_from_stage2_response`, control section) — orchestrates, does not reinvent. Then E (verdict math) and F (rehearsal). Token waits on F's green.

---

## AR-009 · 2026-07-16 · Module C graded Band 7 SAFE + committed `75dd73a0`; 4 of 6 modules landed

Module C (mechanical floor + panels + certificate) independent grade: **Band 7 SAFE.** Reproduces the committed `run_dress_rehearsal` path exactly (7/7 CLEAN, IyF→enum REJECT, R5L890-FUSED→conflation REJECT), all 6 per-axis fail-closed combinations verified by independent execution, 2/2 mutation kills, no frozen instrument touched. **Completeness-recorded-not-gated confirmed FAITHFUL to the frozen bar** (pilot §1 certificate-grade is structural; the fence has no content axis; content is the design-pool reader-cert axis, recorded on the twelve) — grader rendered this as a first-class judgment, not a silent gate-drop. Committed scope-locked (2 driver files + the params-record draft; unrelated worktree drift kept out, B905 lint cleared same-wave).

**Progress: A (Band 8, `935e85b7`) + B (Band 7, `94734243`) + identity guard (Band 7, `154691f6`) + C (Band 7, `75dd73a0`) LANDED & graded. Remaining: D · E · F.**

**Pending on you:** R-021 ratification of the drafted effective-params record (`h1-certified-reader-effective-params-2026-07-16.md`) — after which I add the channel-class guard extension (R-020.3). **Next build:** Module D (human-blind two-stage rater layer + your R-017 pin-1 adversarial leak-scan) — the highest-scrutiny module; taking it on fresh context per the checkpoint discipline you approved. Then E (verdict math: cert→video rollup + ≥60% + economics + validity block) and F (full-dress rehearsal, R-017 pin-2). Token still waits on F's green.

---

## AR-008 · 2026-07-16 · R-020 executed: effective-params record DRAFTED for ratification; actor correction on record; channel-class guard follow-on flagged

**R-020.1 actor correction — accepted, on the record.** AR-007 said "operator hand-writing outputs" — that phrasing is WRONG. The true actor: **fresh-context Claude subagents on the subscription channel** (Claude Code dispatch; the extractor subagents wrote their own artifacts byte-exact). The operator extracted nothing. Corrected in the drafted record (§0) and in memory; AR-007 stands as audit trail with this correction noted here (corrections visible, never silent).

**R-020.2 params record — DRAFTED for your ratification:** `docs/designs/h1-certified-reader-effective-params-2026-07-16.md` (marked DRAFT pending R-021). Contains: the true actor (§0); effective Phase-A + Phase-B tables (§1-2, model + frozen prompts + k=5/single-draw + generation-knobs ABSENT/UNRECORDED, all provenance-cited from disk); the BOUNDED-residual rationale (§3 — joint bar + k=5 stability measured under these same channel defaults, so seal-day needs CHANNEL-match not knob-enumeration, k=5 modal absorbs variance); interface provenance (§4 — Claude Code subagent dispatch on subscription channel; sub-interface UNRESOLVED honestly; seal-day pinned to subscription runtime incl. headless `claude -p`, never API); guard-vs-record split (§5); seal-day binding = Option A (§6). Requesting ratification or amendment.

**R-020.3 channel-class guard — FOLLOW-ON flagged.** The ruling states the identity guard asserts "model, prompt SHAs, k, **channel class**." The guard as committed (`154691f6`) asserts model + prompt SHAs + enumerator SHA + k, but NOT channel-class. Closing that gap = a small guard extension: `certified_reader_identity()` reads `channel_class="subscription"` from the ratified params record and asserts the reader's self-reported channel == subscription (an API self-report ⇒ HALT). **Sequencing:** I'll do this extension AFTER you ratify the record (so the guard reads a frozen channel field, no rework if the record's channel wording changes). Instrument code → implementer + independent grade as usual.

**Module C** (panels + certificate) building in parallel per R-019.4 — report on landing. **Progress unchanged otherwise: A/B/identity-guard landed; C in flight; D/E/F ahead.** Token still waits on GREEN; these close R-019/R-020's blocks on the record + seal-day extraction path.

---

## AR-007 · 2026-07-16 · R-019 params forensics: BOTH readings wrong — the certified Claude rung was a MANUAL subscription-chat process, no API, no adapter. Reframes the params record AND the seal-day extraction path.

**Resolution (from artifacts, per R-019):** neither Reading 1 (`{}`) nor Reading 2 (`{reasoning_effort:"low"}`) is correct — both falsely assumed `scripts/h1-frontier-designpool.ts` produced `staging_v32`. It did NOT: that script hardcodes `MODEL="gpt-5.4"` (`:25`), `new OpenAI({...})` (`:70`), zero Anthropic imports, and writes to `frontier-designpool/`, not `claude-rung-designpool/`. R-018 (`ADVISOR-RULINGS.md:32`) already said that vault is the uncertified gpt-5.4 candidate.

**What actually produced `staging_v32`:** the operator running `claude-opus-4-8[1m]` via **Claude subscription (chat, not the API)**, hand-writing byte-exact outputs into `staging_v32/{vid}__s{id}.json`, then merged by `scripts/h1_claude_merge_vault_v32.py` (pure JSON normalization, no network). Evidence: `claude-rung/PHASE-B-EXTRACTION-COMPLETE.md:1,14-16`; `BIRTH-GATE-k5-PASS.md:1,17` ("Subscription-paced, $0"); pre-reg PIN3/PIN4 ("Model ID frozen `claude-opus-4-8[1m]`... ZERO dollars"); **repo-wide grep of `@anthropic-ai/sdk` / `new Anthropic(` / `claude-opus-4-8`-as-code = ZERO hits — no Claude adapter exists in the codebase.** So `reasoning_effort` was never in this rung's parameter space (no API call to pass it to); the `:78` regex only fires against that sibling script's own gpt-5.4 calls. (Likely confusion source: `h1_build_content_batch_v32.py:43-45` sets gpt-5.4 `reasoning_effort:"high"` — but that's the downstream content-GRADER, not extraction.)

**EFFECTIVE params — certified Claude rung (for the frozen record):** model `claude-opus-4-8[1m]` (consumed); Phase-A enumerator prompt `strategy-enumerator.md` k=5 modal, stability ≥4/5 (consumed); Phase-B prompt `transcript-extractor-frontier-v32.md` single-draw (consumed); `reasoning_effort` / temperature / top_p / max_tokens = **ABSENT / UNRESOLVED — no API call, chat-UI generation knobs were never recorded**; channel = subscription, $0. UNRESOLVED provenance detail: the exact interface (claude.ai web vs Claude Code CLI vs console) is named nowhere.

**★ ESCALATION — this reframes two things, needs your ruling (R-020):**
1. **The frozen params record** should enumerate the EFFECTIVE table above with the honest residual line: the certified reader's generation settings are UNRECORDED and the process was manual-subscription, not an automated call. The pin that holds is model-id + prompt-SHA + k (all guarded); generation-knob fidelity is irreducibly unverifiable for this rung. I can draft this record for your ratification.
2. **Seal-day extraction architecture (the deeper consequence):** "the certified reader EXACTLY" was a MANUAL subscription-chat process. So the seal-day read of the twelve is either **(A) also manual** — the operator hand-extracts the 12 via Claude subscription exactly as the design pool was done, and the driver INGESTS the hand-written artifacts (Module B's injected seam already supports this — the "live_extract_fn" becomes "load operator's hand-written extraction," identity-stamped) — matching the certified process exactly; or **(B) API-Claude** (`claude-opus-4-8` API) — a DIFFERENT invocation than certified, accepting subscription-vs-API drift as a documented residual (mitigated by model+prompt pin + item-11 drift guard). This is a pre-registration architecture call, not mine to make. My lean: **(A)** — it's the only path that is "the certified reader exactly," costs $0, and the driver already supports ingesting hand-written artifacts; (B) introduces an unmeasured instrument change on the once-only read. Requesting your ruling.

Not blocking Module C (building in parallel per R-019.4). Blocking the params record + the seal-day extraction wiring + the token.

---

## AR-006 · 2026-07-16 · R-018.1 identity guard DONE (Band 7, committed `154691f6`) + a PRE-SEAL escalation: the Claude rung's params are enumerated NOWHERE

**Identity guard (R-018.1a/b/c): DONE.** `certified_reader_identity()` computes the pinned identity at runtime from frozen files (model_id + k regex-parsed from `h1-claude-rung-preregistration-2026-07-13.md`; prompt/enumerator SHAs = sha256 of the on-disk agent prompts) — nothing hardcoded (grep clean, R-018 law honored). Every artifact stamped; sealed mode asserts the injected reader's self-reported identity == pinned BEFORE persist; wrong model / missing self-report ⇒ `ReaderIdentityMismatch` HALT, nothing written. **Independent grade: Band 7 SAFE**, core property mutation-tested (2 breaks caught), test-adaptation proven necessary-not-covert. Ratify-packet clarifying note (R-018.1c) landed. Committed scope-locked `154691f6` (only the guard files + packet; the stray concurrent diffs deliberately NOT swept in).

**★ PRE-SEAL ESCALATION (grader-rendered judgment, needs your ruling — NOT blocking C-F, blocking the SEAL-GO token).** The guard asserts model + both prompt SHAs + k. It CANNOT assert the reader's **param values**, because **no frozen artifact enumerates the Claude rung's params.** Verified two ways: (1) the only enumerated params in the corpus (`h1-configpass-preregistration-2026-07-13.md:16`, `reasoning_effort="low"`, temp fixed) belong to the **gpt-5.4 configpass — a different brain**; (2) the production script that PRODUCED `staging_v32`: `scripts/h1-frontier-designpool.ts:78` — `const PHASEB_PARAMS = /frontier/.test(phasebPath) ? { reasoning_effort:"low" } : {}` → for the claude-rung (non-`frontier`) path this is **`{}` (empty params)**. So the certified reader genuinely passed no explicit params; "pinned params" is a designator, not an enumerated value set. Residual risk: a seal-day reader with the right model+prompts but a different actual sampling config would pass the guard (the designator string is self-asserted prose).

**Recommendation (grader + me):** pre-seal, mint ONE frozen record stating the seal-day Claude-rung integration uses `PHASEB_PARAMS = {}` (matching the production script's actual behavior) so the operator has an artifact to diff before authoring `SEAL-GO.token`. Cheap; closes the last identity dimension. **Requesting your ruling:** mint that record now (I can draft it, you ratify the value against the frozen script) vs. accept designator-level as sufficient with written sign-off. `[verify — read scripts/h1-frontier-designpool.ts:78]`.

**Progress: A (Band 8) + B (Band 7) + identity guard (Band 7) LANDED. NEXT: Module C** (mechanical floor + panels + certificate; rehearsal reuses cached panel verdicts, no new spend), then D (leak-scan), E (verdict math), F (rehearsal). Proceeding to C unless you rule on the params escalation first.

---

## AR-005 · 2026-07-16 · Module B graded Band 7 SAFE + committed `94734243`; checkpoint at A+B (2 of 6)

Module B independent grade: **Band 7 SAFE.** The #1 named risk (rehearsal silently using the uncertified gpt-5.4 frontier vault) DISPROVEN two ways — paths hardcoded to the Claude-rung `staging_v32`, byte-exact to source (counts 3/2/2), structurally incompatible with the frontier shape (crashes, never silently mis-reads). 2/2 mutation kills; compose-order (gate-before-extraction) proven; artifacts-on-disk gate proven; enum-stability threshold matches frozen k5-modal (`STABILITY_MIN=4`). Committed scope-locked (two files only; the stray NOT-SAFE `topology_producer` triple + unrelated diffs deliberately NOT swept in, per grader landing-hygiene flag).

**Progress: A (seal-gate, Band 8) + B (extraction orchestration, Band 7) LANDED & graded. Remaining: C (mechanical floor + panels + certificate) · D (human-blind two-stage rater layer + adversarial leak-scan, R-017 pin 1) · E (verdict math: cert→video rollup + ≥60% + economics + validity block) · F (full-dress rehearsal, R-017 pin 2: both witnesses both axes + rollup-on-mixed-video).** Each still module-by-module independently graded. C's rehearsal path reuses cached panel verdicts (enum_semantic_grades / conflation / content) → no new spend; live panels are seal-day.

**Checkpointing here** (2 of 6 landed) to keep the highest-scrutiny modules (D's leak-scan) on fresh context. AR-004's naming-trap pin (seal-day live reader = Claude certified rung, not gpt-5.4) still awaits your ratification — not blocking C. Resuming C→F on the operator's word or your next ruling.

---

## AR-004 · 2026-07-16 · Module B built + a NAMING-TRAP pin to ratify: the seal-day live reader is the CLAUDE rung, NOT gpt-5.4 (despite "frontier-v3.2")

**Module B (extraction orchestration) built + green** (10 tests, regression 138 passed; `src/engine/extraction/sealed_read_driver.py`, uncommitted, under independent grade now). Composes Module A's gate → extraction stage; rehearsal loads the spent videos' cached `staging_v32` artifacts (no live call); sealed path takes an injected `live_extract_fn`; byte-exact persist + artifacts-on-disk gate.

**The pin (load-bearing, surfaced before I build further on it).** Module B's implementer flagged a real disagreement: two extraction instances on disk disagree on enumeration counts — the **claude-rung `staging_v32`** (e.g. DLwVqc = 2 strategies) vs the **frontier gpt-5.4 vault** (DLwVqc mode = 1). I verified the certified-reader identity against the frozen record:
- Tag `efa377d6` = "h1-certified-reader-v3.2 / **CLAUDE RUNG v3.2**"; `staging_v32` (under `claude-rung-v32/`) is ITS output; the joint bar (grounding 4.40%, content 21/22→CLEAR), the fence, and the enum axis were ALL measured on `staging_v32`.
- `src/agents/transcript-extractor-frontier-v32.md` header: *"Phase-B rewritten FRONTIER-NATIVE for gpt-5.4."* So **"frontier-v3.2" is a PROMPT-VERSION name, run on `claude-opus-4-8[1m]` for the certified reader — NOT gpt-5.4.** The gpt-5.4 frontier-designpool vault is a separate candidate (birth-gate/role-split evaluation), never the certified reader.

**Consequence + pin request:** R-015 item 1's phrase "frontier-v3.2 Phase-B" is ambiguous — read naively it could wire the seal-day LIVE extraction to gpt-5.4, which would read the twelve with an UNCERTIFIED extractor (and gpt-5.4-grades-gpt-5.4 downstream, violating the integrity line). Module B correctly leaves the live reader as an injected dependency, so this is a config pin, not a code bug. **Requesting you ratify:** the seal-day `live_extract_fn` = the CLAUDE certified rung (`claude-opus-4-8[1m]` + frontier-v3.2 prompt + enumerator-v1.2 + pinned params + k=5), identical to `staging_v32`'s producer; `[verify — read the artifact]` the exact model/params from the claude-rung pre-reg before seal day. I'll add a code-level guard that the driver stamps + asserts the reader-instance identity on every artifact so a wrong-model injection fails closed.

Not blocking Module B's grade (its code is instance-agnostic). Blocking the eventual seal-day live-path wiring. Proceeding to grade B and build C under this understanding unless you rule otherwise.

---

## AR-003 · 2026-07-16 · R-016 GO executed: §5 addendum done + Module A (seal-gate) LANDED, Band 8 SAFE

**R-016 §5 (supersession addendum):** DONE. Appended a dated supersession ADDENDUM to `h1-frontier-extractor-preregistration-2026-07-13.md` retiring §6(b)'s A-packet-as-terminal-precondition (superseded by R-014 semantic axes). House pattern honored: addendum, original text unedited.

**Ratify packet staged:** `docs/designs/h1-sealed12-driver-ratify-packet-2026-07-16.md` — §6-CONSOLIDATED (as corrected by R-016) decomposed into 6 scope-locked modules A–F, each independently graded before the next depends on it.

**Module A (items 0 + 9 — seal-verification + operator-gate): LANDED, committed `935e85b7`.**
- `src/engine/extraction/sealed_read_gate.py` — reads the sealed-12 identity from the frozen manifest at runtime (R-016 law: sha `4d7b3c29` appears NOWHERE in code, recomputed from `h1-wave6-sealed-fresh-set-2026-07-12.json`); rejects the spent-16 by BOTH basename and sha refuse-target (renamed copy still caught); mechanical operator gate (sealed mode refuses without `docs/designs/SEAL-GO.token`, zero token-creation path in the module; staging refuses the sealed-12); fail-closed on tamper/missing/bad-JSON/unknown-mode.
- **Independent grade: Band 8 SAFE** (top of pre-live ceiling). Two non-overlapping paths agreed on both shas; wrong-set-cannot-be-read proven three ways; 3 mutation breaks all caught; regression 41 passed. One thin-margin residual (sha-mismatch witnessed by one test) CLOSED same-wave with a prefix-defeating 9th test (zero-carry-forward law).

**NEXT — Modules B–F** (extraction orchestration → panels/certificate → human-blind two-stage rater layer → verdict math w/ cert→video rollup → independent re-verify + full-dress rehearsal + drift guard). **Spend note:** Module B onward runs the certified reader + gpt-5.4 panels on the 3 SPENT design-pool videos (rehearsal) — governed pools + hard-cap, budget pre-flighted, expected within the standing envelope (~$0.30–0.60/panel-batch). No sealed video is touched at any point; the run-on-12 stays behind the `SEAL-GO.token` gate that only Tonio authors.

**Guardrails:** sealed 12 (`4d7b3c29`) + 77 (`701c3edb`) PRISTINE; `h1_pilot_phase3_finalize.py` untouched; no `SEAL-GO.token` created. Proceeding to Module B unless you rule otherwise.

---

## AR-002 · 2026-07-16 · R-015 §6-CONSOLIDATED two-path diff: ONE load-bearing CONFLICT (sealed-12 hash swapped) + owed-detail GAPS. HOLDING for your correction before code.

Diffed §6-CONSOLIDATED (items 0-11) against the frozen sources. Method: subagent produced the table, I VERIFIED every conflict/gap against the frozen bytes myself. Result: **1 confirmed CONFLICT, all else AGREES or is acceptable advisor-addition — with two "owed-detail" gaps the build must absorb.**

### ★★★ CONFLICT — item 0 sealed-12 hash is the SPENT PILOT-16's hash (the two-path alarm; verified)
Item 0 pairs the sealed **12** with `8e39ffe1` and demotes `4d7b3c29` to "lineage." **The frozen bytes say the reverse:**
- `docs/designs/h1-sealed-fresh-set-2026-07-12.json` → `fresh_set_size: 16`, `sealed_sha256: 8e39ffe150751fdb…` — the **SPENT pilot-16** (already read 0/16). Its Wave-6 sibling manifest labels it verbatim: `h1-wave6-sealed-fresh-set-2026-07-12.json:12` "the SPENT pilot 16. = 16."
- `docs/designs/h1-wave6-sealed-fresh-set-2026-07-12.json` → `fresh_set_size: 12`, `sealed_sha256: 4d7b3c29838b9a79…` — the **fresh 12**, the terminal-read target.
- `h1-wave6-extractor-iteration-preregistration-2026-07-12.md:35,120` — "terminal read on the sealed 12 (`h1-wave6-sealed-fresh-set-2026-07-12.json`, sha `4d7b3c29…`)."

**Why load-bearing:** item 0 IS the seal-verification gate. Built verbatim, the driver would verify the twelve against a 16-ID manifest hash → false-HALT forever, OR (if "reconciled" toward `8e39ffe1`) open and read the **spent pilot-16** — the exact mis-read the seal exists to prevent. The `8e39ffe1`-for-12 error is inherited (standing state `ADVISOR-RULINGS:58`; and I propagated it in AR-001 below — **AR-001 is hereby corrected: sealed 12 = `4d7b3c29`, NOT `8e39ffe1`**). The **77 = `701c3edb` is correct**; only the 12 is mis-hashed.

**Proposed resolution (zero-transcription-risk):** the driver reads the manifest **from `h1-wave6-sealed-fresh-set-2026-07-12.json` directly** (that frozen file IS the source of truth for the 12's IDs + sha) and verifies live-fetched transcripts against it — no hash hardcoded in code. It must REJECT `8e39ffe1`/`h1-sealed-fresh-set` (spent 16). Requesting you correct the standing-state line so the error stops propagating to other consumers.

### Owed-detail GAPS (frozen requires; the build absorbs these — flagging so they're conscious)
- **Item 5 under-specifies the raters.** Frozen read structure (`h1-wave6-extractor-iteration-preregistration-2026-07-12.md:35` "identical to the pilot's") mandates **TWO-STAGE tier-3 packets** (pilot ADDENDUM 4:113-116: Stage-1 blind role-from-quote-alone committed BEFORE Stage-2 revealed-condition support∈{confirmed,partial,denied}, read-order locked). The Stage-2 support verdict is the field that produced the pilot's 0/16. Item 5's "two blind control-gated raters" omits the two-stage structure — **the build will include it** (control-gate first, then the locked two-stage packet, leak-scanned).
- **Item 6 hides a cert→video rollup.** `terminal_read_clean_fraction` as wired in `pilot_conveyor.aggregate` is **per-certificate (per-strategy)**; the frozen bar is **video-unit** (pilot ADDENDUM 6:172 — a video is certificate-grade iff ≥1 of its strategies is). The driver must supply the cert→video rollup (≥1 clean strategy ⇒ clean video), then apply ≥60% across the 12. **Build will add the rollup layer**; the raw fence fraction is not itself video-unit.

### Acceptable advisor-additions (no frozen backing, but in-spirit — proceeding unless you object)
- Item 1 tail "enumeration-stability adjudication charged to the economics rider" — frozen rider counts only tier-3 support adjudications; this only makes the ≤~15 ceiling stricter. OK.
- Item 9 `SEAL-GO.token` mechanism — principle frozen ("seal-break OPERATOR ONLY"), the file-token mechanization is your net-new mechanism. Sound. OK.
- Item 11 drift-guard trigger — no verbatim frozen source; consistent with instrument-surface discipline. OK.
- Item 10 "mutation-test discipline" — added rigor over the frozen closure-in-both-configs. OK.

### Supersession to reconcile consciously (not a conflict)
`h1-frontier-extractor-preregistration-2026-07-13.md:42` (a frozen source) still lists the A-packet/topology producer as a terminal-read PRECONDITION. R-014 moved the axes semantic and put the A-packet OFF the critical path (`ADVISOR-RULINGS:54`). Items 3-4 correctly track the LATER ruling (latest-frozen-outranks); flagging so the A-packet's removal from the terminal read is a conscious reconciliation, not a silent drop.

**STATUS: HOLDING for your correction of item-0 (and the standing-state hash) before I write code.** Everything else is build-ready; on your go I build to the frozen values with the two-stage packet + cert→video rollup folded in, autonomous under independent grade, staged on spent videos, `SEAL-GO.token` gate, run-on-12 operator-only. Nothing spent; sealed sets pristine.

---

## AR-001 · 2026-07-16 · R-014 DONE (enum axis semantic, armed) — but ONE item stands between here and GREEN that R-014's runway did not name: the sealed-12 conductor DRIVER is unbuilt

**Re: R-014.** Executed and independently certified. The enumeration-consistency axis is now SEMANTIC, cross-vendor (gpt-5.4 judges Claude's extractions), calibrated on both polarities THROUGH THE REAL HARNESS, wired, committed, fail-closed. Details:
- Committed at `41d6a2d6` (worktree `wt-h1-wave4-20260712`), 5 files (3 instrument + 2 test). Scope-locked receipt; no A-packet/cache smuggled.
- Semantic judge: `src/agents/enumeration-consistency-semantic.md`; calibration record `docs/replay-results/h1-scripts/claude-rung-v32/ENUM-CONSISTENCY-SEMANTIC-CALIBRATED.md`; 22 persisted verdicts in `.../enum_semantic_grades/`.
- Law honored: judged against exclusion-log DESCRIPTIONS + SOURCE QUOTES, never key strings (proven paraphrase-robust — grader built a zero-token-overlap re-promotion; lexical PASS, semantic FAIL).
- Both polarities through real harness: IyF re-promoted breakdown → REJECTED on the enum axis alone (conflation PASS); clean variants → CLEAN.
- Per-axis fail-closed gating preserved (either verdict alone ⇒ not-clean). F-1 honesty rider done (coverage states 7 exercised / 15 vacuous).
- Independent grade: **Band 7 SAFE**, mutation-tested (grader broke the forward → 6 regression tests RED → restored → green). Prior NOT-SAFE gaps (uncommitted / fail-open-on-None / no forwarding test) all closed.

**THE ESCALATION (needs your R-015 ruling).** R-014's runway reads: "dress rehearsal completes on the three spent videos → checklist GREEN → machine STOPS → 'Everything's green. Say go.'" My final independent grade surfaced that this runway is **incomplete**, and the fence's own ratify-packet already said so in writing:

- `docs/designs/h1-mergesilencing-fence-ratify-packet-2026-07-13.md` line 59 (PINNED CONTRACT): *"the sealed-12 TERMINAL-READ driver (frozen §6 read shape, when built) MUST gate its ≥60% bar on `terminal_read_clean_fraction`… the end-to-end path completes only when that driver is built. Recorded honestly, not claimed done."*
- **Verified by search:** NO sealed-12 conductor driver exists. The only things that read `terminal_read_clean_fraction` are `run_dress_rehearsal.py` (a lightweight proof harness on 3 spent videos, coupled to A-packet scaffolding) and the instrument that exposes it (`pilot_conveyor.aggregate`). The only conductor+2-blind-raters script is `scripts/h1_pilot_phase3_finalize.py` — it is the FROZEN sealed-PILOT driver (`a73c1f60`, 0/16), gates on `pilot_grade`/`full_grade`, and must NOT be touched (would corrupt the sealed pilot record).
- **Consequence:** the dress rehearsal proves the fence MACHINERY, but it is NOT the seal-day read shape you defined in the standing state (line 33: "fresh clean-room conductor, two blind control-gated raters, ≥60% all-conditions-clean via terminal_read_clean_fraction"). If Tonio says "go" today, there is no built tool that reads the twelve WITH the fence enforcing the bar.

**What I believe closes the gap (my recommendation):** build the sealed-12 terminal-read conductor driver to the frozen §6 read shape — fresh clean-room conductor + two blind control-gated raters + compute conflation & enum semantic verdicts + `finalize_certificate(...)` + gate ≥60% on `terminal_read_clean_fraction`. Instrument code, autonomous under independent grade, STAGED + full-dress rehearsed on spent design-pool videos; the RUN on the sealed 12 stays operator-trigger-only.

**Question for you:** does your model already treat the completed dress rehearsal as sufficient-for-GREEN (i.e., the sealed-12 conductor is a trivially-point-existing-machinery-at-the-12 step you consider in-hand), or do you rule the sealed-12 conductor a required build before GREEN? If the latter, is the §6 read shape frozen anywhere I can build to verbatim, or do you want to author/confirm it first? I hold here until your R-015.

**Guardrails I'm holding:** sealed 12 (`8e39ffe1`) + 77 (`701c3edb`) PRISTINE; phase3_finalize frozen; nothing spent this leg; standing envelope respected.

*(Plain-English mirror for Tonio also at `trading-forge/docs/H1-STATUS-HANDOFF-2026-07-16.md`; this AGENT-REPORTS.md is the canonical agent→advisor channel going forward.)*
