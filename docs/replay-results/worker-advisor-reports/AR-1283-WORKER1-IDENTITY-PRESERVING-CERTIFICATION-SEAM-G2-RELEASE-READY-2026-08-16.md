# AR-1283 — WORKER-1 — IDENTITY-PRESERVING CERTIFICATION SEAM

**RULING:** AR-1282A §7 (identity-preserving certification seam / G2 release readiness), 2026-08-16.
Executed clauses: §7.A repair the synthetic full-path control without deduplication · §7.B make
final-route GREEN a hard certification precondition · §7.C preserve exact route identity into the
pilot conveyor · §7.D prove the four-residual Tier-3 packet shape without dispatching it ·
§7.E correct the reachability proof · §7.F emit one exact release-readiness token.

**PIN:** worker tree `C:\Users\tonio\Projects\wt-claude-worker1-20260815`, branch
`claude/worker1-h1-20260815`, parent head `5bd8edba0b672c8b3f82cdce79e77d7d76eb1780`.

**SPEND:** model calls **0**. frozen-G2 **0**. Agent/subagent **0**. Opus **0**. dispatches **0**.

---

## §F VERDICT — `G2_RELEASE_READY_AFTER_IDENTITY_SEAM`

All of §7.A–§7.E pass, and the frozen eight are untouched (`READY = 8`, `SPENT = 0`).

```
19/19 harness checks PASS      scripts/ar1283_identity_seam.py
16/16 production-path tests    src/engine/tests/test_cert_identity_seam.py
135 pytest GREEN across the touched extraction surfaces, zero regressions
```

---

## THE FINDING THAT DECIDES §7.E — PRODUCTION ALREADY REFUSES THE ALIASING STATE

AR-1282A §4 asked whether a final GREEN route could still contain two condition identities
sharing one certification join span. **Measured: it cannot, and the guard is already in
production.** The shared span belongs to exactly the pair the ruling named — and both sides
are HELD, *before acceptance*:

```
entry_sequence[1].action        HELD_DUPLICATE_ROLE_AMBIGUITY   (9432, 9512)
confluences[1].description      HELD_DUPLICATE_ROLE_AMBIGUITY   (9432, 9512)

route.collisions[0] = {span:(9432,9512), roles:[confluences, entry_sequence], severity:"HIGH"}
route.gate_order    = [... "span_collision complete-set HOLD (before acceptance)" ...]
```

`opus_phase1_route.py:234-287` runs `span_collision.adjudicate_locations` as STAGE 2, before any
acceptance. A route carrying an unresolved alias therefore cannot reach
`GREEN_PENDING_CERTIFICATION` with all rows accepted.

⇒ **There is no `CERTIFICATION_IDENTITY_CONTRACT_DEFECT`.** The span-keyed join in
`cert_assembler.py` is safe *given* that precondition, and AR-1282A §4 was right that it must not
be pre-emptively redesigned. What was missing was that the precondition was **incidental, not
mechanical**. This packet makes it mechanical.

---

## CHANGED

```
src/engine/extraction/cert_identity_seam.py   NEW   the smallest missing production adapter
src/engine/tests/test_cert_identity_seam.py   NEW   16 production-path tests
scripts/ar1283_identity_seam.py               NEW   §A-F harness, 19 checks
scripts/ar1282_seam_controls.py               EDIT  §7.E scope-correction of the stale D control
docs/replay-results/worker-advisor-reports/AR-1283-...md   NEW   this report
Trading Forge System Map v2.md + docs/system-{readiness,topology}.generated.json  REGENERATED
```

No certification policy, frozen queue, receipt, settings, toolbox, guard, `cert_assembler.py`,
`pilot_conveyor.py`, or `opus_phase1_route.py` edit. The new module only *composes* production
functions; it changes no existing behaviour.

---

## §7.A — THE SYNTHETIC CONTROL, REPAIRED WITHOUT DEDUPLICATION

The AR-1282 defect, quoted exactly (`ar1282_seam_controls.py:173-174`):

```python
all_spans  = [tuple(o["char_span"]) for o in route["outcomes"]]   # 12 identities
uniq_spans = sorted(set(all_spans))                               # 11 spans  <- identity lost
```

AR-1283 constructs the synthetic route the campaign is actually working toward — GREEN, all 12
accepted, collision **resolved** — and carries identities as a LIST throughout. Measured:

```
input condition identities   = 12
adapter condition identities = 12
certificate condition rows   = 12
distinct join spans          = 12
no condition_ref disappeared = true
classifying_tiers            = [3,3,3,3,3,3,3,3,3,3,3,3]     pilot_grade = True
```

No `set`, no `dict.fromkeys`, no span-keyed collapse anywhere in the path.

**Why `assemble_certificate` was never the problem:** it builds one condition entry per
*fall-through* (`cert_assembler.py:338`), and `_build_tier3_packet` builds one item per
fall-through (`pilot_conveyor.py:1015`). Identity is preserved by construction in production.
Only AR-1282's control collapsed it.

**SYNTHETIC LABELLING (§7.E).** The control forced 8 held/refused/red rows to ACCEPTED and
re-grounded one colliding row on a different resolvable span. It asserts **nothing** about
whether that evidence is acceptable; those rows' real dispositions stand. Both facts are stamped
on the artifact as `SYNTHETIC_WARNING`, `dispositions_forced_to_accepted` and `synthetic_edit`.

---

## §7.B — FINAL-ROUTE GREEN IS NOW A HARD, MECHANICAL PRECONDITION

`assert_certifiable_final_route()` refuses unless: grade is `GREEN_PENDING_CERTIFICATION` AND
every spine `condition_ref` is present exactly once AND every row is accepted AND no two
identities collide AND no two share condition text.

The three gates are proven **independently live** — an earlier gate short-circuiting the later
ones would leave them dead code wearing the word "enforced":

```
real route (RED)                  -> final_route_not_green_pending_certification
grade forced GREEN                -> final_route_row_not_accepted            (8 rows)
GREEN + all 12 forced accepted    -> two_identities_share_a_certification_join_span
```

The collision leg reuses production `detect_span_collisions`, so a *substantially overlapping*
alias is caught too — not merely a byte-identical span.

---

## §7.C — EXACT SPAN IDENTITY, NOT JUST QUOTE TEXT

The hazard, read from code: `anchor_locator._verify_and_locate` returns the **first (leftmost)**
resolving occurrence (`anchor_locator.py:225-251`), and `propose_fn` only ever receives
`(transcript, condition_text)`. So a perfectly literal quote can resolve to a different
occurrence than the route row it came from, and a text-keyed map cannot distinguish two
conditions sharing text.

`verify_anchor_identity()` closes it by requiring `resolved_span == route_span` per
`condition_ref`. **Positive witness first**, then the refusal:

```
entry_sequence[0].action   route (8191,8701)   resolved (8191,8701)   MATCH
entry_sequence[3].action   route (13305,13364) resolved (13305,13364) MATCH
stop.rationale             route (13869,14212) resolved (13869,14212) MATCH
targets[0].rationale       route (14368,14516) resolved (14368,14516) MATCH
```

All 12 rows (not just the 4 accepted) were measured: **0 of 12 mismatch.** The pin holds on real
data — it is a guard against a real mechanism, not a theoretical one.

### The seven controls (all RED without the guard, GREEN with)

```
C1  wrong condition_ref                     -> route_row_ref_absent_from_spine
C2  wrong condition text                    -> route_row_text_differs_from_spine
C3  literal quote at the WRONG span         -> anchor_resolved_to_a_different_span...
C4  missing condition identity              -> route_ref_set_does_not_match_spine
C5  duplicated condition identity           -> route_ref_set_does_not_match_spine
C6  final route RED                         -> final_route_not_green_pending_certification
C7  unresolved collision hidden by dedup    -> two_identities_share_a_certification_join_span
C8  two identities sharing condition text   -> two_identities_share_condition_text
```

C3 moves only the *claimed* span (+1000) and leaves the quote untouched — so it tests the span
pin specifically, not literalness. C7 additionally records that `set(spans)` would have silently
dropped one identity at that exact point.

---

## §7.D — THE FOUR-RESIDUAL TIER-3 PACKET SHAPE, WITHOUT DISPATCH

```
condition_ref              tier-1 outcome                         span            Stage-1   Stage-2
entry_sequence[0].action   fallthrough_pending_tier3              (8191,8701)     B000      B000
entry_sequence[3].action   fallthrough_dual_read_disagreement     (13305,13364)   B001      B001
stop.rationale             fallthrough_pending_tier3              (13869,14212)   B002      B002
targets[0].rationale       fallthrough_pending_tier3              (14368,14516)   B003      B003
```

One stable identity, one exact quote/span, one Stage-1 item, one Stage-2 support item each —
4 residuals, 4 distinct item_ids. Stage-1 is quote-alone (`extracted_condition_type` and
`extracted_object` both `None`); Stage-2 reveals the condition text and is unanswered;
`stage2.read_order_lock` present and `blinding_leak_scan.clean = True`.

**ZERO dispatch:** every `rater_response.role` is `None` and every `adjudication_response.support`
is `None`. No rater was invoked and no verdict fabricated.

**The lawful Tier-3 path, identified from repository authority (not invented):**
`pilot_conveyor.verdict_from_rater_response` (Stage 1) ·
`pilot_conveyor.support_verdict_from_stage2_response` (Stage 2) ·
control gate = `cert_assembler.Tier3Verdict.control_gate_passed`, pre-reg §3 blind protocol
(rater must clear the 5/5 gate + 5/5 context control set before any Set-B verdict may enter a
certificate; `assemble_certificate` drops every verdict whose `control_gate_passed` is False).

---

## AFTER THE FROZEN EIGHT TURN THE ROUTE GREEN (§7.F second half)

```
MEASURED on the synthetic route:   tier-1 classified = 0    residual tier-3 = 12
ESTIMATE for the real final route: tier-1 classified = 0    residual tier-3 = 12
```

**The second line is an ESTIMATE, not a measurement.** Tier-1 fires on the *located quote*, so a
final G2 route that grounds the eight on different spans could classify some at tier 1 and reduce
the residual count. The only rows with executable evidence are the four already accepted, and
they are **0/4 at tier 1** — re-measured in this packet through the identity seam, not carried
across from AR-1282.

---

## WHAT I DID NOT MEASURE

- **No real G2 evidence was produced or spent.** The frozen eight are untouched.
- **No semantic verdict here is real.** Every Tier-3 verdict in §7.A/§7.E is synthesised to
  exercise the pathway; none is evidence about the source.
- **The estimate above is not executable evidence** for the eight, for the reason stated.
- **I did not re-verify the frozen-queue hashes** this session; AR-1282A §9 recorded
  `READY = 8 / SPENT = 0` at the parent head and nothing in this packet touches that surface.

---

## CI / GATE STATE

```
check:production-isolation   GREEN  (5 files checked, 0 violations)
check:2026-compliance        GREEN  (OK; pre-existing WARN: MFFU doc 56 days since review)
system-map:check             RED    "Registry is missing 3 engine subsystem mappings"
```

**The system-map RED is PRE-EXISTING and was REVEALED, not caused, by this packet.** Evidence:

```
missing = [battery, extraction, forensics]          <- directory-level engine groups
docs/system-topology.generated.json last regenerated   2026-07-06 (commit 99480532)
src/engine/extraction  first landed 2026-07-12   (236cc620)
src/engine/battery     first landed 2026-07-19   (979cfca6)
src/engine/forensics   first landed 2026-07-21   (34655940)
```

The committed artifact predates all three directories, so it recorded `missingEngineSubsystems:
[]` — a stale clean. Regenerating it surfaced ~5 weeks of latent drift. My one new file sits in
`extraction`, which already held ~20 modules; it cannot have created `battery` or `forensics`.

**I did not register the three.** Registry entries are heavy semantic records (domain,
owner_surface, audit_actions, telemetry_sources, criticality). Authoring them for `battery` and
`forensics` would mean inventing semantics for two H1 subsystems this packet never studied — a
STOP under the Worker-1 lane manifest, and a detour AR-1282A §7 forbids. I committed the honest
regenerated artifact rather than restoring the false-clean one; note the check re-derives live, so
reverting would have hidden the record without making the gate pass.

⇒ **CARRY-FORWARD, needs a ruling:** register `battery` / `extraction` / `forensics` in
`docs/system-subsystem-registry.json`, by whoever owns those subsystems' semantics.

---

## NEXT AUTHORIZATION SURFACE

Per AR-1282A §8, the seam is now in place and the clean ordering resumes at its first step:

```
AR-1283 identity-preserving seam PASS          <- THIS PACKET
 -> GPT explicit frozen-G2 authorization       <- THE ASK
 -> spend the frozen 8 exactly once under the existing one-shot law
 -> rebuild/re-run the COMPLETE final evidence route
 -> require GREEN_PENDING_CERTIFICATION        <- now mechanically enforced
 -> feed the final accepted 12 through the certified seam
 -> Tier-1 classifies what it can; only true residuals enter the blind Tier-3 packet
 -> finalize certificate
```

Nothing in this packet authorises that spend. `READY = 8`, `SPENT = 0`, unchanged.
