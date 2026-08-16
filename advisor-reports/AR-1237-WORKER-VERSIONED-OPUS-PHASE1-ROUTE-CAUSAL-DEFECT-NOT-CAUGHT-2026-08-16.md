# AR-1237 (WORKER) — AR-1236 §10 VERSIONED OPUS PHASE-1 ROUTE · 2026-08-16

```text
RULING : AR-1236 §10 (versioned Opus Phase-1 / Lane-G integration)
PIN    : branch claude/worker1-h1-20260815 · head 954d799916c543b497ed2459f321d56c4c69ff79
         lane commit 4ea19c38 · parent 8ab08cf9 (the AR-1235 head you graded)
STOP   : none fired
NEXT   : your call on the ONE §10.7 defect that is NOT caught, and on the guard gap behind it
```

---

## 0. PRE-FLIGHT (seven questions, before code)

1. **SCOPE** — §10's twelve requirements. New route module + tests + a driver subcommand + new
   versioned artifacts. No compiler, backtester, PAPER, broker or live surface.
2. **STOP** — Worker-2 scope · shared-file collision · invented source semantics · any write at
   the historical red Phase-1/certificate.
3. **PROHIBITED** — building another locator/relevance/report framework (§10 fast-path rule) ·
   mutating the historical red artifact into green · certifying on "Opus said it" · silently
   deduplicating a duplicate role.
4. **REQUIRED PROOFS** — the twelve §10 requirements, on the real pinned slice. No independent
   grade is required by this ruling, so §11c's pre-authorised dispatch does not fire.
5. **MEASURED REPO STATE** `[MEASURED HERE]` — all nine components §10 says to reuse exist:
   `h1_pilot_phase1` · `pilot_conveyor` · `evidence_relevance` · `source_fidelity_guard` ·
   `evidence_antecedent` · `span_collision` · `cert_assembler` · `batch_locator` ·
   `anchor_locator`. `system_inventory.py --check` exit 0 (map fresh).
6. **ALREADY LANDED?** — no orchestrator wiring these in sequence existed. The route is the
   missing seam, not a new framework.
7. **METRIC/GRADE MIX** — §10 is mechanical throughout; no self-grading is requested and none is
   emitted. `ACCEPTED_PENDING_CERTIFICATION` is explicitly not a certificate.

---

## 1. WHAT WAS BUILT — A SEAM, NOT A FRAMEWORK

```text
NEW  src/engine/extraction/opus_phase1_route.py    orchestrator; owns NO gate of its own
NEW  src/engine/tests/test_opus_phase1_route.py    15 tests, order + closure
EDIT scripts/svkm_opus_batch_locator.py            `route` subcommand
NEW  docs/replay-results/.../grade/opus-v2/        3 versioned artifacts
```

```text
batch Opus map (raw preserved upstream)
  -> literal fence        anchor_locator._verify_and_locate   [by import]
  -> collision HOLD       span_collision.adjudicate_locations [by import, BEFORE acceptance]
  -> relevance            evidence_relevance                  [by import, only approvals continue]
  -> fidelity             source_fidelity_guard               [by import, approved evidence only]
  -> isolated escalation  held / unresolved only
  -> fail closed          one unresolved condition => the whole route is RED
```

All five imported. A gate defect is fixed in one place and this route inherits it.

---

## 2. 🛑 THE DEFECT MY OWN FIRST BUILD SHIPPED — AND IT WAS THE REQUIREMENT ITSELF

**§10.6 and §10.7 collide on real data, and my first build resolved the collision by silently
losing §10.7.**

`[MEASURED HERE]` on the real slice, first build:

```text
entry_sequence[1].rationale  "The breakout confirms the market direction"     -> REFUSED_RELEVANCE
entry_sequence[2].rationale  "...high-probability entry point..."             -> REFUSED_RELEVANCE
entry_sequence[3].rationale  "confirms the FVG structure and minimizes risk"  -> REFUSED_RELEVANCE
```

Relevance refused the evidence first, so **fidelity never ran on them at all.** Two of the four
defects your §10.7 requires the route to CATCH — `confirms` and `high-probability`, both named in
your §4 — were reported as nothing but "relevance refused". **The requirement looked met and was
not.** I found it by running the route on the real slice and asking what fidelity WOULD have said:

```text
entry_sequence[1].rationale -> ['CERTAINTY_INFLATION:confirms']
entry_sequence[2].rationale -> ['UNSUPPORTED_MODIFIER:high-probability', 'UNSUPPORTED_MODIFIER:probability']
```

**AND THE RELEVANCE REFUSAL MAY ITSELF BE WRONG.** AR-1225 demonstrated that this gate
false-rejects a faithful paraphrase when the extractor normalised the wording (`gap` -> `FVG`),
and these rows are exactly that shape: **zero lexical overlap on a topically correct passage.**
Masking a proven inflation behind a gate with a known false-reject mode is the worst of both.

### The resolution, and what it deliberately does NOT do

Fidelity is now swept **ADVISORILY** over every literal-quoted non-accepted condition, into a
separate field that **gates nothing and changed no disposition**.

```text
§10.6 INTACT — relevance alone still decides what may be ACCEPTED
§10.7 SERVED — the named defects are computed and visible in the artifact
```

🛑 **I did NOT add a synonym / normalisation map.** That would "fix" the false reject, and AR-1225
refused to invent one for a source-truth gate because that is how a plausible-but-wrong primitive
gets born. **That refusal stands and this does not route around it** — the alias layer still has
no named owner, and this is the **fifth** report raising it.

⚠️ An advisory finding is **not** proof the condition is inflated: the evidence it was computed
against was itself refused. The artifact says so in its own policy field.

---

## 3. MEASURED ON THE REAL SLICE — STABLE ACROSS ALL THREE TRIALS

```text
python scripts/svkm_opus_batch_locator.py route --trial {1,2,3}

GRADE = RED   accepted 4/12   escalate to isolated Opus: 8
  ACCEPTED_PENDING_CERTIFICATION   4
  HELD_DUPLICATE_ROLE_AMBIGUITY    2
  RED_SOURCE_FIDELITY              2
  REFUSED_RELEVANCE                4
```

### §10.7's named defects, now visible

```text
confluences[0].description   TIMING_WINDOW_WIDENING  'during'            trials 1,2,3
entry_sequence[1].rationale  CERTAINTY_INFLATION     'confirms'          trials 1,2,3
entry_sequence[2].rationale  UNSUPPORTED_MODIFIER    'high-probability'  trials 1,2,3
entry_sequence[2].action     UNSUPPORTED_QUANTITY    '5'                 trials 1,2,3
```

### 🛑 THE ONE THAT IS **NOT** CAUGHT, AND I AM NOT CLAIMING IT

```text
entry_sequence[3].rationale  "Entering on the closure confirms the FVG structure
                              and minimizes entry risk."          -> NO FINDING
```

Your §4 names the causal/risk clause as a proven defect. **The route does not detect it.** The
cause is in the guard, not the wiring, and I measured it with a positive control:

```text
POSITIVE CONTROL — the guard CAN fire a causal finding:
  check_condition_fidelity("Entering here minimizes entry risk because it confirms structure.",
                           ["we just enter on the third candle"])  ->  ['CAUSAL_INFLATION:because']
```

So the instrument works; it stays silent on this row because **its certainty leg only fires when
the source HEDGES**, and this source neither asserts nor hedges — a condition asserting certainty
against a source that says nothing either way currently passes in silence.

**That is a detection gap in `source_fidelity_guard`, not in this route. Widening an instrument
changes measurement semantics for every source in the library, so it is not mine to do inside this
lane. YOUR CALL.** §10.7 is therefore **3 of 4 named defect classes caught**, and I will not write
that as "§10.7 met".

### A second measured consequence of the span instability you WARNed on

```text
entry_sequence[1].action  UNSUPPORTED_QUANTITY '1'   trial 1 ONLY
```

Trial 1's shorter quote drops the "one minute" qualifier and trips a quantity finding the other
two trials do not. **Your §3.1 predicted exactly this** — the longer batch form carries the
1-minute antecedent — and here it shows up as a real downstream consequence rather than a
cosmetic boundary difference. It is an argument against any automatic quote-shortening, which
your §6 already forbade.

---

## 4. DUPLICATE ROLE — RECORDED, SEPARATED, NEVER DEDUPLICATED (§5 / §10.9)

Both conditions survive into the artifact; neither is deleted or merged. The two cases your §5
asked to be distinguished now carry different labels, and **both HOLD**:

```text
DUPLICATE_ROLE_AMBIGUITY   the CONDITION TEXTS encode the same requirement
ACCIDENTAL_EVIDENCE_REUSE  the conditions differ; one span was used for both
```

The discriminator is computed from the **condition texts** — the extractor's output, upstream of
the locator under test — never from the spans, which are the thing in question. The threshold is
deliberately high (0.6): this classification only ever moves a HOLD from one labelled bucket to
another, **never out of HOLD**, so a wrong call costs a label and not a gate.

---

## 5. CONTROLS — 8 mutations on ORDER and CLOSURE, 8 bite, 0 survivors

```text
CONTROL (unmutated) : 15 passed
M1 ORDER    run fidelity even when relevance REJECTED           bites
M2 CLOSURE  call the route green on a partial pass              bites
M3 DEDUP    silently drop the duplicate-role twin               bites
M4 COLLAPSE report an abstention as a literal failure           bites
M5 ORDER    skip the collision HOLD entirely                    bites
M6 LABEL    duplicate-role reported as accidental reuse         bites
M7 NO-SHOW  fill an omitted condition with null instead of raising  bites
M8 ESCALATE a relevance refusal earns no isolated re-query      bites
restored_byte_identical: True   SURVIVORS: none   UNAPPLIED: none
```

Focused suites (route + batch_locator + relevance + fidelity + collision + anchor_locator):
**96 passed**, LOCAL, no CI at this SHA.

---

## 6. §10's TWELVE REQUIREMENTS

| # | requirement | disposition |
|---|---|---|
| 1 | batch Opus as first locator | MET |
| 2 | exact transcript/extraction/model/task provenance | MET — pins + task sha + raw-return sha carried into every artifact |
| 3 | raw Opus output preserved before any downstream op | MET — raw files written and hashed before parsing |
| 4 | existing literal verifier unchanged | MET — by import, spy-proven called |
| 5 | complete-set collision HOLD before acceptance | MET + red-proofed (M5) |
| 6 | only relevance-approved evidence feeds fidelity | MET + red-proofed (M1) |
| 7 | catch `confirms` / `high-probability` / timing / causal | **3 of 4** — causal NOT caught (§3) |
| 8 | antecedent/anaphora composition without inventing meaning | **NOT WIRED** — see §7 |
| 9 | duplicate-role recorded, not deduplicated | MET + red-proofed (M3, M6) |
| 10 | isolated Opus only for held/unresolved | MET — 8 of 12 escalate, 4 do not |
| 11 | fail closed when unresolved | MET + red-proofed (M2) |
| 12 | NEW versioned artifacts, historical red untouched | MET — `grade/opus-v2/`; frozen-path refusal reused by import |

---

## 7. NOT DONE, AND NOT CLAIMED

- **§10.8 antecedent/anaphora composition is NOT wired into the route.** `evidence_antecedent`
  exists and is unchanged, but composing a qualifier across spans requires naming the entity terms
  and definitional markers per condition, and deriving those from the source is a semantics
  decision I will not make unilaterally. **This is the honest reason, not a capacity limit.**
- **§10.7's causal/risk defect** — measured absent with a positive control (§3). Your call.
- The **AR-1230 terminology alias layer** still has no named owner. **Fifth report raising it**,
  and it is now load-bearing: it is the most likely explanation for 4 of the 12 relevance refusals.
- **The full `src/engine/tests` regression is still running and I quote no number from it.** The
  previous attempt was killed at 25 minutes by a `timeout` wrapper that then reported exit 0 — a
  false green in my own instrument, caught by reading the output instead of the exit code. It has
  been re-launched without the wrapper and I will report the delta before any integration claim,
  as your §8 requires.
- §11 protection toolbox — still not started; still explicitly parallel and not blocking.
- No compiler, PAPER, broker or live surface touched. The historical red certificate is untouched.

**STOPPING for your ruling on §10.7's causal gap and §10.8's ownership.**
