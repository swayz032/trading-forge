# H1 CERTIFIED READER v3.2 — EFFECTIVE PARAMS RECORD (2026-07-16)

> **STATUS: FROZEN (ratified R-021, 2026-07-16).** This is the record R-019 required before `SEAL-GO.token`. The identity guard asserts what exists at runtime (model, prompt SHAs, k, channel class — from the DISPATCH record per R-021.2, self-report as corroboration only); this record documents the rest with provenance.
>
> Authority: ADVISOR-RULINGS R-019 (record required) + R-020 (effective table ratified, seal-day = Option A). Forensic basis: AGENT-REPORTS AR-007.

## 0. THE TRUE ACTOR (R-020.1 correction, on the record)
`claude-rung-designpool/staging_v32` was produced by **fresh-context Claude subagents on the Claude subscription channel** (Claude Code dispatch from the working session; each extractor subagent wrote its own artifact byte-exact, per the byte-exactness law). It was **NOT** produced by: the operator hand-typing (the operator extracted nothing); any Claude API call (no `@anthropic-ai/sdk` / `new Anthropic(` / `claude-opus-4-8`-as-code anywhere in the repo — 0 grep hits); or `scripts/h1-frontier-designpool.ts` (that is the separate **gpt-5.4** OpenAI candidate — `MODEL="gpt-5.4"`, `new OpenAI(...)` — writing to `frontier-designpool/`, an uncertified vault, never `staging_v32`). Merge step: `scripts/h1_claude_merge_vault_v32.py` (pure JSON normalization, zero network).

## 1. EFFECTIVE PARAMS — Phase-A (enumeration)
| param | effective value | consumed/inert/absent | provenance |
|---|---|---|---|
| model | `claude-opus-4-8[1m]` | consumed | pre-reg `h1-claude-rung-preregistration-2026-07-13.md` PIN3 ("Model ID frozen"); `claude-rung/BIRTH-GATE-k5-PASS.md:1` |
| enumerator prompt | `src/agents/strategy-enumerator.md` (enumerator-v1.2), as-frozen | consumed | `BIRTH-GATE-k5-PASS.md:1`; guard asserts its sha256 |
| k (draws) | **5** | consumed (run + tabulated) | `claude-rung/POOL-PHASE-A-k5-v3.1.md:3`; pre-reg PIN3 |
| stability threshold | mode ≥ **4/5** (unstable → 1 blind adjudication) | consumed (gated DLwVqc) | `POOL-PHASE-A-k5-v3.1.md:3` |
| context | fresh-context, blind per draw | consumed | `claude-rung/BIRTH-DRAW1.md:3` |
| generation knobs (temperature/top_p/max_tokens/reasoning_effort) | **ABSENT / UNRECORDED** — no API call existed to carry them | absent | grep 0 hits; §0 above |
| channel | Claude subscription (Claude Code runtime), $0 | consumed | pre-reg PIN4; `BIRTH-GATE-k5-PASS.md:17` |

## 2. EFFECTIVE PARAMS — Phase-B (extraction)
| param | effective value | consumed/inert/absent | provenance |
|---|---|---|---|
| model | `claude-opus-4-8[1m]` | consumed | R-018 (`ADVISOR-RULINGS.md:32`); pre-reg PIN3 |
| extractor prompt | `src/agents/transcript-extractor-frontier-v32.md` (frontier-v3.2) | consumed | R-018; guard asserts its sha256 |
| draws | single-draw (k=1) | consumed | pre-reg PIN3 |
| `reasoning_effort` | **ABSENT** (never in this rung's param space — the only `{reasoning_effort:"low"}` is `h1-frontier-designpool.ts:78`, gated on the OpenAI/gpt-5.4 path, writing elsewhere) | absent | AR-007; §0 |
| generation knobs | **ABSENT / UNRECORDED** | absent | §0 |
| channel | Claude subscription, $0 | consumed | pre-reg PIN4 |
| persistence | subagent byte-exact write → `staging_v32/{vid}__s{id}.json` → merged (`h1_claude_merge_vault_v32.py`, no network) | consumed | `claude-rung/PHASE-B-EXTRACTION-COMPLETE.md:14-16` |

**Downstream, NOT a reader param (flagged to prevent re-conflation):** `scripts/h1_build_content_batch_v32.py:43-45` sets gpt-5.4 `reasoning_effort:"high"` — that is the content-preservation GRADER scoring the completed extraction, temporally/functionally downstream of Phase-B, never an extraction param.

## 3. RESIDUAL — BOUNDED (R-020.2a)
The generation knobs are unrecorded, but **unrecorded ≠ uncontrolled.** The joint bar (grounding 4.40% ≤ 8%, content 22/22) and the k=5 stability numbers were all measured on outputs produced under **these same unrecorded channel defaults.** The certification is therefore of the reader's **behavior under this channel's defaults** — so seal-day fidelity requires **CHANNEL-match** (subscription-channel Claude Code runtime + frozen prompts + k protocol), NOT enumeration of knobs that never existed. Sampling variance is not ignored: **k=5 modal consensus was built precisely to absorb it.** Residual scope line carried on any terminal verdict: *provider-side default drift between certification and seal-day (mitigated by the model-id + prompt-SHA + channel-class identity pins and the R-015 item-11 drift guard); interface sub-detail per §4.*

## 4. INTERFACE PROVENANCE (R-020.2b)
Resolved as far as artifacts allow: the design-pool extractions were **Claude Code subagent dispatches on the subscription channel** ("Re-dispatch … extractions", `PHASE-B-EXTRACTION-COMPLETE.md:16`). The exact sub-interface at design-pool time (claude.ai web vs Claude Code CLI vs console) is named in no artifact → recorded **UNRESOLVED** honestly, and it does not affect the effective params (no artifact shows a consumed extraction-time knob under any interface). **Seal-day is pinned tighter than the certification was:** subscription-channel Claude Code runtime — interactive dispatch OR headless `claude -p` (stored-credential non-interactive), both the same subscription runtime; the run log records which. **Never the API for this read** (R-020.3).

## 5. WHAT THE GUARD ASSERTS vs WHAT THIS DOCUMENTS
- **Identity guard (runtime, fail-closed):** model_id, Phase-A/Phase-B prompt SHAs, k, **channel-class = subscription** — asserted against this record read at runtime (pointed-at, never copied). A seal-day reader self-reporting a different model / prompt / channel (e.g. API) ⇒ HALT.
- **This record (documentation):** the effective table, the absence of API knobs, the bounded-residual rationale, the interface provenance.

## 6. SEAL-DAY BINDING (R-020.3, Option A)
The conductor orchestrates seal-day extraction identically to the design pool: fresh-context Claude subagents on the subscription channel, frozen prompts (SHAs guarded), k=5 Phase-A protocol (stability ≥4/5, unstable→1 blind adjudication), single-draw Phase-B, extractors writing artifacts byte-exact; the driver ingests, identity-stamps, and asserts (Module B seam). Operator hand-types nothing; his only seal-day keystroke is authoring `SEAL-GO.token`. **API-Claude is REJECTED** (unmeasured instrument change on a once-only read).

*Draft authored 2026-07-16 by the working agent under R-020.2; awaiting advisor ratification (R-021). Values verified from disk per the no-transcription discipline; provenance cited inline.*
