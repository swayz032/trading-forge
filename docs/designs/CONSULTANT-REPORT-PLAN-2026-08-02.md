# CONSULTANT REPORT 2 — THE PLAN (operator-ordered delivery) · 2026-08-02 (local)

**Author:** the same outside-consultant session as `CONSULTANT-REPORT-VELOCITY-2026-08-02.md` (claude.exe 26296, NO seat). **Operator orders behind this file, verbatim shape:** *"SO WHAT'S THE PLAN?"* → the plan below was given to him → *"WRITE THE REPORT TO THE ADVISOR NOW."* Deviation bounded as before: this file + one `## EXT-CONSULT-2` pointer block, headed non-`AR-` so the worker's numbering and both ears' greps stay unbroken. **Grade everything [RELAYED] unless marked otherwise; the design decisions named here are yours, not mine.**

**Position joined against (headlines only — I have not read the bodies):** newest ruling `R-606` ("mapping question answered by measurement — 4d was already assigned to red-proof.mjs's 43, not the knobs; six rulings may have measured the wrong population; UNRESOLVED_SOURCE_AMBIGUITY on the table"), newest AR `AR-650` (worker active on the swallow-detector under `R-605 §5.1`). `[ARTIFACT-SOURCED — grep of both tops + commit subjects at 1d622c0c]` §3.2's "rule the reading/category" recommendation from EXT-CONSULT-1 is therefore largely overtaken by your own R-604→R-606 sequence — credit where due, that was the fastest stretch in tonight's ledger.

---

## §1 — NEWS THE DESK MAY NOT HAVE: THE COMPILER-ACCELERATION RESEARCH IS **COMPLETE**

EXT-CONSULT-1 said "in flight"; it has landed: **`docs/research/RESEARCH-VELOCITY-TOPSTEPX-2026-08-03.md`** — Part 1 spec-to-code fidelity architecture, Part 2 instrument-qualification velocity, Part 3 shipped LLM-verification loops, Appendix A = TopstepX material the operator de-scoped ("we already have the rules"). The researcher also folded evidence into `docs/institutional-evidence/spec-to-code-fidelity.md` and `docs/institutional-evidence/instrument-qualification-velocity.md`. `[RELAYED — researcher's closing summary; I have not read the report bodies; per-claim citations are claimed to be ≥2025-dated inside]`
**Operator directive, relayed:** read it **before the next design-closure ruling**.

## §2 — THE HEADLINE RECOMMENDATION: EVALUATE A REFERENCE-ORACLE AT DESIGN CLOSURE

`[RELAYED throughout — researcher's executive summary; verify in the file]`

- **The pattern:** one deliberately-simple, obviously-faithful **reference interpreter** of the compiler's intermediate strategy representation, qualified ONCE — with **differential testing against it as the primary correctness oracle** — plus cheap golden-trace/property tests (fee-monotonicity, cash-invariance) as a second layer catching a different bug class.
- **Why it maps to this campaign:** the remaining instrument chain after `P0PC` (`P0PG → P0VC → P0DG → P0I → P0IG`) is the N-bespoke-checkers pattern; each checker needs qualifying forever, and tonight's ledger is the live demonstration of what that costs. A reference oracle moves the qualification burden to one object, once.
- **In-domain evidence:** a third party transpiled Pine Script v6 to C++ and hit **245/246 strategies at trade-for-trade parity across 375,000+ trades** by diffing against TradingView's real compiler as the oracle.
- **On the desk's stop rule:** five sources including Jane Street's engineering blog say "adversarial passes come back empty" is **necessary but not sufficient** — their mature quickcheck+fuzz+chaos stack still missed a real bug for a month. This cuts toward oracle-diversity, not toward more bespoke checkers.
- **Shipped LLM-verification loops** (Block/Square, G-Research, a NinjaTrader MCP vendor) converge on four elements: independent oracle · two-pass recall-then-precision · structural (not exact-match) checks on non-deterministic output · human-gated stop before deploy.
- 🛑 **The consultant's own caveat, stated so it cannot be over-read:** the researcher did **not** cross-reference Trading Forge's actual compiler/verification code (its own declared limit). Whether a reference-oracle slots in at `P0VC`, reshapes `P0-vNext` entirely, or interacts with R-606's population finding is a **seat judgment on unmeasured mapping** — `UNRESOLVED` until you join it to the artifacts. Do not treat the architecture-to-node mapping as established by this file.

## §3 — THE PLAN AS GIVEN TO THE OPERATOR (relay of intent; align or correct it with him)

1. **Now:** worker closes `R-605 §5.1`; the desk disposes of EXT-CONSULT-1's width/batch recommendations whichever way it rules.
2. **This week — the fork:** when `P0PC` closes, the design-closure step evaluates the reference-oracle adoption (§2). The operator was told plainly: this one decision is most of the difference between a fast August and a slow one. In parallel, two off-path lanes: battery-rig **fault-injection** calibration (scoping at `docs/research/SCOPING-BATTERY-NULLCAL-2026-08-03.md`) and the main-repo metrics-test gap ticket (`test_metric_snapshot.py` re-implements engine math).
3. **Then:** first spec through the compiler under the adopted oracle → battery wave on a rig that has been proven able to go RED → survivor into paper/shadow, which burns **calendar days that cannot be compressed, only started earlier** — the stated reason for parallel clocks now.
4. **Operator levers on record with him:** TopstepX API + eval purchase the day the first wave shows promise (R-060's pre-positioned last mile) · he expects **measured weekly velocity** (steps closed, lanes running, finding-rate trend) · **no date was promised to him**, and he has been told why (two withdrawn finish lines).

## §4 — LIMITS

§1/§2 rest on the researcher's summary; the file's citations are the evidence, not this relay. §3 is the operator's intent as heard in the consultant window — confirm with him before it drives anything irreversible. Nothing here is authorization; all consultant files remain uncommitted for your disposition.
