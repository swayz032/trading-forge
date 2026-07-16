# A-PACKET — compile-stage topology producer. RATIFY PACKET (2026-07-15)

Operator GO given (2026-07-15). Autonomous class (instrument code, pre-live, consumes-not-rebaselines the certified reader). Builds via scope-locked implementer → fresh-context independent grader. 5 operator pins embedded.

## 1. WHAT & WHY NOW
The 3 structural lints (direction_conflation_lint, unsat_sat_check, or_alternatives_honored) return `NOT_EVALUATED(no_compiled_topology)` because no stage produces a compiled-topology overlay at the cert layer. Consequence (fence forcing function): terminal_read_grade → INDETERMINATE for every video → ≥60% clean unreachable → the once-only seal burns on a guaranteed fail. Promoted to terminal-read PRECONDITION by the merge-silencing fence ratify-packet (2026-07-13). Repro: `assemble_certificate(...)` with no topology/or_branches → `CompiledSpine.topology_present=False` → lints NOT_EVALUATED (compile_lints.py:12-13, cert_assembler.py:283-296).

## 2. BLAST RADIUS
- INVALIDATES nothing frozen. ADDS a new producer stage; the certified reader (tag h1-certified-reader-v3.2, SHA efa377d6) is CONSUMED read-only.
- Downstream: pilot_grade certs UPGRADE to full_grade where topology is clean (addendum §C). terminal_read_grade flips INDETERMINATE→CLEAN/REJECTED per real topology.
- The seam ALREADY EXISTS: `assemble_certificate(topology=Dict[char_span,ConditionTopology], or_branches=List[List[str]])` (cert_assembler.py:225,290-296). Producer only fills that overlay.

## 3. THE EXACT CHANGE, SCOPE-LOCKED (PIN 1 — scope in amber)
NEW module `src/engine/extraction/topology_producer.py`: pure function
`produce_topology(strategy_extraction, condition_entries) -> (topology: Dict[(int,int),ConditionTopology], or_branches: List[List[str]])`.
Maps each extracted condition (entry_sequence/confluences/stop/targets, keyed by its char_span) to a ConditionTopology deriving:
- `direction` from the strategy's direction (+ per-condition direction when the condition itself is directional);
- `and_group` — co-required conditions of one strategy object share and_group=0 (a merge-silenced object fuses opposite-direction conditions in and_group=0 → direction_conflation FIRES);
- `comparator` — parsed from the condition's comparator text if one is literally present (e.g. "close > X"), else None;
- `role` spine/confluence; `is_disabled_sentinel` from the anti-pattern never-true marker only.
- `or_branches` — condition_id groups for genuine OR-alternatives (variant alternatives the extraction marks as mutually-substitutable).

**EXPLICITLY OUT OF SCOPE (pin 1):** does NOT touch the certified reader, the extractor/enumerator prompts, the compiler (spec_condition_compiler), the lints themselves, cert_assembler's grade logic, pilot_grade/full_grade math, or the same-bar/causality legs. Does NOT add features (no new lints, no schema growth). Does NOT re-run extraction. One thing: fill the topology overlay so the 3 structural lints EVALUATE.

## 4. NULL-TOPOLOGY DESIGN — SETTLED ON PAPER (PIN 3, the seal-saver)
Faithful nulls (gestural exit, null stop — e.g. _LS6 dip-buy) MUST compile as **evaluable-with-explicit-absence**, NEVER a compile failure that INDETERMINATEs an honest video.
- The producer builds topology from the conditions that ARE PRESENT (entry_sequence, confluences, and any present stop/targets). An absent field is simply **not a condition** — it contributes no ConditionTopology entry. It does NOT set topology_present=False and does NOT raise.
- `topology_present=True` is set whenever ≥1 condition exists (always true — every strategy has an entry). So an honest-null strategy has REAL topology over its present conditions; the 3 structural lints EVALUATE on them: a single-direction, no-OR, no-contradiction strategy → direction_conflation PASS, unsat_sat PASS, or_alternatives PASS (vacuously honored, NOT NOT_EVALUATED) → CLEAN.
- A null `comparator` on a prose condition is normal (most verbatim conditions carry no formal comparator) → unsat_sat_check has nothing to contradict → PASS. Null must never be read as FAIL or as NOT_EVALUATED.
- INVARIANT (test): _LS6 (gestural exit, null stop) → topology_present=True → terminal_read_grade=CLEAN. An honest null is never punished for being honest.

## 5. VERIFICATION PLAN (PINS 2 + 4 — both polarities, all 22)
- **PIN 2 — engagement, both polarities, per-lint, all 3, on REAL topology (not code-path-exists):**
  - REJECTED witness: the merge-silenced R5L890 ADVERSARIAL fixture (2 opposite-direction setups fused in one object, and_group=0) → topology → **direction_conflation FAIL → terminal_read_grade=REJECTED** through the REAL harness (assemble_certificate). The half the fence build could only simulate.
  - CLEAN witness: a known-good correctly-split fixture → topology → all 3 structural lints **PASS → CLEAN**.
  - Plus per-lint EVALUATE proof: unsat_sat FIRES on the "5-SMA above AND below 50-SMA" fixture; or_alternatives FIRES/HONORS on an or_branches fixture. Each lint observed EVALUATE (a PASS AND a FAIL polarity), never NOT_EVALUATED, on real topology.
- **PIN 4 — definition-of-done = ALL 22:** run the producer on every one of the 22 certified design-pool strategies (staging_v32 on disk). Topology must produce + the lints EVALUATE (zero NOT_EVALUATED from the 3 structural lints) on every one, OR each non-compilability is understood + classified in writing BEFORE read day. No compile surprises inside the once-only exam.
- Full receipt: before/after terminal_read_grade per strategy, the R5L890 REJECTED + clean-CLEAN pair, the 22-strategy EVALUATE table.

## ROLLBACK
New module + its call site (a topology arg passed into assemble_certificate in the read harness). Revert = drop the module + stop passing topology (assembler falls back to topology_present=False, its prior honest state). Zero effect on the certified reader. No live default touched (pre-live).

## PIN 5 (post-land, sequenced): witness pair → read-shape staging incl. FULL-DRESS REHEARSAL on 2-3 spent design-pool videos (conductor → blind raters → fence → verdict math, end-to-end) → machine STOPS, seal untouched, waits for operator trigger.
