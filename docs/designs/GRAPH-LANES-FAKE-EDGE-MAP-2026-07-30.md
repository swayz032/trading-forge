# GRAPH-LANES fake-edge map — PROPOSAL ONLY (2026-07-30)
Produced by a reader agent for the advisor seat under advisor-ruling §8a (batch
lanes). This file AUTHORIZES NOTHING — the advisor ratifies, amends, or discards
it in a ruling. Left uncommitted deliberately; the advisor commits it if adopted.
Every edge claim below carries its evidence (file:line) or is labeled UNKNOWN.

## Sources read (in the mandated order)

1. `docs/designs/BLUEPRINT-V4-DRAFT.md` (904 lines, full read) — Revision 4 is
   marked **PROPOSED, not yet adopted** (`BLUEPRINT-V4-DRAFT.md:3-9`: "AWAITS THE
   SEATED ADVISOR'S ADOPTION... Until adoption, the already-adopted V4 remains
   operative"). The pre-Revision-4 v4 (§§1-14) is what `ADVISOR-STATE.md`
   currently carries as `## THE PLAN`.
2. `docs/designs/ADVISOR-STATE.md` — `## THE PLAN` (:2046-2088), `## QUEUE`
   (:2167-2181), `## PARKED` (:2183-2191), `## NOT AUTHORIZED` (:2233-2245),
   seat block (:85-130), trees/artifacts (:2285-2301). No section literally
   titled `## AUTHORIZED NOW` is current — the only such heading (:1022) is
   marked `[SUPERSEDED — HISTORICAL]`; the live equivalent is the SEAT block.
3. Newest 3 rulings in `ADVISOR-RULINGS.md` (newest at top, read from the top
   only): **R-498** (:15-65, full), **R-497** (:68-125, full), **R-496**
   (:128, header only). Newest AR read in full per the task's own instruction
   scope: **AR-516** (`AGENT-REPORTS.md:9-30`).

**Load-bearing tension found in the sources themselves (not resolved here):**
Revision 4 (BLUEPRINT §15) is the section that actually defines the P0-P3/Gate-B
items below, and recent rulings (R-495..R-498) are visibly executing it — but
by the document's own header it is still **PROPOSED**, and `ADVISOR-STATE.md`'s
`## QUEUE` (:2169-2173) still carries the **pre-Revision-4** framing of the
seven C8 prerequisites as the open items. Two different "what is open" lists
exist in currently-operative carriers. Flagged in "What I could NOT determine."

---

## ITEM INVENTORY (every OPEN item found)

### A. Revision-4 critical path, §15 (PROPOSED status — see tension above)
| ID | Item | Status at evidence cut | Cite |
|---|---|---|---|
| **I9** | **P0** — Ledger-E parity atomic correction | STEP 1 (packet §11 addendum) DONE at `96d4a7f3`. STEP 2 (publish) execution-HELD by the working seat pending operator disclosure decision (public repo). STEP 3 (grade) authorized, not yet dispatched. | BLUEPRINT:684-778; ADVISOR-RULINGS.md R-498 §4 (:42-58); AGENT-REPORTS.md AR-516 (:9-30) |
| **I10** | P0 STEP 2 — publish lineage to public GitHub remote | HELD — working seat escalated directly to operator over disclosure, not deployment, risk | ADVISOR-RULINGS.md:44-53 (R-498 §4 STEP2); AGENT-REPORTS.md:15-26 (AR-516 §2) |
| **I11** | P0 STEP 3 — independent `accuracy-validator` grade of `c304b098` (opus-pinned) | Authorized, **does not require STEP 2** (local, no push needed) | ADVISOR-RULINGS.md:55-58 (R-498 §4 STEP3); AGENT-REPORTS.md:26 |
| **I12** | P1 — additive current-code classification baseline | Not frozen / not started | BLUEPRINT:781-786, :889 |
| **I13** | P2 — frozen truth membership (source-keyed key, 5 labels) | Rule **defined**; membership **not frozen** | BLUEPRINT:788-808, :890 |
| **I14** | P3 — two-stage lane authority (producer-proof lane + deployable-integration lane + transfer receipt) for Gate B | BLUEPRINT status table calls it **"unenumerated"** (:891) — but see tension note below | BLUEPRINT:810-822, :891 |
| **I15** | Gate B implementation — deterministic admission contract, typed projections, immutable source record | Not started; blocked on P0-P3 per plan | BLUEPRINT:614-641, :835, :892 |
| **I16** | Source-keyed control/treatment sweep (consumer transition ledger) | Not started | BLUEPRINT:643-682, :836-838 |
| **I17** | Re-rank Tier-A spearheads on current (post-Gate-B) output | Not started | BLUEPRINT:839-840 |
| **I18** | Targeted corpus_B respin (smallest video set for one Tier-A spec) | Not started | BLUEPRINT:841-842 |
| **I19** | Complete SMC/load-bearing binding lane on the target spec | Not started | BLUEPRINT:843-844 |
| **I20** | Re-affirm compile-fidelity calibration in the authoritative lane; declare Phase-1 exit | Not started | BLUEPRINT:845-847, :893 |

### B. Pre-Revision-4 v4, still carried as `## QUEUE` in `ADVISOR-STATE.md` (currently-adopted framing)
| ID | Item | Status | Cite |
|---|---|---|---|
| **I1** | Seven C8 prerequisites, item #1 — ≥3-quota consumer census, transitive closure | OPEN per QUEUE; **BLUEPRINT §14 (:539-543) separately says this item DEMOTES to a latent-hazard hygiene item**, not causal for the current corpus | ADVISOR-STATE.md:2171-2173; BLUEPRINT:539-546 |
| — | Prerequisite #2 (ablation pre-reg) and #3 (name the grader) | **DISCHARGED**, not open | ADVISOR-STATE.md:2169-2170 |
| **I2** | Prerequisite #4 — control arm proves C8 fires at ~51% | Likely **superseded by measurement**: BLUEPRINT §15.1 (:601) shows the frozen `51%` control is now historical-only, and §15.8 (:885) marks "Gate-A causal split... complete at the historical-artifact layer" | BLUEPRINT:169-186 (#4), :598-604, :885 |
| **I3** | Prerequisite #5 — treatment arm proves genuine conditions preserved | Appears to be the **same work** as I16 (source-keyed sweep) under Revision 4's renaming | BLUEPRINT:181, :643-682 |
| **I4** | Prerequisite #6 — annotations stored, never discarded | Appears **folded into** I15's `annotation` typed projection | BLUEPRINT:182, :628 |
| **I5** | Prerequisite #7 — artifacts immutable, versioned by `spec_hash` | Appears **folded into** I15's "one immutable source record" | BLUEPRINT:183, :616-620 |
| **I6** | Lane authority ruling (§3-1E, R-415): 160KB campaign vs 35KB production `spec_family_bindings.py` divergence | OPEN per QUEUE #2, worker delivers structural inventory, advisor rules | ADVISOR-STATE.md:2174-2176; BLUEPRINT:218-229 |
| **I7** | `C2` session-role resolver yield measurement | OPEN, advisor-owned, parallel, cheap | ADVISOR-STATE.md:2177-2178; BLUEPRINT:374 (historical, but not contradicted) |
| **I8** | Semantic-role-classifier migration (HOLDOUT-26 two-arm shadow) | OPEN, explicitly OFF the Phase-1 critical path, never a Phase-2 gate | ADVISOR-STATE.md:2179-2181 |
| **I21** | Maintain `STRANDED-CAPABILITY-REGISTER.md` | OPEN, bundled with I7 in QUEUE #3 | ADVISOR-STATE.md:2178; BLUEPRINT:380-381 |

### C. Parked (explicit non-preemption; not batch candidates unless invalidating C8 evidence)
| ID | Item | Note |
|---|---|---|
| **I22** | Off-machine encrypted backup | Marked **(OPERATOR)** — reserved to operator, excluded from any batch | ADVISOR-STATE.md:2185-2186 |
| **I23** | Partition-generator hardening (R-463 §5) | Parked | ADVISOR-STATE.md:2185 |
| **I24** | Heartbeat/expiring-lease engineering (R-465) | Parked | ADVISOR-STATE.md:2185 |
| **I25** | Wider bug-pattern sweeps | Parked | ADVISOR-STATE.md:2186 |
| **I26** | Committed prompt-hash verifier | Parked | ADVISOR-STATE.md:2186-2187 |

---

## EDGE TABLE

| A → B | Class | Evidence |
|---|---|---|
| I9 (P0 finished+graded) → I15 (Gate B implementation) | **REAL EDGE** (admissibility, not literal data-read) | BLUEPRINT:684-687: "Before any Gate-B result is admissible, the isolated worktree pinned to `runtime-production` must deliver one atomic parity correction." Also the ordered list BLUEPRINT:828-836 (steps 1→5). Caveat: I did not find that Gate B's *code* reads any artifact P0 produces — the dependency is stated as a trust/admissibility rule over a shared downstream binding-plan-parity contract, not literal output consumption. Graded REAL because the plan states it as a hard blocking rule, but the mechanism is weaker than a data pipe. |
| I10 (STEP2 publish) → I11 (STEP3 grade) | **FAKE EDGE** | AGENT-REPORTS.md:26 (AR-516 §3): "STEP 3... is DESK-DISPATCHED and does NOT require the push — the validator runs on this machine against `c304b098`, which is local." Explicit, working-seat-stated independence despite appearing sequential in R-498 §4's STEP1→STEP2→STEP3 list. Checked: the grade target (`c304b098`) is a local commit; nothing in STEP3's acceptance criteria (ADVISOR-RULINGS.md:55-58) references the remote. |
| I9/I11 (P0 finish+grade) → I12 (P1 baseline) | **FAKE EDGE** (WIP-limit policy, not data) | Checked BLUEPRINT §15.2-15.5 for any P0-artifact read by P1/P2 — found none; P0 concerns the TS/Python spec-binding-**plan**-parity oracle (`check-spec-binding-plan-parity.ts`), P1/P2 concern the extraction-**classification** corpus, a different code surface. The only cited reason for sequencing is the throughput law BLUEPRINT:854-855 (§15.7): "At most one money-path implementation and one independent grade are in flight." That is a queue-position/WIP-limit rule, not an output dependency. |
| I9/I11 → I13 (P2 truth membership) | **FAKE EDGE** | Same check and same citation as the row above (BLUEPRINT:854-855). |
| I13 (P2 frozen membership) → I16 (source-keyed sweep) | **REAL EDGE** | BLUEPRINT:788-789 (§15.5 P2): "Before any treatment result exists, freeze the complete membership and adjudication labels under this key." The sweep (I16) is explicitly the treatment/control comparison (§15.3); its population is P2's frozen key. |
| I12 (P1 baseline) → I16 (sweep) | **REAL EDGE** | BLUEPRINT:781-786: P1 is "added beside the historical freeze, never overwritten into it" specifically so the sweep (I16) can compare current-code output against both the historical control and P1's additive baseline; §15.3's "reject proxy improvements" (:682) requires a baseline to reject against. |
| I14 (P3 lane ruling) → I15 (Gate B implementation) | **REAL EDGE** | BLUEPRINT:821-822: "Neither `tf-deep-scan` nor `runtime-production` is edited directly. The campaign tree is not a valid implementation lane." P3's ruling is consumed by I15 as the specification of *where* Gate B may be built (producer-proof worktree vs deployable-integration worktree). |
| I6 (old 160KB/35KB lane authority) ↔ I14 (new producer/consumer lane authority for Gate B) | **UNKNOWN** | Both are "lane authority" rulings assigned to the advisor seat over `spec_family_bindings.py`-adjacent divergence, but they concern different file pairs: I6 = campaign vs production `spec_family_bindings.py` (160,049B vs 35,046B, BLUEPRINT:116-120, :218-229); I14/P3 = atomizer producer tree (`4f3b5cd0…`) vs `runtime-production` consumer tree (BLUEPRINT:810-822). I could not determine from the sources whether ruling one settles or informs the other, or whether they are fully independent. Compounding this: `ADVISOR-STATE.md:2288-2293` states P3's two-stage shape was **already measured and largely settled by R-480** ("SO GATE-B IS TWO SEPARATELY PINNED STAGES (R-480 §5-5)"), which contradicts BLUEPRINT §15.8's row calling P3 "unenumerated" (:891). I did not read R-480 itself (out of the mandated source list) to resolve which is current. |
| I1 (consumer census, prereq #1) → I15 (Gate B) | **FAKE EDGE** | BLUEPRINT:539-543 (§14): the item "DEMOTES to a latent-hazard hygiene item... it is real, just not causal for this corpus as far as measured." Checked: no citation makes Gate B's implementation consume the census output; it is explicitly filed as hygiene, not a blocker. |
| I2 (prereq #4, control-arm ~51%) → I16 (sweep) | **UNKNOWN, leaning FAKE** | BLUEPRINT §15.1 (:598-604) shows the frozen `51%` figure is superseded as a *current* control ("Historical only... This is a counterfactual measurement, not yet the additive current-production baseline"). It is unclear whether the old prerequisite #4 is (a) fully retired because §15.8 marks the causal split "complete," or (b) still owed in a re-measured form feeding I16/I12. I could not find an explicit disposition ruling closing it. |
| I3 (prereq #5) ≈ I16 (sweep) | **Same item, renamed** — not an edge | BLUEPRINT §14 (:544-546): "Prerequisites #2–#7... transfer to the new target unchanged." I16's design (§15.3, :643-682) is the treatment/genuine-condition-preservation check prereq #5 asked for. Treat as one item under two names, not two items with a dependency. |
| I4 (prereq #6, annotation storage) ≈ I15's `annotation` projection | **Same item, folded in** — not an edge | BLUEPRINT:628 defines the `annotation` typed projection as part of Gate B's admission contract (§15.2); this is prereq #6's requirement realized inside I15's design, not a separate deliverable. |
| I5 (prereq #7, immutability) ≈ I15's immutable source record | **Same item, folded in** — not an edge | BLUEPRINT:616-620 (§15.2): "Every extracted clause has one immutable source record..." — this is prereq #7 (:183) realized inside I15. |
| I7 (C2 yield) → any critical-path item | **FAKE EDGE** | BLUEPRINT:374 (register row): "C2 alone unlocks 0; measure cheap now, port later." Explicit statement that C2 does not gate anything; it is a future multiplier, not a current input. §9 itself is marked historical (:367-369) but its "unlocks 0" fact is a measurement, not a superseded ordering claim. |
| I8 (semantic-role migration) → any critical-path item | **FAKE EDGE** | ADVISOR-STATE.md:2179-2181 (QUEUE #4): "v4 §9 puts it OFF the Phase-1 critical path and NEVER a Phase-2 gate." Explicit. |
| I21 (STRANDED-CAPABILITY-REGISTER maintenance) ↔ I15 (Gate B) / I8 (semantic migration) | **SHARED-RESOURCE EDGE** | BLUEPRINT:380-381: "no new detector/binder/classifier work is commissioned until the STRANDED-CAPABILITY-REGISTER is consulted in the authorizing ruling." Both I15 and I8 count as "new detector/classifier work" and must read the register before their authorizing ruling issues; I21 is the item that keeps that register accurate. Read-before, not a write conflict — does not block parallel *execution*, but the register should not be mid-edit when either is authorized. |
| I11 (P0 grade) ↔ I6 / I14 (lane-authority rulings) | Not an edge — **advisor judgment, sequencing not applicable** | Per the batching hard rules, judgment/ruling acts never parallelize with worker lanes as *worker* lanes; I6 and I14 are advisor-only ruling acts (BLUEPRINT:224-227, :810-822) and can proceed on the advisor's own clock alongside worker batches, but are not themselves batchable "lanes." |
| I22 (off-machine backup) → anything | **N/A — reserved to operator** | ADVISOR-STATE.md:2185-2186 marks it `(OPERATOR)`. Excluded from all batches per task's hard rules regardless of edge class. |
| I9 STEP1 (packet addendum, `96d4a7f3`) → I9 STEP2 (publish) | **REAL EDGE** | ADVISOR-RULINGS.md:43-44 (R-498 §4): STEP2 publishes "the full lineage plus the ledger" which includes the STEP1 addendum content; STEP2's published branch list (:47) explicitly includes the packet's home branch. |

---

## PROPOSED BATCHES

Ordering constraints honored: no batch contains a judgment/ruling act as a
worker lane (I6, I14 excluded); no batch contains two lanes writing the same
file (checked per lane below); I22 (operator-reserved) excluded entirely;
I10 (publish) excluded — it is currently gated on a live operator escalation
(AGENT-REPORTS.md:15-26), not a worker-authorizable lane right now.

**BATCH 1 — ready now, zero dependency on the P0-publish hold, distinct files/trees (4 lanes):**
- **I11** — dispatch `accuracy-validator` (opus-pinned) against `c304b098` per R-498 §4 STEP3's acceptance list (ADVISOR-RULINGS.md:55-58). *Contract: produce the independent grade; touches only the local delivery worktree; no push.*
- **I7** — measure the `C2` session-role resolver yield. *Contract: cheap measurement only, report yield; does not modify any binding/extraction code.*
- **I21** — refresh `STRANDED-CAPABILITY-REGISTER.md` against current stranded-capability state. *Contract: single-file write, own resource, no reader currently mid-consult per the sources read.*
- **I8** — advance the semantic-role-classifier migration under its existing HOLDOUT-26 packet (`SEMANTIC-ROLE-MIGRATION-PACKET-2026-07-29.md`), explicitly off the Phase-1 critical path. *Contract: shadow-mode work only; per `## NOT AUTHORIZED` (ADVISOR-STATE.md:2238-2239) it may not flip `TF_SEMANTIC_ROLE_CLASSIFIER`, promote `trigger`, or write classifications to the DB.*

**BATCH 2 — advisor-only judgment, may run on the advisor's own clock in parallel with Batch 1 (not a worker batch; listed separately per the "judgment never parallelizes as a lane" rule):**
- **I6** — rule lane authority for the 160KB/35KB `spec_family_bindings.py` divergence (structural inventory already owed from the worker per QUEUE #2).
- **I14/P3** — reconcile the BLUEPRINT "unenumerated" status against `ADVISOR-STATE.md:2288-2293`'s claim that R-480 already fixed the two-stage shape, then rule.

**Everything downstream of P0 (I9 STEP2 held) — I12, I13, I15, I16, I17, I18, I19, I20 — is the serial critical-path spine, not batchable in parallel with each other**, per the plan's own single-lane rule (BLUEPRINT:854-855, §15.7: "At most one money-path implementation and one independent grade are in flight"). I12 and I13 *could* in principle run as two lanes rather than one (no shared-file conflict found between the P1 baseline re-classification and the P2 truth-membership freeze — they read the same frozen corpus but write to different artifacts per BLUEPRINT:781-808), but doing so would trade away the plan's own explicit throughput law; flagged for the advisor's judgment rather than proposed as a batch here.

---

## What I could NOT determine

1. **Which QUEUE is operative right now.** BLUEPRINT-V4-DRAFT.md's Revision 4
   (§15, defining I9-I20) is marked PROPOSED / awaiting adoption
   (BLUEPRINT:3-9), yet the newest rulings (R-495 through R-498) are visibly
   executing it, and `ADVISOR-STATE.md ## QUEUE` still carries the
   pre-Revision-4 seven-prerequisite framing (I1-I5) as the adopted plan. I did
   not find an adoption ruling for Revision 4 in the three newest rulings read.
2. **I6 vs I14/P3 relationship** (see edge table row above) — whether the old
   `spec_family_bindings.py` lane-authority question and the new Gate-B
   producer/consumer lane-authority question are the same decision, overlapping,
   or independent. Would require reading R-415 and R-480 in full, which are
   outside this task's mandated source list.
3. **Disposition of old prerequisite #4** (control arm proving C8 fires at
   ~51%) — whether it is fully retired by the Gate-A causal-split
   "complete" status (BLUEPRINT:885) or still owed in a re-measured form. No
   explicit closing ruling found in the three rulings read.
4. **Whether I10 (publish) is now effectively dead** or will resume — AR-516
   is the newest AR and reports an active escalation to the operator with no
   ruling on it yet in the three newest rulings (R-496/497/498 all predate
   AR-516). Its resolution is outside this map's evidence cut.
5. **File-level overlap for a potential I12/I13 parallel split** — I found no
   stated shared-write file between P1 and P2, but I did not read the actual
   implementation surface (no script/table names are pinned in BLUEPRINT §15.5
   beyond the corpus itself), so a SHARED-RESOURCE edge between them cannot be
   ruled out from these sources alone.
