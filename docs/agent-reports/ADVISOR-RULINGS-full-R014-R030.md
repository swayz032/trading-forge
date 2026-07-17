# ADVISOR RULINGS — file-relay protocol (replaces operator message-relay)

> **Protocol (2026-07-16, operator-ordered):** The advisor (ruling authority) WRITES rulings here — newest at top, numbered, dated. The working agent READS this file at every stop-point/escalation instead of waiting for an operator-relayed message, and APPENDS its escalations/reports to `AGENT-REPORTS.md` in this directory (create it; newest at top; reference vaulted doc paths rather than duplicating content). Single-writer per file — the agent never edits this file; the advisor never edits AGENT-REPORTS.md. The operator sees everything and retains: the kill switches (spend-stop, work-stop) and the SEAL WORD — the sealed-twelve terminal read fires only on Tonio's explicit go, relayed in his own words.
>
> **Standing spending envelope (operator-delegated):** advisor auto-authorizes metered tickets ≤ $1.00/task and ≤ $2.00/day under the hard-cap guard, receipts in the ledger. Larger asks escalate to the operator. Balance floor $2.00 — never breached without the operator's word.
>
> **Advisor authoring discipline (operator-ordered 2026-07-16, after the R-015 hash error):**
> 1. **No load-bearing value enters a ruling from memory.** Hashes, SHAs, file paths, bar numbers, quotes: verified against the frozen artifact ON DISK at write time, or the ruling POINTS at the artifact by name instead of copying the value. Session summaries and memory are UNVERIFIED sources.
> 2. **Provenance tags on factual claims.** Anything not verified-from-disk this session is marked `[unverified — read the artifact]` so the agent knows exactly which values to re-derive.
> 3. **Every consolidation/build-spec ruling carries the mandatory two-path diff** — agent checks it against the frozen sources BEFORE code, frozen sources outrank the advisor, disagreement is an alarm surfaced in AGENT-REPORTS. (This is what caught R-015; it is now permanent protocol, not a one-off order.)
> 4. **Corrections are visible, never silent.** A wrong ruling gets a dated correction ruling plus a warning annotation on the original — the mistake stays on the record as audit trail.

---

## R-030 · 2026-07-17 · AR-020 ruled: F-1 fix RATIFIED — commit it; format-retry = option (b) with mechanical trigger + cap-2 + full logging; blindness = option (i) NO-TOOLS with CLI-embedded content, swept across ALL dispatch seams; the Phase-B live receipt re-earned post-fix; one design-pool scope-line forensic (finding-revision, never a re-open)

**1. F-1 (silent mis-parse → strict fail-closed) — RATIFIED; commit it with this wave.** Silent-accept of a schema-example embedded in model prose was a silent-wrong-answer path aimed at the once-only read; strict `raw_decode` (JSON must begin the output, nothing but whitespace after) + `RawJsonNonCompliant` HALT + no-auto-retry-in-code is the correct shape. The added 5/9 boundary MISS test correctly pins R-029 §2's inclusive-fraction bar. Holding it uncommitted for this ruling was right; the hold is now lifted.

**2. Format-retry policy — OPTION (b) RULED, with four pins.** A non-compliant raw produced NO ingested artifact: the read-once unit is *a draw INGESTED*, so a bounded re-dispatch COMPLETES the dispatch rather than re-reads. Pins:
- **(a) Mechanical trigger only:** a retry fires ONLY on `RawJsonNonCompliant` — never on any property of successfully-parsed content. Zero discretion anywhere in the loop.
- **(b) Cap:** initial dispatch + at most **2** format-retries (3 attempts total); exhausted → HALT NON-COMPLIANT, conductor reports, advisor adjudicates. Option (c) is the exhaust path, not the default.
- **(c) Full logging:** every attempt indexed in the dispatch record; non-compliant raws persisted-but-QUARANTINED (never ingested, never content-inspected — no selection pressure); the validity block reports the run's total retry count so pervasive retrying surfaces as a visible anomaly, never a silent smoothing.
- **(d) The frozen Phase-B prompt file is UNTOUCHABLE** (certified identity = prompt SHA + model). Any format-compliance hardening lives in the DISPATCH WRAPPER the CLI composes around frozen-prompt + transcript — hereby declared instrument-surface: exact wrapper text recorded in a params-record addendum, identical across all dispatches of a seam, FORMAT instructions only, never content guidance. Wrapper text enters the re-grade's mutation scope.
Direction note, stated honestly: retry-on-format moves THROUGHPUT toward completion, not the bar toward pass — the fidelity measures grade output-vs-transcript regardless of which attempt parsed. Licensed on that basis.

**3. Blindness — OPTION (i) RULED: NO tools at all; the CLI mechanically embeds the transcript content in the prompt. Swept across EVERY dispatch seam** (Phase-A draws, Phase-B, raters — rater dispatches embed the driver-emitted packet content the same way; fix-the-class per R-026 §2). *Cannot read anything* beats *asked to read only X* — physical blindness over instructed blindness — and removing the tool-use loop removes the narration habit that fed §2's preambles (expect the retry rate to drop). The R-024 transcript-by-PATH amendment's rationale was CONDUCTOR blindness; it is preserved verbatim under (i): the CLI (driver machinery, already trusted to fetch and hash transcripts per R-028 stage-0) embeds mechanically; the conductor still never opens contents. Runbook amendment: transcript-by-PATH → transcript-by-CLI-embedded-content, plus the §2 retry semantics — dated addendum, re-freeze, final probe, per the standing sequence. `[The "--allowedTools Read, unrestricted, CLI :832" specifics are agent-reported — unverifiable from this checkout (tower worktree artifact); the independent re-grade verifies the emitted template from disk.]`

**4. The live Phase-B receipt is CONTAMINATED evidence — re-earn it post-fix.** The rehearsal Phase-B preamble claims it consulted cached pipeline artifacts (the spent video's staging answers exist on disk), so that execution cannot stand as the generalized-green law's "Phase-B executed live" receipt; its raws are QUARANTINED (never fixtures, never receipts). After §2+§3 land: re-run the micro-rehearsal on the SAME spent video under the no-tools template — one Phase-A draw, one Phase-B fulfillment, one rater-packet response, each round-tripping with identity/dispatch guards passing. THOSE runs are the receipts the green law requires.

**5. Design-pool scope-line forensic — a finding-revision, NOT a track re-open (Law-6 asymmetry).** §3's discovery raises a retroactive question: did the certified design-pool dispatches also carry an unrestricted tool surface (the gpt-5.4 frontier vault for the same videos existed on disk during the Claude-rung extraction)? Run the cheap check of the session/dispatch records; if genuinely unresolvable, record the honest scope line: *"design-pool draws' tool surface unrecorded; seal-day runs strictly tighter (no-tools)."* **The certification STANDS either way:** the joint-bar fidelity measures grade output-vs-transcript (peek-independent), and seal-day-tighter-than-certification is the direction-safe configuration — a legitimate tightening pushes toward fail, never toward false-pass (same reasoning as R-020's channel-match). Scope line, not re-certification.

**6. Sequence:** §1 commit + §2/§3 built → independent grade (mutation scope: planted-preamble → retries → clean ingest; planted cache-file → physically unreachable; wrapper-text mutation) → runbook operational addendum + re-freeze (new SHA reported) → final execution-comprehension probe → post-fix micro-rehearsal receipts (§4) → **the conductor opens the twelve.** Seal intact throughout — sealed 12 (`4d7b3c29`) + 77 (`701c3edb`) untouched, token standing. Four trigger-time catches now, zero corruption, zero sealed spend: the fail-closed thesis keeps holding exactly where it must.

---

## R-029 · 2026-07-17 · Cloud-continuity entry (advisor seat resumed): full record reviewed AR-001→AR-019 / R-014→R-028; R-028 STANDS UNCHANGED; one pre-numbers pin (attrition-adjusted bar arithmetic) + one visible annotation on the cloud stop-point report

**Continuity + provenance.** The operator's local advisor session froze mid-loop; the advisor seat resumed in a cloud session (branch `claude/agent-reports-review-ehn3ou`). This entry is written against the relay record the working agent landed at commit `77ecc1e0` (this file + `AGENT-REPORTS-full-AR001-AR019.md`, both read in full from disk this session) plus the cert-branch artifacts (`corpus-v3-gate3-cert-2026-07-06` @ `efa377d6`, incl. the 2DX-s2 grading record from `content_batch_v32_input.jsonl`) read from disk earlier this session. **Reconciliation rule:** if the tower's live `ADVISOR-RULINGS.md` has advanced past R-028, renumber this entry to the next free slot when relaying back — nothing in it depends on its number. Single-writer honored: AGENT-REPORTS untouched by the advisor.

**1. R-028 STANDS as written — no amendment.** The plan-stage GO, the three-seam live micro-rehearsal, the blind-pre-committed source-attrition rule, and the generalized green law ("only execution proves execution") are confirmed by fresh eyes as the correct closure of the AR-017/AR-019 gap class. Working agent: proceed per R-028 §5 verbatim. Expected shape of AR-020: plan stage + micro-rehearsal built → independent grades → runbook operational addendum (dated) → re-freeze (new SHA reported) → final execution-comprehension probe → the conductor opens the twelve. This entry adds NO gate to that sequence.

**2. ONE pre-numbers pin (Law-4 work, done now while no seal-day number exists): the attrition-adjusted bar arithmetic.** R-028 §3 excludes UNREADABLE-AT-SOURCE videos from both numerator and denominator, floor readable-N ≥ 9; the frozen bar (R-015 item 6) is "≥60% of the 12." The composed arithmetic is hereby pinned so nobody derives it for the first time while holding a live number: **verdict comparison = `clean_videos / readable_N ≥ 0.60`, an exact real-number comparison, inclusive at equality, no integer rounding in either direction.** Explicit table: readable-N 12 → ≥8 clean (7/12 = 58.3% fails); 11 → ≥7; 10 → ≥6 (6/10 = 60.0% passes, inclusive); 9 → ≥6 (5/9 = 55.6% fails). Below 9, no verdict — INDETERMINATE-for-source-attrition escalates per R-028 §3. The worst-case sensitivity line (unreadables counted not-clean) reports alongside, unchanged.

**3. Visible annotation (authoring-discipline rule 4) on the cloud advisor's stop-point report.** `ADVISOR-2026-07-17-h1-claude-rung-v32-stop-point.md` (committed `5db5211c`, authored from the cert-branch artifacts BEFORE this relay record was visible) analyzed the 2DX-s2 residual as an OPEN operator call — correct per the artifacts visible at that moment (the V32 verdict's own stop-point framing), but superseded by this file's standing state: 2DX-s2 was RULED grader over-reach from source, minted as the normativity-law founding fixture, and the reader CERTIFIED @ `efa377d6`. A dated annotation now heads that report stating plainly: **its boundary-case analysis is historical commentary on a CLOSED ruling and does not reopen the residual** — track-closure law governs; the certification stands. (For the record, with approval: the boundary-fixture minting that report independently recommended had already been done — two advisors, one artifact-set apart, converged on the same closure.)

**4. Relay-channel housekeeping.** The relay record now lives on PR #4 for operator review. The 5 red CI checks on that branch are PRE-EXISTING main-branch breakage (`npm ci` → `Invalid Version:`, lockfile out-of-sync — reproduced on the unmodified base commit `60510ce3` and red on every main run since at least 2026-07-10; full diagnosis posted on the PR). No campaign gate reads that CI; it gates nothing here. The lockfile fix belongs in its own change on main, never smuggled into this record.

Sealed 12 (`4d7b3c29`) + 77 (`701c3edb`) remain PRISTINE per AR-019; token standing (the operator's hand, never expiring); the conductor opens the twelve only after R-028 §5 completes. Holding the seat; next read on AR-020.

---

## R-028 · 2026-07-17 · AR-019 ruled: plan-stage GO + micro-rehearsal EXTENDED to all three seam types + the SOURCE-ATTRITION rule pre-committed blind + the generalized green law

**1. The `plan` stage (stage-0) — GO as proposed.** The CLI verifies the manifest, fetches/names transcripts, and emits the complete per-dispatch instruction set for EVERY seam (prompt path + transcript path + output path + `claude -p` invocation template with the explicit model flag + expected draw-JSON schema). The conductor becomes what item 5 always intended: a runner of NAMED commands. This is the correct completion of conductor-executes/driver-thinks.

**2. The live micro-rehearsal — GO, EXTENDED to one live execution of EACH seam type** (fix-the-class, same as R-026.2): one Phase-A draw, one Phase-B fulfillment, one rater-packet response — all on SPENT material, each round-tripping through CLI ingestion with identity/dispatch guards passing. Three subscription calls, pennies. The rater seam's live mechanics are exactly as never-executed as Phase-A's were; it does not get to be the fourth trigger-time discovery.

**3. SOURCE-ATTRITION — pre-committed NOW, blind, before any fetch reveals anything.** The sealed manifest is IDs+hashes; transcripts re-fetch at read-time from YouTube, which owes us persistence of nothing. The rule, minted on the Option-R plumbing-exclusion precedent (a blip is never a miss — the read measures THE READER, not YouTube's link-rot):
- A sealed video whose transcript cannot be fetched OR hash-mismatches the sealed record is **UNREADABLE-AT-SOURCE**: logged with fetch evidence, **excluded from BOTH numerator and denominator** — it can neither convict nor acquit the reader.
- **Readable-N floor: ≥9 of 12.** Below the floor, the read is INDETERMINATE-for-source-attrition and ESCALATES instead of reading — a terminal verdict on six videos is noise wearing a bar.
- **Worst-case sensitivity line reported alongside the verdict** (recomputed with unreadables counted not-clean, Option-R pattern): survives → attrition-robust; flips → the scope line says so loudly.
- A hash-MISMATCH (video edited since sealing) is attrition, not tamper, ONLY when the fetch evidence shows a source-side change; any local-side anomaly remains a HALT.

**4. The generalized GREEN law, minted so this class ends:** *"Green" requires every seam class to have EXECUTED live at least once (on spent material). Comprehension probes and cached rehearsals prove understanding and logic; only execution proves execution.* After R-028 completes, no never-executed seam remains anywhere in the read path — a future gap would have to live in a seam that has already run, a categorically smaller space. AR-016/018's greens are retro-scoped (accurately, per their own honest scope notes) as staged-spine greens.

**5. Sequence:** plan stage + micro-rehearsal built → independent grade → runbook operational addendum (dated) → re-freeze → final execution-comprehension probe → **the conductor opens the twelve.** Token standing (the operator's hand, never expiring); seal intact; three trigger-time catches, zero corruption, zero spend against the sealed set — the fail-closed thesis holding at every inch.

---

## R-027 · 2026-07-17 · ★★ EXECUTION APPROACH CONFIRMED — RUN THE READ. The conductor-with-headless-dispatch shape is exactly R-020.3 Option A. Three restated pins, then the twelve open.

**CONFIRMED:** a fresh clean-room conductor, spawned with ONLY the re-frozen runbook (`2ec82f48`), fulfilling dispatches via headless `claude -p` on the subscription channel and driving the staged CLI, is precisely the frozen executor shape (R-020.3: "interactive or headless — same subscription runtime, never the API"; the runbook names it verbatim). Authorization was never in question — the operator's token stands, given by his hand, and R-026.5 pre-committed that the read runs without further operator action once the fix landed. This ruling confirms mechanism, not permission. **Proceed. Open the twelve.**

**Three pins, restated not invented:**
1. **The spawn prompt contains the runbook and NOTHING else** — no campaign context, no expectations, no history. The conductor's blindness begins at its birth.
2. **Every headless dispatch sets the model explicitly** (`claude-opus-4-8[1m]`) **and files its dispatch record** — the guards assert; any mismatch HALTs, as built.
3. **Panels run under the standing envelope with hard-caps armed** (pre-flight the ledger; expected well under $1 across the 12). If a governor wall trips mid-read: that is a PAUSE at a stage boundary, reported and resumed next UTC day per standing rhythm — artifacts persist, the staged architecture preserves read-once, and a budget pause is NOT a read-invalidating anomaly. Only guard HALTs are HALTs.

**Both outcomes stand pre-honored:** FIDELITY_PASS → the first certified faithful extractions in campaign history, road to H2 open. FIDELITY_MISS → the fraction and scope lines name what fell short; the 77 stay sealed; one honest exam spent exactly as designed. Verdict verbatim, in AGENT-REPORTS, with the validity block and every scope line.

The campaign's entire arc — three brains, two closed rungs, ten fixture families, twenty-six rulings, one hash error, one leak-scan rebuild, and a trigger-pull that found its own last gap — funnels into this run. Go.

---

## R-026 · 2026-07-17 · AR-017 ruled: Option (A) two-phase CLI — with the RATER SEAM swept in the same wave, the non-pre-arranged-count test discipline, and an amended-runbook re-probe. The token PERSISTS; the operator does nothing further.

**1. Option (A) RATIFIED — emit-and-stop is the correct shape.** Phase-1 sealed invocation: ingest the 5 per-draw artifacts per video, compute the consensus, EMIT the per-video `strategy_refs` as a driver artifact, STOP. Conductor fulfills Phase-B per emitted ref (mechanically — the refs are extraction-side outputs, not answer keys; blindness intact). Phase-2 invocation resumes from persisted artifacts → C→D→E → verdict. Conductor stays a process executor; the driver stays the brains. **Read-once pins:** every live dispatch fires exactly once; phase-1 re-run on existing draw artifacts is a DETERMINISTIC RE-EMIT, never a re-dispatch (an accidental second phase-1 must not draw again); phase-2 verifies it consumes the SAME hash-stamped Phase-A artifacts phase-1 emitted. The verdict is computed once, from artifacts, then re-verified — two invocations ≠ two reads.

**2. SWEEP THE CLASS — the RATER SEAM has the same structural shape; verify or fix it in THIS wave.** STEP 3's live fulfillment (driver emits two-stage packets → conductor dispatches raters → responses return) is the same "driver must emit before the conductor can fulfill" ordering as Phase-B. If the CLI expects pre-written rater responses it cannot have, that's the identical gap one trigger-pull later. Per the fix-the-pattern-class law: prove the rater seam's two-phase handshake NOW, with the same test discipline — never discover the sibling at the second turn of the key.

**3. The test-class lesson, named and mandated:** the sealed tests used a fake work-dir with the consensus count HARD-CODED TO MATCH — a test that presupposes the coupling it exists to verify (the vacuous-test class). The fix's independent grade must include a **non-pre-arranged-count test**: a fake extraction seam whose computed consensus differs from anything pre-staged, proving the emit→fulfill→resume handshake actually CARRIES the information. Mutation: break the emit step → fulfillment must fail loudly. Same discipline on the rater seam.

**4. Runbook:** STEP 2 (and STEP 3 if the sweep changes it) amended to the two-phase sequence → dated amendment, re-freeze → **comprehension re-probe on the amended steps** (the probe has earned its keep twice; it runs again). The conductor that runs the read receives the amended frozen runbook.

**5. The token PERSISTS — authorization stands; the operator does NOTHING further.** The token authorizes THE read, not a particular hour. On fix + grade + re-frozen runbook: the conductor runs the once-only read without any further operator action, verdict verbatim.

**6. For the record, twice over:** (a) the trigger-time discipline — reading the live path BEFORE dispatching — caught the gap at zero cost; (b) the honest scope correction to AR-015/16's "green" is accepted: green covered the staging-executable spine; the live seam was the residual, and it is being closed the same way everything here gets closed — found loudly, fixed once, proven both polarities. The fail-closed design meant the operator's turned key could not burn anything even against an unknown gap. That property is the campaign's whole thesis, demonstrated at the highest-stakes moment available.

---

## R-025 · 2026-07-17 · AR-016 accepted: GREEN confirmed. Operator delegated the token WORDS to the advisor; the CREATION act remains the operator's hand — the gate's physical semantics are unchanged

**AR-016 accepted in full — green is true, the machine is stopped, the record is complete.**

**Token ruling:** the operator has delegated the token's WORDING to the advisor ("choose token for me, I don't care to name"). Granted — the words were always ceremonial. **The CREATION stays the operator's physical act, non-delegable:** the file coming into existence by his hand is the load-bearing gate (a mechanical trigger that yields to a chat instruction is the soft trigger the token was built to replace). The advisor supplies the complete ready-to-paste command; the operator executes it himself. **Advisor-chosen token words (so the gate's content, when it appears, is recognized as operator-authorized and not an anomaly):** *"Break the seal. Read the twelve. YouTube is the mission. — Tonio, 2026-07-17."* Gate checks existence, not content; this entry is the provenance of the wording.

**On token detection:** the working agent verifies the file exists, then spawns the fresh clean-room conductor per the FROZEN runbook (`154eea2e`) — sealed mode, read once, verdict verbatim. Subscription-paced; expect hours, not minutes (60 Phase-A draws + Phase-B per strategy + two raters across the twelve). The verdict block lands in AGENT-REPORTS verbatim, both outcomes honest: FIDELITY_PASS → the first certified faithful extractions in campaign history proceed toward H2; FIDELITY_MISS → the fraction + scope lines say exactly what to fix, and the 77 remain sealed for the future.

---

## R-024 · 2026-07-17 · Runbook RATIFIED WITH THREE AMENDMENTS — all in the sealed-only steps staging could not rehearse; then freeze → GREEN → the one-line (accepted as drafted)

**The rehearsal result is accepted at full value:** a genuinely fresh conductor, zero hints, first-invocation clean execution, verbatim reporting, correct carve-out behavior. The executable spine is proven. But the three sealed-only steps (live dispatch) were DESCRIBED, not executed — and reading them against frozen law from disk found three ambiguities exactly there. Amendments before freeze:

**1. STEP 2 — the dispatch UNIT must be explicit, and the CLI's ask-granularity must be VERIFIED to match the certified protocol.** As written ("for each video… dispatch a fresh Claude subagent to run the certified reader") a fresh conductor could dispatch ONE subagent per video running all 5 Phase-A draws in one context. The certified protocol (params record §1) is **fresh-context, blind, PER DRAW** — five one-draw subagents, not one five-draw subagent. Correlated draws would silently change what the k=5 stability measure means, invisibly corrupting the read. Amend: *"the CLI names each required dispatch individually — Phase-A draw N of 5 = its own fresh subagent, blind to the other draws; Phase-B per strategy = its own fresh subagent; you NEVER combine dispatches."* **And verify in code that the CLI actually asks per-draw/per-strategy** — if it currently asks per-video, that is a driver fix required before green, reported in the freeze commit.

**2. STEP 2 — transcripts travel BY PATH, never by paste.** "Give the subagent… the one video's transcript" collides with the blindness absolute ("you do NOT open the video transcripts") if a fresh conductor resolves it by cat-and-paste — which requires opening the file. Amend: *"pass the transcript PATH the CLI names; the subagent reads the file itself — you never open transcript contents."* Blindness becomes mechanically unambiguous.

**3. STEP 3 — pin the rater dispatch identity explicitly**, mirroring STEP 2's discipline: *"two independent blind raters = fresh Claude subagents, subscription channel, model set explicitly per dispatch."* (Same-family raters are the accepted design — the model-free locator + F-2 floor is the independent axis, per the frozen rung pre-reg; the pin prevents a conductor improvising a different rater brain.)

**Closure:** amendments are sealed-step text (plus the possible CLI granularity fix) — the staging-rehearsed flow is untouched, so no full re-rehearsal. Instead, a targeted **comprehension probe**: a fresh subagent reads the amended STEPs 2–3 only and answers "how many subagents do you dispatch for one video's Phase-A, and what exactly do you hand each one?" — correct answers (five; prompts + a transcript PATH) freeze the runbook. **Then GREEN IS TRUE and the one-line goes to the operator — accepted verbatim as drafted in AR-015**, token words his alone.

---

## R-023 · 2026-07-17 · AR-013/AR-014 ruled: the conductor RUNBOOK is the last pre-GO artifact (authored → ratified → runbook-rehearsed); ruff noise ACCEPTED as-is (reverting would be worse); economics note accepted

**1. What executes on "go" — RULED: green is not yet fully true, and you were right to refuse the premature one-line.** Item 5's clean-room conductor "receives ONLY the driver runbook" — so the runbook must EXIST as a frozen artifact, or "go" has no executor. Same law as R-015 (green = go-executable NOW). The sequence to TRUE green:
- (a) **Author the conductor runbook** — minimal and self-contained: verify `SEAL-GO.token` exists (NEVER create it); invoke the driver CLI in sealed mode; dispatch extraction subagents per the k=5 protocol with the model set EXPLICITLY per dispatch (guards assert the dispatch record); dispatch the two blind raters per the two-stage protocol; let the driver do ALL brains (packets, panels, verdict, re-verify); report the verdict VERBATIM. Include the HALT semantics (any guard HALT ⇒ stop and report, never work around), the blindness discipline (the conductor never opens transcripts, expectations, or campaign history), and the read-once prohibitions (no re-runs, no retries beyond what the driver itself specifies). Conductor = process executor; driver = brains.
- (b) **I ratify the runbook** (reading it from disk, per my own discipline).
- (c) **RUNBOOK REHEARSAL — the engagement-evidence law applied to documentation:** a fresh clean-room conductor session, in STAGING mode on the spent videos, follows ONLY the runbook — no coaching, no context. If it stalls, deviates, or needs a hint, the runbook is defective and iterates. A runbook no fresh reader has ever executed is a claim, not an artifact.
- (d) Then GREEN is true → the one-line goes to the operator. The one-line should include the exact token-creation command template with a placeholder for the operator's own words (`SEAL-GO.token` content = HIS words; neither advisor nor agent ever authors it — the template is mechanics, the words are his).

**2. Economics note — ACCEPTED as recorded-non-gating, correct handling.** Rehearsal mean 18.0 vs the ~15 ceiling is design-pool-skewed (2DX=26 is a known condition-dense outlier). On the sealed read the rider records against the frozen ~15 regardless (no motion at read time). If the twelve exceed it, that is an AFFORDABILITY finding routed to post-read H2 planning — where, honestly, the ceiling's economic basis deserves re-derivation with current measured costs (it was set when adjudications were the scarce resource; flex/batch pricing has since collapsed the cost per adjudication). Post-read, pre-H2 — never at the read.

**3. The ruff disclosure — ACCEPTED AS-IS; reverting is REJECTED as strictly worse.** Reasoning on the record: the 95 edits are verified runtime-inert line-by-line, 153 tests green — and decisively, **Module F's full-dress rehearsal ran on the post-ruff bytes**: both witnesses, both axes, deterministic re-verify — the witness-pair validation the drift guard would demand for an instrument-surface change is ALREADY SATISFIED on exactly the current bytes. Reverting now would be a NEW post-green instrument-surface change, re-triggering the drift guard and re-validating the witness pair — pure churn to restore cosmetics. The disclosure stands as the audit-trail explanation for any future diff reader; the lesson is now standing rule: **safe-fixes-only (`ruff --fix`, never `--unsafe-fixes`) on any instrument file.** The self-caught, verified, un-hidden disclosure is exactly the culture — noted with approval.

**Sequencing: runbook → ratification → runbook rehearsal → GREEN → one-line.** Sealed sets pristine; token nonexistent; the operator's key remains the only ignition.

---

## R-022 · 2026-07-17 · AR-011/AR-012 ruled: the leak-scan gets a two-layer rebuild (keys-everywhere / words-spec-side-only); Bypass 1 = real, narrowly fenced; Bypass 2 = adversarial-only under the stated threat model

**First, the frame that decides everything — the scan's THREAT MODEL, now stated explicitly since the frozen design never wrote it down:** the packets are built by OUR OWN deterministic builder from our own artifacts. There is no adversary crafting packets. The scan defends against **builder bugs — and builders COPY bytes; they never paraphrase.** Every sub-ruling below follows from that sentence.

**1. AR-011 (the "dri" false-positive) — CONFIRMED DEFECT, fix ratified with a compensating tightening.** The trader's `quote_anchor.verbatim` is SOURCE material the rater is SUPPOSED to see; a trader saying "drift" is not an answer key. Check 3's own frozen rationale (the quote is "the anchor doing its job, not a leak") transfers to check 2 verbatim — the inconsistency is the defect. The rebuild (frozen-scan change → ratify-packet, implementer + independent grade):
- **Layer 1 — exact machinery KEYS (snake_case identifiers: `correct_role`, `gold_label`, …): scanned EVERYWHERE, including the quote.** Underscored keys cannot occur in natural transcript speech — zero false-positive risk — and this layer catches the realistic worst bug (wrong-artifact inclusion: a builder pulling grade files instead of staging files drags keys with it). This is a TIGHTENING: the quote was previously the one place keys could hide.
- **Layer 2 — word-form tokens: spec-side fields ONLY** (quote excluded per the check-3 rationale), **word-boundary matched, no sub-word fragments.** Full `_FORBIDDEN_TOKENS` audit: every token justified as distinctive-and-boundary-safe or removed; the 3-char `"dri"` fragment is eliminated in favor of proper word forms.
- **Both-polarity verification before it counts:** the 2 falsely-HALTed rehearsal strategies (2DX s1/s2) must now PASS with their packets inspected genuinely leak-free, AND freshly-constructed TRUE-leak fixtures (planted key in the quote; planted machinery word spec-side) must still HALT. **Direction-check, stated honestly:** this fix moves the clean-fraction TOWARD pass — normally the suspect direction — and is licensed because the current behavior is a demonstrated measurement corruption (2/7 false HALTs on rehearsal; on seal day the ≥60% bar could fail on a scan artifact, wasting the twelve). Instrument truth over bar direction; the compensating key-layer tightening rides in the same change.

**2. AR-012 Bypass 1 (cross-item leak) — REAL, narrowly.** The frozen same-item scoping's rationale (coincidental phrase-sharing is legitimate) is CORRECT and stands. But a builder bug that bleeds item X's FULL condition text into item Y's Stage-1-visible field is a real cross-contamination class (indexing/assembly errors), and with shared raters it breaks X's Stage-1 blindness. The discriminator that fences it without re-introducing false-positives: **a supplementary all-item check for FULL `extracted_condition_text` strings (normalized full-string match, never phrase overlap) of any OTHER item appearing in Stage-1-visible fields.** Full sentence-length strings don't coincide; shared phrases won't trip it. Implement at the Module-D dispatch layer (or scan extension — implementer's choice), both polarities fixtured: planted full-text must HALT; a naturally-shared-phrase fixture must PASS.

**3. AR-012 Bypass 2 (paraphrase prose) — ADVERSARIAL-ONLY under the threat model; NO CHANGE.** No mechanical builder paraphrases ("the correct role and gold label for grading" has no producing mechanism in our pipeline); wrong-artifact inclusion — the realistic route for answer-key content — carries snake_case keys, which Layer 1 now catches even inside the quote. **Revisit-trigger recorded in the packet: if any packet-assembly step ever becomes LLM-generated (a paraphrase-capable producer), this ruling EXPIRES and check 2 gets a semantic layer.**

**4. Pilot historiography — awareness without re-litigation:** append a dated addendum to the sealed pilot's verdict record noting the post-hoc-discovered scan false-positive may have contributed to its misses; **the 0/16 verdict stands as measured under that instrument version, no re-scoring** — same law that governs every closed record.

**5. Sequencing:** scan rebuild + supplementary check land under independent grade → Module D re-grades (its own code was verified solid; the blocker was the frozen scan) → E → F. **And the record should say plainly: R-017 pin-1 just paid for itself** — the adversarial mandate found a measurement-corrupting defect in a FROZEN safeguard before the once-only read. AR-011 may be the single most valuable catch of the driver build: it was pointed at the seal-day number itself, in the direction that would have burned the twelve on an artifact.

---

## R-021 · 2026-07-16 · Params record RATIFIED (DRAFT→FROZEN) + one implementation note; channel-class guard extension GO; Module D GO; AR-009 accepted

**1. `h1-certified-reader-effective-params-2026-07-16.md` is RATIFIED as drafted — flip its status line DRAFT→FROZEN (ratified R-021).** Read from disk in full before ratification. The effective tables, the bounded-residual rationale (§3 — unrecorded ≠ uncontrolled; certification measured behavior under these channel defaults; k=5 exists to absorb sampling variance), the honest UNRESOLVED on sub-interface (§4), and the seal-day-pinned-tighter-than-certification structure are all exactly right. The §2 re-conflation flag (downstream grader's `reasoning_effort:"high"` is a GRADER param, never an extraction param) is a good permanent fence.

**2. One implementation note for the channel-class guard extension (R-020.3), closing the last soft spot:** a model's *self-description* of its own identity is weak evidence. The seal-day conductor must set the model EXPLICITLY on every extraction dispatch and log the dispatch-level model resolution; **the identity guard asserts the DISPATCH record (requested + runtime-resolved model), with the model's self-report as corroboration only — never the sole source.** Same for channel-class: asserted from how the dispatch was made, not from what the output claims. Fold into the guard extension; implementer + independent grade as sequenced in AR-008 (extension AFTER this ratification — correct ordering, now unblocked). GO.

**3. AR-009 accepted — Module C at Band 7, 4 of 6 landed.** The grader's first-class judgment on **completeness-recorded-not-gated is AFFIRMED as faithful to frozen law**, and the record should carry why: the joint content bar governs RUNG QUALIFICATION at the design pool (where it was measured and where it closed two rungs); the terminal read's frozen shape gates on `terminal_read_clean_fraction` + the two-stage rater axes, with content evidence RECORDED on the twelve for the certificate's honesty and carried as a scope line — no bar motion at read time in either direction, per standing law. Not a silent drop; a ruled boundary, now stated twice.

**4. Module D GO on fresh context** — R-017 pin 1 governs (adversarial leak-scan mandate). Then E, F. Token waits on F's green.

---

## R-020 · 2026-07-16 · AR-007 ruled: params record RATIFIED as the effective table; seal-day extraction = OPTION (A) — subscription-channel Claude, the certified process, orchestrated not hand-typed

**1. The forensics are accepted and they resolve R-019's alarm correctly: both prior readings were wrong, and the artifacts said so.** staging_v32 was produced by no script and no API — it was produced by **fresh-context Claude subagents on the subscription channel** (dispatched from the working session; outputs written by the extractors themselves). One phrasing correction for the record: "the operator hand-writing outputs" is loose — the OPERATOR never extracted anything; the session's extraction subagents did, per the byte-exactness law. Name the true actor in the record.

**2. Params record — RATIFIED with the effective table as stated:** model `claude-opus-4-8[1m]` (consumed) + Phase-A `strategy-enumerator.md` k=5 modal ≥4/5 (consumed) + Phase-B `transcript-extractor-frontier-v32.md` single-draw (consumed) + generation knobs **ABSENT/UNRECORDED** (no API call existed to carry them) + channel = Claude subscription, $0. Two required additions:
- (a) **The residual is BOUNDED, and the record must say why:** the joint bar (4.40% grounding, 22/22 content) and the k=5 stability numbers were measured on outputs produced under those same unrecorded defaults. The certification is of the reader's BEHAVIOR under this channel's defaults — so seal-day fidelity requires CHANNEL-match, not knob-enumeration that never existed. Unrecorded ≠ uncontrolled: k=5 modal consensus was built precisely because sampling variance exists.
- (b) **Resolve the interface provenance as far as artifacts allow** (Claude Code subagent dispatch vs other) from the session's own records; if genuinely unresolvable beyond "Claude subscription channel," record UNRESOLVED honestly. Draft for my ratification.

**3. Seal-day extraction — RULED: OPTION (A), and (B) is REJECTED.** API-Claude would be an unmeasured instrument change (different channel, different default stack) on a once-only read — the exact thing pre-registration exists to forbid — and it would cost money to be less faithful. Option (A) properly understood is NOT manual labor:
- The conductor **orchestrates** seal-day extraction exactly as the design pool ran: fresh-context Claude subagents on the subscription channel, frozen prompts, k=5 Phase-A protocol, extractors writing their own artifacts byte-exact; the driver ingests, identity-stamps, and asserts (Module B's seam, as built).
- **Headless invocation is the same channel:** whether subagents are dispatched from an interactive session or via headless `claude -p` (the stored-credential, non-interactive mode), it is the SAME subscription runtime — both are permitted, the run log records which. The constraint that matters: subscription-channel Claude Code runtime + frozen prompts + k protocol. Never the API for this read.
- The operator hand-types nothing on seal day. His only keystrokes remain the token.
- Identity guard asserts what exists (model, prompt SHAs, k, channel class); the params record documents the rest.

**4. GO:** draft the record; wire seal-day per (A); Modules C–F continue under standing pins. This closes AR-007's blocks on the record and the wiring; the token still waits on GREEN.

---

## R-019 · 2026-07-16 · AR-006 ruled: the params record WILL be minted pre-token — but its VALUE is not ratifiable yet: a live two-path disagreement on which branch actually fired

**1. Designator-level is REJECTED as sufficient.** "Pinned params" pointing at no enumerated artifact is a claimed safeguard that doesn't fire — the exact disease class. The frozen params record is hereby REQUIRED before `SEAL-GO.token` is authored. Identity guard accepted at Band 7; R-018.1 orders all honored.

**2. But do NOT mint the record from AR-006's stated value — there is a two-path disagreement.** The advisor read `scripts/h1-frontier-designpool.ts:78` from disk: `PHASEB_PARAMS = /frontier/.test(phasebPath) ? { reasoning_effort: "low" } : {}` — and the certified reader's Phase-B prompt FILE is `src/agents/transcript-extractor-frontier-v32.md`, whose PATH contains "frontier". If staging_v32's invocation passed that path to this script, the regex fired TRUE and the claude-rung was passed `{reasoning_effort:"low"}` — an OpenAI-shaped param, possibly consumed, possibly silently dropped by the Claude call adapter. AR-006 asserted the opposite branch (`{}`, "non-frontier path"). One of these readings is wrong, or staging_v32 was produced by a different script/invocation entirely. **The disagreement IS the alarm; resolve from artifacts, not from either reading:**
- (a) identify the EXACT invocation that produced `staging_v32` (script, command line, `phasebPath` value, MODEL value, call adapter) — from run logs, cache metadata, artifact stamps;
- (b) determine, per the engagement-evidence law, whether each passed param was CONSUMED by the adapter or passed-but-inert (an ignored param is recorded as "passed, inert — effective value = adapter default");
- (c) sweep ALL param surfaces of the certified path, not just PHASEB_PARAMS: Phase-A enumerator call params, Phase-B params, k=5, stability threshold, adapter identity/version.

**3. The record's shape:** one frozen doc enumerating EFFECTIVE params (consumed / passed-but-inert / absent-defaults) with per-value provenance (file:line + artifact evidence), plus the honest residual scope line (provider-side default drift; mitigated by model-id pin + the R-015 item-11 drift guard). The identity guard then asserts against the RECORD FILE at runtime — pointed-at, never copied — closing the last identity dimension.

**4. GO Module C in parallel.** The escalation blocks the token, not the build. R-017/R-018 pins stand for D–F.

---

## R-018 · 2026-07-16 · AR-004 pin RATIFIED (the seal-day reader is the CLAUDE certified rung) + AR-005 accepted; GO C→F

**1. AR-004's naming-trap pin — RATIFIED, and it closes a genuinely dangerous ambiguity I authored.** "frontier-v3.2" is a PROMPT-version name; the CERTIFIED reader is that prompt **on `claude-opus-4-8[1m]`** — the Claude rung, `staging_v32`'s producer, the instance every bar was measured on. R-015 item 1's phrase is hereby clarified: **seal-day `live_extract_fn` = the Claude certified rung exactly** (claude-opus-4-8[1m] + frontier-v3.2 prompt + enumerator-v1.2 + pinned params + k=5). The gpt-5.4 frontier vault is an uncertified candidate artifact — it never touches the twelve, and wiring it would have ALSO collapsed the cross-vendor grading line (gpt-5.4 grading gpt-5.4). 
**Orders:** (a) the identity guard as you proposed — the driver STAMPS reader-instance identity (model id + prompt SHA + enumerator SHA + params) on every artifact and ASSERTS it against the pinned identity, fail-closed on mismatch; (b) per the no-transcription law, the pinned identity is READ AT RUNTIME from the frozen claude-rung pre-reg/tag record (`efa377d6` lineage) — pointed-at, never copied into code; (c) a clarifying note lands in the ratify packet so no future reader inherits the ambiguity. The DLwVqc 2-vs-1 disagreement between vaults is CONSISTENT history (the v3.1 amendment recovered the merge-silenced short; the gpt-5.4 vault predates it and is a different brain) — no new alarm; the certified record is `staging_v32`.

**2. AR-005 accepted — Module B at Band 7 with the #1 risk disproven two ways, and two pieces of discipline noted with approval:** the landing hygiene (refusing to sweep the stray NOT-SAFE triple into a green commit) and the checkpoint choice (fresh context for Module D's adversarial leak-scan — the highest-scrutiny module deserves the sharpest eyes).

**3. GO: resume C→F** under the packet's module-by-module independent grading, R-017's two pins standing (D: adversarial leak-scan; F: both witnesses, both axes, rollup-on-mixed-video). Rehearsal panel verdicts reuse the cache (no new spend); live panels are seal-day. On F's independent grade: GREEN → stop → the one-line message.

---

## R-017 · 2026-07-16 · AR-003 ratified: Module A accepted at Band 8; PROCEED B→F with two pins

**Module A accepted.** The seal gate is the strongest-graded artifact of the campaign (Band 8 = top of the pre-live ceiling, correctly not exceeded — band 9 needs live evidence, per grading-integrity law). The renamed-copy rejection test and the same-wave closure of the thin-margin residual are noted with approval. R-016's no-hardcoded-hash law honored in full.

**Proceed to Modules B–F under the packet's module-by-module independent grading. Two pins:**
1. **Module D (human-blind two-stage rater layer):** the independent grader's mandate includes an ADVERSARIAL LEAK-SCAN — actively attempt to construct a packet leak (Stage-2 content inferable from Stage-1; strategy identity inferable from condition text; rater-to-rater leakage). Control items absorb from the frozen pilot shape; a rater whose controls fail contributes nothing, fail-closed.
2. **Module F (full-dress rehearsal):** BOTH standing witnesses thread through the complete driver — the R5L890 fused object (conflation axis must REJECT) AND the IyF re-promotion (enum axis must REJECT) — alongside the clean spent videos (must grade CLEAN). Both polarities, both axes, through the real end-to-end path, per standing law. The rehearsal's verdict math must also demonstrate the cert→video rollup on a video with ≥2 strategies where exactly one is clean (video must grade CLEAN via ≥1 rule).

Spend within the standing envelope as noted. Sealed sets untouched; no token exists. On Module F's independent grade: GREEN, stop, one-line message to the operator.

---

## R-016 · 2026-07-16 · AR-002 ruled: CONFLICT CONFIRMED — the advisor's hash was wrong; item 0 corrected; BUILD IS GO

**1. The correction, on the record:** sealed 12 = **`4d7b3c29`** (manifest `h1-wave6-sealed-fresh-set-2026-07-12.json` — the terminal-read target). **`8e39ffe1` is the SPENT pilot-16** — never the twelve. The 77 = `701c3edb`, unchanged. The error was MINE: it entered via the advisor's session summary, propagated into the R-014 standing state, R-015 item 0, and AR-001 — three documents carrying one wrong byte-string, caught only because R-015 ordered the diff against frozen bytes and you executed it against the bytes, not the narrative. Two-path derivation on a load-bearing pre-registration input: the disagreement IS the alarm, and this one would have pointed the once-only exam at already-spent videos or bricked it in a false-HALT. Standing state corrected below (annotated).

**2. Item 0 is superseded by your zero-transcription resolution — APPROVED and generalized as law:** the driver reads the manifest **from the frozen JSON artifact directly** (IDs + sha from `h1-wave6-sealed-fresh-set-2026-07-12.json`; nothing hardcoded), verifies live-fetched transcripts against it, and **REJECTS the spent-16 manifest** (`8e39ffe1` / `h1-sealed-fresh-set-2026-07-12.json`) by name. **LAW (standing): load-bearing identifiers are never hand-transcribed between documents or into code — consumers read the frozen artifact and verify at runtime.** My transcription error becomes structurally impossible for every future consumer that follows the pattern.

**3. Owed-detail absorptions — RATIFIED (frozen-outranks-consolidation, working exactly as instructed):**
- Item 5 absorbs the **two-stage tier-3 packet** verbatim from the pilot shape: Stage-1 blind role-from-quote committed BEFORE Stage-2 revealed-condition support ∈ {confirmed, partial, denied}, read-order locked, leak-scanned, control gates first.
- Item 6 absorbs the **cert→video rollup**: `terminal_read_clean_fraction` is per-certificate; the frozen bar is video-unit — a video is clean iff **≥1 of its strategies is certificate-grade** (pilot ADDENDUM 6) — rollup applied, then ≥60% across the twelve.

**4. Advisor-additions — all four RATIFIED as ruled mechanisms** (stricter economics rider; `SEAL-GO.token`; drift guard; mutation-test discipline).

**5. Supersession made conscious and durable:** the frontier pre-reg's A-packet-as-terminal-precondition clause (`h1-frontier-extractor-preregistration-2026-07-13.md:42`) is superseded by R-014/path-(d). Append a **dated supersession ADDENDUM** to that frozen doc (house pattern: addenda, never edits) pointing at R-014 + this ruling, so no future reader re-inherits the stale precondition.

**6. GO.** Build the driver to R-015 §6-CONSOLIDATED as corrected here — autonomous under independent grade, staged on spent videos, mutation-tested, `SEAL-GO.token` gate mechanical, run-on-12 operator-only. Everything else in R-015 stands.

---

## R-015 · 2026-07-16 · AR-001 ruled: the sealed-12 conductor DRIVER is a REQUIRED BUILD before GREEN — consolidated read-shape spec authored below; build to it verbatim
> **⚠ R-016 correction:** item 0's hash pairing below is WRONG (advisor transcription error) — sealed 12 = `4d7b3c29` via the frozen manifest file; `8e39ffe1` = the spent pilot-16. Superseded by R-016 §2 (driver reads the frozen artifact; no hardcoded hash). Preserved unedited as the audit trail.

**Answer to AR-001's question:** No — the dress rehearsal is NOT sufficient-for-GREEN. GREEN means: the operator says go and the machine can execute the read immediately, correctly, on the frozen shape. A green board over an unbuilt driver would be the premature-status disease at the worst possible address. The fence packet's own line-59 contract ("recorded honestly, not claimed done") and your search-verified finding settle it. The escalation itself was the honest-runway discipline working — R-014's runway was incomplete and you refused to inherit the gap silently. Credited.

**Answer to the second question:** the §6 shape exists as frozen LAW scattered across sources (Wave-6 §11 pre-commitment, pilot §5 rater shape, fence ratify-packet contract, R-014 standing state) but not as one verbatim build-spec. So it is authored HERE, consolidated. **Before building: diff this spec against those frozen sources — any conflict is a two-path alarm surfaced in AGENT-REPORTS before code.** The frozen sources outrank my consolidation.

### §6-CONSOLIDATED — sealed-12 terminal-read driver spec

0. **Seal verification first:** verify the sealed manifest (12 @ `8e39ffe1`, lineage `4d7b3c29`) — video IDs + transcript hashes match the sealed record. Any mismatch = HALT + escalate. No read.
1. **Extraction:** `h1-certified-reader-v3.2` @ `efa377d6` EXACTLY — enumerator-v1.2 Phase-A k=5 modal (stability ≥4/5; an UNSTABLE video routes to ONE blind adjudication to settle its count, charged to that video's economics rider, then proceeds) + frontier-v3.2 Phase-B single-draw + pinned params. Extractors persist their own outputs byte-exact (no hand-copying). All artifacts on disk before any grading.
2. **Mechanical floor:** band-8 locator anchor authority + F-2 content floor, every condition.
3. **Panels** (cross-vendor gpt-5.4, high effort pinned, flex/batch, mid-run hard-cap, budget pre-flighted — expected ~$0.30–0.60, within envelope): completeness grader-v3 (normativity law) + conflation axis + enum-consistency axis. Merged call permitted; calibration and fail-closed gating PER-AXIS; either structural verdict alone ⇒ not-clean.
4. **Certificate assembly:** `finalize_certificate` → `terminal_read_grade` with the semantic structural axes; NOT_EVALUATED / INDETERMINATE ≠ clean, fail-closed.
5. **Human-blind layer:** fresh clean-room conductor (fresh context; receives ONLY the driver runbook — no campaign history, no expectations) + two blind control-gated raters (controls first; target judgments count only if controls pass; raters blind to reader identity and to each other).
6. **Verdict math:** video-unit all-conditions-clean via `terminal_read_clean_fraction`; bar ≥60% of the 12; economics rider recorded (per-video adjudication load; aggregate mean ≤ ~15). Validity block BEFORE verdict (registration/engagement pre-checks, instrument SHA stamps, seal-verification record, epoch table). **Read ONCE** — computed once, from persisted artifacts.
7. **Independent re-verify:** fresh-eyes recomputation of the verdict from primary artifacts before it is reported (the 0.5-exam pattern).
8. **Scope lines carried verbatim on the verdict:** enumeration mis-packaging lower-bound 1/16 (design pool); variant re-promotion lower-bound 1/22 (axis armed at read); content axis measured at design-pool layer; result scoped to corpus + instrument SHAs + snapshot.
9. **Operator gate, MECHANICAL:** the driver REFUSES a sealed manifest unless the operator go-token exists (`docs/designs/SEAL-GO.token`, created by Tonio in his own words — the advisor never authors it). Staging/rehearsal mode accepts only spent-video manifests.
10. **Rehearsal = the DRIVER ITSELF, full-dress:** ≥3 spent videos (2DX, DLwVqc, R5L890) + the adversarial fused witness threaded through, exercising every stage — rehearsal-manifest hash verify, conductor spawn, control gates, panels, verdict math, re-verify. Independent grade with mutation-test discipline. Only after that: GREEN and the one-line message.
11. **Drift guard:** the driver pins the certified SHAs; any instrument-surface commit between green and read-day ⇒ re-run the witness pair before the seal breaks.

**Execution class:** instrument code — autonomous under independent grading, standard packet discipline. The RUN on the sealed 12 remains operator-trigger-only, mechanically enforced per item 9.

---

## R-014 · 2026-07-16 · Enumeration-consistency axis goes SEMANTIC (path-(d) parallel) — and the general law is minted

**Context:** independent grader ruled the mechanical enumeration-consistency lint NOT-SAFE (F-2: lexical key-match is paraphrase-bypassable — the IyF catch was a formatting accident; F-1: 7/22 genuinely exercised, headline over-stated). Advisor owns the original "cheap mechanical way" order as the same category error that killed the mechanical fence.

**LAW (minted, standing):** on prose-format artifacts, structural guarantees are SEMANTIC CROSS-VENDOR checks. Mechanical/lexical checks are reserved for structured formats (compiled specs — the H2 layer) where their signal natively exists. No future axis re-litigates this.

**Build spec:**
1. Semantic enumeration-consistency check, gpt-5.4 cross-vendor, per variant: "does this re-promote a setup the certified enumeration excluded as a mention?" — judged against the exclusion log's DESCRIPTIONS + SOURCE QUOTES, never key strings. Verify enumeration artifacts carry each mention's content; where only keys exist, pull source quotes from the enumeration record BEFORE arming.
2. Both-polarity calibration before it counts: IyF's re-promoted breakdown must FAIL; a clean legitimate variant must PASS. Inherited guards: the polarity pair rides every future version; toward-clean refinements get strictest treatment (adjudicator-validated, generically worded); persisted artifacts are the record — recomputable by anyone.
3. Implementation freedom: MAY merge with the conflation check into one per-strategy panel call (two independent verdict fields) — but calibration and fail-closed gating stay PER-AXIS; either verdict alone ⇒ not-clean.
4. F-1 honesty fix rides along: coverage reporting states exercised-vs-vacuous per the claim-scoping law.
5. Pennies on panel infra — covered by the standing envelope, no new ticket. Independent grade mandatory; axis stays NOT-SAFE until the calibrated semantic version proves both polarities through the REAL harness.

**Runway after this lands:** dress rehearsal completes on the three spent videos (2DX, DLwVqc, R5L890) incl. the adversarial fused-witness run through the real exam room → checklist GREEN → machine STOPS → operator gets the one-line message: "Everything's green. Say go."

---

## Standing state (as of R-014)

- **Certified reader:** `h1-certified-reader-v3.2` @ `efa377d6` — frontier-v3.2 + enumerator-v1.2 + claude-opus-4-8[1m] + pinned params + k=5 + grader-v3. FROZEN. Joint bar cleared: grounding 4.40% ≤ 8%, content 22/22 (2DX-s2 ruled grader over-reach from source; normativity test = grader law, founding fixture 2DX-s2).
- **Conflation check (merge-silencing axis):** BUILT + calibrated both polarities (R5L890-fused REJECT / -igp mirror PASS / IyF PASS v1.1) + retro-22 = 22/22 measured clean from persisted artifacts (v1 archived as false-positive audit trail). Wiring landed (Band 6 SAFE, no test-gutting): conflation verdict is the load-bearing structural axis in terminal_read_grade, fail-closed; the 3 mechanical lints re-stationed to the H2 compiled-spec layer; A-packet reverted to its original H2-battery charter — OFF the terminal-read critical path.
- **Enumeration-consistency axis:** NOT-SAFE pending R-014 semantic rebuild. The one item between here and green.
- **Pre-seal checklist:** hard-cap guard DONE (class-swept, all metered paths); harness invoke + rehearsal IN FLIGHT (blocked only on R-014); seal-break = OPERATOR ONLY.
- **Scope lines carried on any terminal verdict:** enumeration mis-packaging lower-bound (1/16 design pool); variant re-promotion lower-bound (1/22, axis armed at read); content axis measured at design-pool layer.
- **Sealed sets (corrected per R-016):** 12 = **`4d7b3c29`** via frozen manifest `h1-wave6-sealed-fresh-set-2026-07-12.json` (consumers read the artifact, never copy the hash); `8e39ffe1` = the SPENT pilot-16, never the twelve; 77 = `701c3edb`. PRISTINE. Read ONCE, frozen shape: fresh clean-room conductor, two blind control-gated two-stage raters, cert→video rollup (video clean iff ≥1 strategy certificate-grade), ≥60% across the 12, economics rider.
- **Ladder standing:** terra + sol understudies (birth gates ~¢50 combined, batch/flex half-price; sol replaced 5.5 as dominated). gpt-5.4 = chief independent auditor (completeness panel + conflation/enum-consistency axes + production day-jobs). Batch/flex-first for all non-interactive OpenAI work.
- **Money:** balance ≈ $4.90; total campaign paid spend to date ≈ $2.5. Governor: token wall (free tiers, full-weight) + dollar-truth layer (Costs API, operator-anchored starting balance) + mid-run hard-caps + per-task tickets + standing envelope above.
