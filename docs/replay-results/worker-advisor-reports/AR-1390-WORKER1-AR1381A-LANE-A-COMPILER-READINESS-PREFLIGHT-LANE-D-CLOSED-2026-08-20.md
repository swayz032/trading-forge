AR-1390

RULING : AR-1381A (`e2b66ca9d176d29f3e8294739afda31fec40ad0f`) sections 5 (Lane A) and 8 (Lane D).

PIN : branch `claude/worker1-h1-20260815`, HEAD `ab12acb9` (Lane D commit) before this Lane A commit.

CHANGED :
- NEW `docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-3-fresh-opus/E8Wg6tFPYjo/compiler_readiness_preflight.md` — the required Lane A matrix, read-only.
- (Lane D, already committed/pushed at `ab12acb9`): `.claude/skills/worker-onboarding/SKILL.md` branch-head-by-commit-time fix + wrong-ref ear-arming warning; NEW `docs/replay-results/CURRENT_STATE.md` navigation pointer.

RED : n/a — read-only preflight, not a repair.

GREEN : n/a — no compile/certify/backtest/compiler-edit performed, per the ruling's own lock on this lane. Matrix built by: (1) grepping `src/` for any code consuming the candidate schema (`entry_sequence`/`setup`/`targets`/`priority`) — none found, confirming AR-1380A's "no certifier/compiler authority exists yet" for this exact schema; (2) re-reading every item in the candidate's `source_gaps[]` + `top_level_source_gaps[]` directly against the transcript; (3) classifying each per the ruling's 5-state taxonomy.

CONTROL : n/a (not a repair/mutation task).

GRADER : not dispatched — read-only classification task, no claim requiring independent re-derivation beyond what's already in the matrix's own reasoning column.

FINDINGS:
- **One load-bearing architectural judgment call surfaced explicitly for GPT to confirm or override**: no compiler/bridge exists yet for this candidate schema, so I classified risk-management source_gaps (stop anchor, target sequencing, position sizing, drawdown threshold, order expiry) against the project's standing invariant that stops/targets/sizing are framework-owned and get replaced downstream, never compiled from source literal values (`advisor-ruling` skill section 6.4, CLAUDE.md section 4). This is precedent from the OLDER, separately-built scout pipeline (`framework-overlay.ts`, a different DSL shape entirely — `ema_crossover{fast:9,slow:21}` style, not this candidate's `entry_sequence`/`targets` shape) — not proof the not-yet-built Factory compiler will follow the same pattern. Flagged per-item in the matrix as `(precedent, not proven for this pipeline)`.
- **5 items reclassified from "missing source fact" to "representation defect fixable from existing transcript text, no new evidence needed"**: break-of-structure definition (transcript names a public substitute mechanism — TradingView fractals/Williams fractals), imbalance/FVG qualification (fully defined in-transcript, just never bound as its own atomic claim), structure timeframe (both worked examples are visually on the stated execution timeframe), action-on-level-violation (the candidate's own `management[]` rows already answer this), and HIGH A itself. This narrows what actually needs Visual Intelligence — only 2 items (sell-side Fibonacci anchor direction, already VI-E8-1; 4h trading-range construction, not yet targeted) have no source-text-only fix.
- **3 items are high-confidence non-blockers independent of the precedent question** (position sizing, session/news filters, trade frequency/concurrency) — these are hard, general, already-built project invariants (CLAUDE.md section 4/12), not analogy from a different pipeline.
- **HIGH B's downstream compile relevance is genuinely split**: likely compile-inert if the framework-owned-target precedent holds, but still a real candidate/audit-fidelity defect regardless of what the eventual compiler does with the value — flagged as such rather than resolved either way.
- No findings against prior sessions' work.

STOP : none for Lane D (closed). Lane A's one open item is the architectural precedent question above — this is a judgment call surfaced for GPT confirmation, not a contradiction requiring a full stop; the matrix is complete and durable either way the precedent question resolves.

NEXT : Per AR-1381A's own sequencing (Lane C waits on A/B), no round-4 candidate work starts here. Lane B (VI-E8-1, VI-E8-2) is authorized but requires an external Visual Intelligence actor this session cannot invoke directly — same dependency shape as the GPT-5.6 audits (AR-1382/AR-1387 precedent). Awaiting: (1) GPT confirmation/override on the framework-owned-risk precedent question above, since it changes how many matrix items are true blockers vs. architecture-as-designed; (2) whether item 3 (HTF trading-range construction) should become a third Lane B visual question; (3) Lane B's Visual Intelligence results, whichever actor GPT designates to run them.
