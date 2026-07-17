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
