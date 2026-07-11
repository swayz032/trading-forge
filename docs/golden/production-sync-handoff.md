# Production-Sync Handoff — extraction subsystem + golden verification

> **Status:** HANDOFF (2026-06-28). The architecture/instrumentation phase is complete; the project is now in
> the validation phase. The bottleneck is no longer "can this be built" — it's "what does it do under
> controlled evaluation." This doc is the engineering handoff for priority #1 (production synchronization),
> scoped so it's judged by **observable behavior**, not by "did we copy the right files."

## The diagnosis (confirmed, not suspected)

- The production backend `:4000` runs branch **`hardening/phase-0`** (the other agent's branch) via `tsx` — NOT a stale dist, NOT the verified extraction branch.
- That branch's `extraction-coverage-gate.ts` + `extraction-coverage-repair.ts` have **0 occurrences of the `schemaOverride` fix** (verified branch has it). That single missing fix is why fresh transcripts return **0 speaker-items** (the enumerator GBNF-locks Gemma to the wrong schema → coverage falls to the self-evident heuristic).
- Confirmed on a frozen rig (`:4099`, verified branch, drift=NONE): same model, same transcripts, current code → **7/7/10/22 speaker-items** vs `:4000`'s **0/0/0/0**. Stale-branch, not model weakness.

## The targeted sync (low-risk — NOT a 139-commit merge)

The branches are **77 ahead / 62 behind**, merge-base 4 days old — a full merge is conflict-prone and unnecessary.
The production-relevant delta is **self-contained**:

| File | Δ | Why |
|---|---|---|
| `src/server/lib/extraction-coverage-gate.ts` | +304 | the `schemaOverride` enumerator fix + comparator-precision folds |
| `src/server/lib/extraction-coverage-repair.ts` | +68 | the `schemaOverride` repair-loop fix (recovery was silently dead without it) |
| `src/server/services/direct-bucket-graduator.ts` | ±27 | graduator routing — **shared file; review carefully** (the other agent may also have touched it) |

**The 74 commits of fidelity-compiler / state-machine-IR / freeze-harness work are STANDALONE (zero production
wiring) and do NOT need to reach production to validate extraction.** Port the extraction subsystem only.

> This is a coordination decision with the owner of `hardening/phase-0` — not a unilateral merge. Port via
> cherry-pick or file-level port, then run the acceptance test below. Do not judge success by the port itself.

## Acceptance criteria — judged by behavior (run BEFORE replay)

`VERIFY_API=http://localhost:4000 npx tsx scripts/verify-extraction-golden.ts`
(golden reference: `docs/golden/extraction-golden-2026-06-28.json`, captured from the verified branch @ `:4099`)

| Layer | Acceptance criterion |
|---|---|
| **Grounding** | input transcript matches the golden sha (same known inputs) |
| **Extraction** | fresh transcript produces **non-zero speaker-items** (the regression signature; was 0) + ideas count matches golden |
| **Coverage** | speaker-items within ±40% of golden + coverage verdict matches golden (schema override is active where expected) |
| **Regression** | existing production extraction tests remain green (`npx vitest run` extraction suites) |
| **Grounding invariants** | `validateGrounding` still 100% on the synced outputs (no paraphrase leak re-entered) |

Golden behavior the synced path must reproduce (the 4 known-failing inputs):

| video | speaker_items | coverage | confirmation |
|---|---|---|---|
| psH--oXkD8M | 7 | pass | no-compound (`confirmation_no_level`) |
| l-2iKbcm5UI | 7 | coverage_failed | span-bound |
| h6TnE7QClJg | 10 | pass | no-compound (`confirmation_would_overfire`) |
| MKsjbL0WNjg | 22 | pass | span-bound |

## The validation sequence (each stage answers a different question)

1. **Synchronize** the targeted extraction subsystem onto the production branch.
2. **Golden extraction verification (Gate 1)** — `verify-extraction-golden.ts` green against `:4000` → the
   synced path behaves like the verified branch on KNOWN inputs. *(Cheap. Do before spending replay compute.)*
   Run BOTH validations here: **Validation A = Gate 1 (parity)** and **Validation B = Gate 1.5 (semantic
   determinism — `scoreDeterminism`)**. Gate 1 proves format-parity; Gate 1.5 proves the IR is executable by a
   dumb engine (0 MISSING + 0 AMBIGUOUS on extraction-owned fields). A strategy can pass Gate 1 and FAIL
   Gate 1.5 (e.g. confirmation never compiled → no executable trigger) — that's exactly the case 1.5 exists
   to catch.
3. **Replay (Gate 2)** — run the compiled IR against real OHLC for educator-demonstrated trades → first
   evidence about BEHAVIOR rather than structure. Gated on engine-attach + stable supervisor (W4.2).
4. **Blind validation (Gate 3)** — the unseen-corpus generalization test → does it hold across educators/styles.

If a stage fails, the boundary that introduced it is unambiguous — that's the point of separating them.

## Explicitly deferred (but correctly classified)

The two confirmation-compiler quarantines (`confirmation_no_level` — engulf-at-retest needs level
association; `confirmation_would_overfire` — indicator-confirmation threshold) are a **Known P1 semantic
defect — quarantined by protocol, NOT "optimization."** They are a deterministic defect class: 2/2 failures,
same subsystem, same symptom (`entry_trigger MISSING` → not backtestable per Gate 1.5). We do not fix them yet
**only because the protocol forbids tuning before replay** — not because they're a nice-to-have. They earn an
active fix the moment replay confirms they account for a material fraction of fidelity mismatches. The
discipline being held is "no tuning before replay," not "this isn't a real defect."

## Methodology note — manual is a hypothesis, not ground truth

The dual-extraction comparison must hold both annotators to the SAME bar: `transcript = evidence`,
`manual = hypothesis`, `compiler = hypothesis`, `replay = downstream validation`. `freeze-harness.ts`
already supports this (`manual_quote_in_transcript` is a computed input, transcript-anchored) — the
discipline is to **compute** `groundQuote(manual_phrase, transcript)`, never assert it. Applied per-run, not
built as new infra.
