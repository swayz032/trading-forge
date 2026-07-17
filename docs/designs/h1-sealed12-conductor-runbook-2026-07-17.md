# H1 SEALED-12 TERMINAL-READ — CONDUCTOR RUNBOOK (2026-07-17)

> **STATUS: DRAFT for advisor ratification** (R-023.1). Frozen once ratified (R-024) + runbook-rehearsed (R-023.1c). This is the ONLY document the seal-day clean-room conductor receives. It is self-contained on purpose.

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

## STEP 1 — INVOKE THE DRIVER
Run the driver CLI:
- **Sealed read (token present):** `python scripts/h1_seal_conductor_cli.py --mode sealed`
- **Staging rehearsal (no token, spent videos):** `python scripts/h1_seal_conductor_cli.py --mode staging`

The CLI pins the sealed-12 manifest (`docs/designs/h1-wave6-sealed-fresh-set-2026-07-12.json`, read from disk — never typed), verifies the seal, and drives the pipeline. It will tell you, per video, when it needs a live EXTRACTION or a live RATER judgment (sealed mode only — staging is fully cached).

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

*Runbook DRAFT authored 2026-07-17 by the working agent under R-023.1a; awaiting advisor ratification (R-024) + a staging runbook-rehearsal by a fresh clean-room conductor (R-023.1c) before it is frozen.*
