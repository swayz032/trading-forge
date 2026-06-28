# Session Briefing — 2026-06-28 (project state, not casual notes)

Versioned because this is project state, not chat. Future-you (esp. post-Gate-2 regression debugging) will want it.

## What the system is
YouTube trading videos → **executable, backtestable** strategies. Pipeline:
`transcript → extraction (Gemma 4:e2b, local) → Strategy IR → executable rules → backtest/replay`.
**Two-stage DSL (load-bearing):** extraction owns the ENTRY EDGE only; `framework-overlay` is authoritative
for stop/TP/sizing. (Educators are bad at specifying risk; forcing extraction to own it would make the golden
noisy. Framework-owns-risk reduces variance. Confirmed correct.) All fidelity machinery is standalone — **zero
production wiring** by invariant.

## The reframe this session
From *"can we extract strategies?"* → *"can the extracted strategy be executed with identical trading
semantics to what the educator taught?"* This is a **compiler-correctness** problem, not a summarization
problem. Extraction quality is no longer one number — it decomposes into independent properties:
**Coverage** (every concept captured) · **Faithfulness** (every field span-grounded) · **Determinism**
(another computer can execute it) · **Replay fidelity** (execution matches what the educator traded) ·
**Generalization** (holds on unseen educators).

## What we did (chronological)
1. Operator dropped 4 unseen videos + "extract them yourself, compare to Gemma."
2. **Dual extraction.** Manual read found confirmation linguistically stated in all 4 → "confirmation grounds
   poorly" is **corpus-conditional** (old corpus was ICT-heavy; rule/indicator educators linguify it).
3. **Operator correction: the comparison was confounded.** `:4000` returned 0 items + dropped mid-run.
4. **Hard-freeze harness** (`freeze-harness.ts`): hash-locks model+transcripts+backend commit; classifier
   enforces attribution order `VERSION_INCONSISTENCY → EXECUTION_DROP → SPAN_FAILURE → INFERENCE_DISAGREEMENT`
   (no semantic blame for infra failures). Added running-commit to `/api/health` (was `version:"dev"`).
5. **Root cause = branch divergence.** `:4000` runs another agent's branch (`hardening/phase-0`) lacking the
   `schemaOverride` extraction fix → 0 items. Stale branch, not model weakness.
6. **Controlled re-run** (isolated `:4099`, verified branch, freeze drift=NONE): 7/7/10/22 speaker-items vs
   `:4000`'s 0/0/0/0. "Gemma missed it" formally retracted (it was EXECUTION_DROP).
7. **Maximal-span-capture fix** (lowering): binds confirmation to the longest verbatim run when paraphrased →
   2/4 `INFERENCE_DISAGREEMENT → AGREE`. Other 2 = a different layer (confirmation-compiler quarantine).
8. **Froze the validation protocol** (operator signed off: Gate-3 independence, stopping rule, no fancy stats).
9. **Gate 1.5 (semantic determinism)** added — executability, not just parity.
10. **Gate 1.75 (extraction completeness) + evidence_mode** added (this turn, per GPT's push).
11. Pre-sync baseline recorded (`:4000` 0/4, labeled NOT validation). Rig processes cleaned up.

## The frozen validation protocol (`validation-preregistration.md` — SIGNED OFF, amendment-logged)
| Gate | Question | PASS |
|---|---|---|
| **1 Golden verify** | does synced prod reproduce verified branch on known inputs? | non-zero items, within ±40%, coverage/ideas match, grounding 100%, tests green |
| **1.5 Semantic determinism** | can a dumb engine run the IR with no human? | 0 MISSING + 0 AMBIGUOUS on extraction-owned fields (stop/tp/risk = FRAMEWORK_OWNED) |
| **1.75 Extraction completeness** | did we capture every educator DECISION (rules, not explanations)? | 0 Missed + 0 Hallucinated decision-rules |
| **2 Replay parity** | does the IR reproduce demonstrated entries on real OHLC? | ≥70% entries reproduced (±3 bars, 0.5×ATR); exits excluded; <10 = INDETERMINATE |
| **3 Blind generalization** | holds on unseen educators? | blind ≥70% AND gap ≤15pp AND edge not STRUCTURAL_SIGNAL_SUSPECT/INFERENCE_NOISE |

**Stopping rule:** first failing gate sets overall status; later gates diagnostic-only. **Anti-goalpost:**
thresholds frozen; changes are dated amendments made before results. **Reporting format (frozen):** observed →
gate outcome → localization → interpretation → next experiment. **Executable-IR invariant:** every
extraction-owned node is PRESENT or FRAMEWORK_OWNED — never AMBIGUOUS, never MISSING.

## Known failure classes (with forecast — GPT + diagnostics)
| source | status | future frequency |
|---|---|---|
| stale branch | root-caused; fixed by sync | ~0% post-sync |
| schema issues | fixed on verified branch | low |
| **confirmation-compiler quarantine** | **Known P1 semantic defect — quarantined by protocol (no fix before replay)** — NOT "optimization": 2/2 same subsystem, same symptom (`entry_trigger MISSING`), deterministic | medium |
| **visual grounding debt** | NEW — measured by `evidence_mode`; the predicted dominant boundary after sync | **high** |

## Diagnostics on the 4 frozen IRs (NOT validation)
| video | strategy | Gate 1.5 | evidence_mode |
|---|---|---|---|
| psH | 15m ORB+retest | FAIL (entry_trigger MISSING) | TRANSCRIPT_ONLY |
| l-2 | 4-confluence MTF ICT | PASS | **VISUAL_REQUIRED** |
| h6T | EMA+CCI crossover | FAIL (entry_trigger MISSING) | TRANSCRIPT_ONLY |
| MKsjbL | two-line time-based | PASS | **VISUAL_REQUIRED** |

Gate 1.5 catches what Gate 1 (parity) cannot (psH/h6T not backtestable). evidence_mode flags l-2/MKsjbL as
chart-dependent — replay misses there may be visual-data debt, not bad strategy.

## Forecast for the gates (GPT, recorded for later check)
Gate 1 PASS (high conf — stale branch was the cause) · Gate 1.5 2-PASS/2-FAIL (unless sync includes
confirmation fixes) · **Gate 2 = first likely hard failure** (visual ambiguity / overbroad confirmation /
invalidation drift). Recorded so the actual result can be compared to the prediction.

## Current state (honest)
- Engineering/instrumentation: ~90–95%, mature. Semantic executability: ~7.5/10 (the 2 quarantines).
- **Empirical proof: ~0–5%.** Replay + blind have NOT run; prerequisites don't exist yet.
- No longer blocked by *design* — blocked by missing **data paths**: production sync, engine-attach, blind corpus.

## Next milestones (none are "build more compiler")
1. **Production sync** (highest leverage): port the verified extraction subsystem (~2–3 files; `schemaOverride`)
   onto `hardening/phase-0` — coordination call, NOT a 139-commit merge; standalone architecture stays out.
2. After sync: Gate 1 (`verify-extraction-golden.ts`) + Gate 1.5 (`scoreDeterminism`) + Gate 1.75 + `evidence_mode`.
3. Gate 2 (replay) once engine-attach exists. 4. Gate 3 (blind).
- **Deferred (P1, not optimization):** the 2 confirmation-compiler quarantines — fixed only if replay confirms material impact (protocol: no tuning before replay).

## Validation target (corrected)
NOT "100% textual extraction." **100% semantic executability for all extraction-owned rules, every rule
grounded to transcript evidence, no missing decision points, no hallucinated rules.** Superficial wording
differences don't matter if the engine executes the strategy exactly as taught.
