# Dispatch-wrapper params-record addendum — R-030 §2(d)/§3 (2026-07-17)

> Companion to `h1-certified-reader-effective-params-2026-07-16.md`. Records the
> seal-day DISPATCH WRAPPER (declared instrument-surface by R-030 §2(d)) and the
> no-tools blind invocation (R-030 §3, option (i)). The frozen certified prompts
> (enumerator / frontier) are UNCHANGED — their SHAs remain the identity-guarded
> instruments. This addendum records only the FORMAT wrapper the CLI composes around
> them + the invocation, both of which enter the re-grade mutation scope.

## 1. The dispatch wrapper (FORMAT-only, identical across every dispatch of every seam)

`_WRAPPER_VERSION = "r030-dispatch-wrapper-v1"` (in `scripts/h1_seal_conductor_cli.py`).
The user prompt = wrapper header + a fenced source block; the ONLY per-dispatch
variable is the embedded source (transcript body, or rater-packet JSON). Verbatim:

```
Follow the specification EXACTLY — it is provided in the system prompt above
and/or embedded in the source material below. Between the markers below is the
COMPLETE and ONLY source material for this task. You have no tools and no file
access: use nothing but the text between the markers — do not consult any cached
result, prior answer, or external file.

OUTPUT CONTRACT (format only — it does not change the specification): print ONLY
the single JSON object the specification requires. No preamble, no explanation,
no markdown code fences, no text before or after the JSON.

===== BEGIN SOURCE MATERIAL =====
<the CLI-embedded transcript body, or the emitted rater packet JSON>
===== END SOURCE MATERIAL =====
```

This is FORMAT/output-contract text ONLY — it carries no content or judgment guidance
about HOW to extract or rate (that lives entirely in the frozen system prompt for
Phase-A/Phase-B, and in the emitted packet's own `instructions` for raters).

## 2. The blind invocation (no tools; content embedded; prompt via stdin)

Per dispatch the CLI runs (argv, no shell):

```
claude -p --model <frozen model_id> --tools ""  [--append-system-prompt <frozen prompt text>]
        <user prompt via STDIN>
```

- `--tools ""` = PHYSICAL blindness: the subagent has NO tools, so it cannot open the
  transcript path, a cached prior answer, the manifest, or any file. **Verified live
  2026-07-17:** a `--tools ""` subagent asked to read a planted secret file returned
  `NOTOOLS_CONFIRMED` (physically could not read it).
- The **user prompt is passed via STDIN**, not as a positional argv element, because
  `--tools` is variadic (`<tools...>`) and would otherwise consume a trailing
  positional prompt as a tool name. (Verified: positional prompt → "Input must be
  provided…"; stdin prompt → clean output.)
- `--append-system-prompt` carries the FROZEN certified prompt CONTENT (read from
  disk by the CLI) for Phase-A (enumerator) / Phase-B (frontier); OMITTED for raters
  (the emitted packet carries its own `instructions`).
- The model id is read at runtime from the frozen identity record — never hardcoded.

## 3. Format-retry semantics (R-030 §2)

- SOLE mechanical trigger: `RawJsonNonCompliant` (a strict PARSE failure). NEVER a
  property of a successfully-parsed object (a well-formed-but-wrong-schema raw HALTs
  via `DispatchWrapShapeError`, un-retried).
- Cap: initial + 2 = 3 attempts. Exhausted ⇒ HALT NON-COMPLIANT (advisor adjudicates).
- Every attempt indexed under `attempts/<key>.json`; non-compliant raws MOVED to
  `quarantine/<key>/attempt_N.txt` — persisted, never ingested, never re-read.
- The run-total retry count is REPORTED in the verdict (`dispatch_health.total_format_retries`)
  and NEVER moves `meets_bar`/`verdict` (throughput signal, not the bar).

## 4. Design-pool tool-surface forensic (R-030 §5) — SCOPE LINE

The certified design-pool extractions (`claude-rung-designpool/staging_v32`) were
fresh-context Claude Code subagents on the subscription channel, and **each extractor
subagent WROTE its own artifact byte-exact** — i.e. it held the Write tool, so it was
NOT a no-tools dispatch. The exact sub-interface + full tool surface at design-pool
time is **named in no artifact** (`h1-certified-reader-effective-params-2026-07-16.md`
line 38: recorded UNRESOLVED). Therefore, per R-030 §5, the honest scope line:

> **Design-pool draws' tool surface is unrecorded (and was at least Write-capable);
> the seal-day read runs strictly TIGHTER — physical no-tools, CLI-embedded content.**

The certification STANDS either way (R-030 §5): the joint-bar fidelity grades
output-vs-transcript (peek-independent), and seal-day-tighter-than-certification is
direction-safe — a legitimate tightening pushes toward fail, never toward false-pass
(same reasoning as R-020's channel-match). This is a scope line, NOT a re-certification.

## 5. Rater dispatch — TWO sequential stage-scoped dispatches per rater (R-031)

The R-030 §4 live micro-rehearsal surfaced that the emitted rater packet was NOT
self-describing and that a SINGLE dispatch embedding the whole packet put BOTH
`stage1_view` and `stage2_items` in one prompt — breaking the two-stage read-order
lock. R-031 ruled option (a) (the packet carries its contract) + a mandatory split.
Seal-day rater dispatch is therefore:

- **The packet carries its own `output_contract`** (`build_rater_packets`,
  `_rater_output_contract`): per stage, the answer-store shape + the allowed closed-
  taxonomy values + the commitment discipline. Values are **DERIVED, never retyped** —
  roles from the packet's own `closed_taxonomy` keys; support from
  `pilot_conveyor.SUPPORT_VALUES` (the exact set `support_verdict_from_stage2_response`
  accepts, pilot_conveyor.py:1382/1408). Shape + values + commitment ONLY — no judging
  criteria (those are the frozen `stage1_view.instructions` already in the packet).
- **Two sequential no-tools dispatches per rater** (`--dispatch rater --rater-id <A|B>
  --rater-stage stage1` THEN `--rater-stage stage2`):
  - **Stage-1** embeds `stage1_view` (blind — no revealed conditions) + the stage1
    contract ONLY; the CLI's `_seam_source_text` PHYSICALLY EXCLUDES `stage2_items`
    from the prompt, so the blind role read cannot see the extractor's conditions.
    Produces `{"stage1": {item_id: role}}`.
  - **Stage-2** embeds the revealed `stage2_items` + the stage2 contract; produces
    `{"stage2": {item_id: {support, support_justification}}}`.
  - The two are MERGED into `raters/<id>.json`. Fresh-context Stage-2 is strictly
    TIGHTER than the pilot's same-session reveal — a committed Stage-1 answer cannot
    leak forward into the role read.
- **Out-of-vocabulary HALTs, never coerces** (`_wrap_rater_parsed` +
  `_rater_allowed_values`): a role/support outside the packet contract's allowed set,
  or a blank Stage-2 `support_justification`, HALTs the dispatch fail-closed. The
  allowed set is read from the EMITTED packet's own contract (single-sourced).
- **Live-verified 2026-07-17** on spent 2DXQqwKSwJE (never the twelve): rater A
  stage1 ingested 38 roles + stage2 ingested 28 support judgments, both stages
  stage-scoped, 0 format-retries, guards passing.

## 6. Live-found seal-day invocation fixes (R-030 §4)

The micro-rehearsal caught two Windows/subprocess integration issues stubbed tests
can't: (1) `_run_claude_p` unsets `CLAUDECODE` (a bare `claude -p` refuses to launch
nested in a Claude Code session); (2) `run_dispatch` writes `dispatch_record.json`
itself (the phase_a/certify/verdict identity guards require it — R-030 §3).
