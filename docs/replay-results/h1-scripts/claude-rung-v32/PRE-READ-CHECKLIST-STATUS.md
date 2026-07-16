# PRE-SEAL CHECKLIST STATUS (2026-07-15) — after FIRST CERTIFIED READER (SHA efa377d6, tag h1-certified-reader-v3.2)

Seal-break = operator trigger ONLY. This checklist is what must be GREEN before the twelve are read once, ever.

| # | item | status | detail |
|---|---|:--:|---|
| 1 | **A-packet topology producer** | ❌ **NOT BUILT — THE GATE** | Confirmed in code: cert_assembler + compile_lints state no stage produces compiled topology at the cert layer; the 3 structural lints hard-return NOT_EVALUATED(no_compiled_topology) → terminal_read_grade=INDETERMINATE → every video not-clean → ≥60% UNREACHABLE. The fence's forcing function makes a topology-less read a GUARANTEED fail that burns the once-only seal. **Only remaining substantial work.** Wall-days build (0 OpenAI tokens): compile-stage producer wiring extraction→compiler→assembler so all 3 structural lints EVALUATE on real topology. Has own ratify-packet + build/grade loop. |
| 2 | **R5L890 fence witness thru REAL harness** | ⏳ **blocked on #1** | Harness pieces exist (pilot_conveyor prepare/finalize/aggregate; terminal_read_grade wired; h1_optionR_R5L890_wiring_verify.py). Full before/after witness needs BOTH configs: topology-ABSENT (observable now → NOT_EVALUATED→INDETERMINATE→not-clean) AND topology-PRESENT (requires #1). Pair completes when #1 lands. |
| 3 | **Mid-run hard-cap fix** | ✅ **DONE** | h1_metered_cap_guard.py built + self-tested (fires on projected breach, allows under-cap) + wired into flex runner (guard_or_raise before each call, record after) + class-swept helper for every metered path. v3.2 overrun ($0.487 vs $0.25) acknowledged + recorded. |
| 4 | **Frozen read shape staged** | ⏳ **harness ~built, staging pending; downstream of #1** | pilot_conveyor exposes terminal_read_clean_fraction; the ≥60%-via-clean-fraction gate + economics rider are coded. Needs: fresh clean-room conductor RUN, 2 blind control-gated raters staged, scope lines carried. Sequences after #1 (no point staging a read that grades all-INDETERMINATE). |

## GO/NO-GO
- **#3 GREEN.** #1 is the gate; #2 and #4 sequence behind it.
- **#1 (A-packet) is INSTRUMENT code** (compile-stage producer feeding structural lints), NOT live-capital/irreversible. Per the standing-launch-protocol (instrument fixes AUTONOMOUS under independent grader; explicit go only for irreversible/live-capital), the agent CAN build it autonomously under doer≠grader independent grading + its own ratify-packet — **seal untouched.**
- **The SEAL itself waits for Tonio's explicit trigger, in his own words.** Building the A-packet does not touch it.
- **Recommendation:** authorize the A-packet build (autonomous, independently graded, ratify-packeted). When #1 lands → #2 witness pair + #4 staging complete → machine STOPS and waits for the seal-break go.
