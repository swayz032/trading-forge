# AR-1333

RULING : AR-1328A Packet A (freeze the authoritative library manifest), followed under `worker-execution`
         S0.-0.5 prior-art check and `batch-disposition-integrity` admission contract.
PIN    : working tree `claude/worker1-h1-20260815` @ `9c4f2926` (clean before this report)
CHANGED: none (read-only investigation; this report file only)

STOP   : AR-1328A Packet A's own escape clause fired: "If two repository surfaces disagree on
         library membership, STOP only the manifest-freeze step and report the exact set
         difference. Do not choose the convenient population." Packets B/C (10-member pilot,
         full-library run) are NOT started -- they depend on Packet A's frozen manifest.

## WHAT WAS SEARCHED (worker-execution S0.-0.5 prior-art check, before building anything)

Grepped `docs/designs/ADVISOR-RULINGS.md`, `docs/designs/AGENT-REPORTS.md`, `AR-1153`, `AR-1327A`,
`AR-1325A`, `src/` and `~/.claude/.../memory/` for "strategy library" / "library manifest" /
"V1.1" / "corpus" / "source inventory" before writing any code. Found FOUR candidate populations
that disagree on membership, scope, and schema -- none documented anywhere as "the Strategy
Factory input manifest":

1. **`docs/designs/source-videos-2026-07-02.json`** -- 40 unique source videos / 117 strategy
   names (x3-symbol expansion: MES/MNQ/MCL), + 4 named `unresolved_strategies`. Old-era naming
   convention (`concept_symbol_timeframe`), dated 2026-07-02.

2. **The LIVE `strategies` DB table -- "POP-120-LIVE"**, per `ADVISOR-RULINGS.md` R-418/R-422
   (2026-07-28): *"the operator's REAL strategy library... 120 of 120 rows carry
   `compiled_spec`"*, explicitly distinguished by ruling from the campaign corpus ("corpus_A" /
   "POP-16") -- *"a different population again... per the population ruling it may not be
   inferred from POP-16."* This is the strongest-worded candidate (an explicit GPT/advisor
   population-naming mandate exists because this exact class of conflation already burned the
   campaign once). **Could not independently re-measure**: `DATABASE_URL` is unset in this
   session's environment and no `.env`/vault credential is available to this worktree --
   pulling one would be a credential-decryption action, which `CLAUDE.md` S13 and
   `worker-onboarding` S4 both list under STOP-and-ask, not something to self-authorize.
   Also unresolved: these 120 rows already carry a `compiled_spec` from the OLDER
   scout-pipeline DSL compile path (`CLAUDE.md` S2b), not the NEW certified-source-graph -> SPINE-A
   path Stage 1/2 just certified -- whether Packet A means "re-run these 120 through the new
   compiler from their ORIGINAL source teaching" (and if so, whether that source teaching is
   even still traceable per-row) is a second open question this population raises, not answered
   by finding it.

3. **The H1 pilot extraction-fidelity EXAM population** -- `docs/replay-results/h1-battery/
   tier-a-extraction-provenance/` + `h1-sealed-read-frozen/SEALED-READ/phase_b/` (11 unique
   videos / 13 strategy records, `tier-a-clean-strategy-receipt.json`: 11/13 clean), and the
   much-reprocessed `docs/replay-results/h1-scripts/{frontier-designpool*,claude-rung-designpool*,
   pilot-run,wave6-pass1/2-design-pool}/` trees (~16 video IDs, many experimental passes of the
   SAME fixed set). These share sVkm's modern minimal-8-field extraction schema
   (`entry_sequence`/`confluences`/`stop`/`targets`), but their documented purpose (per
   `pilot_conveyor.py`'s own docstring and the pre-reg it implements) is grading the EXTRACTOR's
   own condition-classification accuracy (tier-1/tier-3 certification), not curating a strategy
   library for trading compilation. sVkm itself is NOT a member of this set.

4. **`docs/designs/corpus-v3-*` / `corpus-v2-mode-ab-strategies.json`** (2026-07-05..07) -- a
   14-video "CONCEPTS" pinning manifest (`scripts/corpus-v3-shadow-gate3.py`) that DOES include
   sVkm (tagged "risk"/1m) alongside 13 siblings, but its artifacts are PRE-COMPILED
   `.spec.json` files from an old role-demotion-classifier shadow-test project
   (`.claude/worktrees/extraction-100/corpus/specs/`), not raw extraction records in the shape
   the new SPINE-A/`spec_producer.py` compiler consumes.

## WHY THIS IS A STOP, NOT A JUDGMENT CALL

- Populations 1, 2 and 4 use the OLD DSL-era pipeline/schema; population 3 uses the NEW schema
  but is documented as an extraction-fidelity exam set, not a trading-strategy library, and
  excludes sVkm (the packet's own required positive control).
- `ADVISOR-RULINGS.md` R-422 makes population-naming discipline **mandatory** precisely because
  a prior seat conflated the campaign corpus with the live library and drew a false conclusion
  from the wrong one. Picking one of these four without a ruling would repeat that exact,
  already-convicted failure mode.
- I have not built anything on top of any of these four populations. No compiler, no second
  disposition vocabulary, no hand-maintained ledger -- per AR-1328A S1 and `batch-disposition-
  integrity`'s admission contract, membership must be reconciled BEFORE any compile is attempted.

## RECOMMENDATION (for GPT to rule on, not self-authorized)

Candidate 2 (live `strategies` DB, POP-120-LIVE) is the best-evidenced "current repository
authority for the existing strategy-library input population" by ruling precedent (R-418/R-422
name it explicitly as *the* real library), but two things block adopting it unilaterally:
(a) I cannot read it from this session (no DB credential -- STOP-and-ask class action, not mine
to self-authorize), and (b) whether Packet B/C means re-deriving each row's ORIGINAL source
teaching for the new certified pipeline, or something narrower, is undetermined from the ruling
text alone.

NEXT   : Awaiting GPT disposition on (i) which population is the Packet-A-authoritative one --
         POP-120-LIVE, source-videos-2026-07-02.json's 40-video set, a merge of both, or a
         population not yet named; (ii) whether a DB read credential should be supplied/how,
         if POP-120-LIVE is confirmed; (iii) for POP-120-LIVE specifically, whether each row's
         original source-video teaching is expected to be re-derived for the new certified-graph
         pipeline, or whether Packet A/B/C intends a narrower definition of "compile" for rows
         that already carry an older `compiled_spec`. Holding here per AR-1328A S2's own STOP
         clause -- not self-authorizing a population choice for a load-bearing manifest freeze.
FINDINGS: none against my own prior work this session (this is the START of AR-1328A execution).
CONTROL: N/A (no compile attempted; nothing to mutation-test yet).
GRADER : not dispatched (no delivery to grade -- Packet A did not complete).
