AR-1356

RULING : AR-1354A (`b3229880`) SS9 "Exact next Worker-1 order" -- resume Strategy Factory
         conveyor under AR-1340A, process units continuously, report on stop-condition 3
         ("the current frozen Factory population completes and the final disposition
         counts are available").
PIN    : working tree `claude/worker1-h1-20260815` @ `7663ed93`; manifest
         `docs/replay-results/strategy-factory-census/library-manifest-v1.1.json`
         sha256 `3b479d5e07896ed3bea066bd4e4233a32cceb15e6cb599628fc1bcc243340f0d`
CHANGED: no production files. Regenerated (not hand-edited) the two derived artifacts
         below by running their real committed producers.

PRIOR-ART CHECK (worker-execution SS0.-0.5): before dispatching any Stage-1/Stage-2
adjudication work, ran `system_inventory.py --check` (FRESH) and located the real
conveyor machinery already built (`src/engine/extraction/pilot_conveyor.py`,
`scripts/strategy_factory_prepare_and_finalize.py` prep/adjudication-ingest/finalize
subcommands) rather than hand-rolling a driver. Then measured current state BEFORE
assuming any unit needed a fresh dispatch.

MEASURED, per `batch-disposition-integrity`'s admission contract (bidirectional
reconciliation, not counts alone):

  $ python scripts/strategy_factory_prep_provenance_inventory.py
  {"total_units": 47, "by_backend": {"opus_batch": 42, "none": 5}, "needs_regeneration_count": 0}
  -> all 42 opus_batch units already carry a finalized certificate_status
     (pilot_grade=False, full_grade=False -- adjudicated and refused, not pending).
     The 5 "none"-backend units have no spine conditions to locate (locator authority
     question does not apply), also not pending adjudication.

  $ python scripts/strategy_factory_manifest_row_projection.py
  {"total_manifest_rows": 120, "rows_projected": 102, "rows_identity_unresolved": 15,
   "rows_out_of_scope": 3,
   "disposition_counts": {"OTHER_MEASURED_REFUSAL": 93,
     "EXTRACTION_MISSING_REQUIRED_INFORMATION": 9, "IDENTITY_MATERIALIZATION_UNRESOLVED": 15},
   "multi_strategy_videos_failed_closed": 5, "rows_crosswalked_single_strategy": 102,
   "rows_failed_closed_multi_strategy": 15, "strategy_indices_unrepresented_total": 13}

RECONCILIATION: independently confirmed `library-manifest-v1.1.json` is a JSON array of
exactly 120 entries (counted directly, not trusted from the tool's own summary). Bucket
sum 102 (rows) + 15 (identity_unresolved_rows) + 3 (out_of_scope) = 120 -- exact, no
missing/extra/duplicate identity. Disposition-count sum 93+9=102 matches `rows` list
length exactly; the separate 15 `IDENTITY_MATERIALIZATION_UNRESOLVED` count matches the
separate `identity_unresolved_rows` list length exactly. No `FAITHFUL_COMPILE_READY_FOR_BACKTEST`
rows exist. No `DUPLICATE_OR_EQUIVALENT_STRATEGY` rows exist (no duplicates to retain).

These are the IDENTICAL numbers AR-1353A SS4 already cited as "current factory truth"
(120/102/15/3, 93/9/15/0-survivors) -- re-derived here FRESH by re-running the real
producers against the current committed tree, not copied from that ruling's text. No
drift since that read.

GREEN  : both producers exit 0; reconciliation is exact; determinism confirmed (re-ran
         the inventory step twice in the earlier AR-1355 pinned-worktree session and
         once more here on the shared branch -- identical 42/5/0 and 120/102/15/3 every
         time).
CONTROL: n/a -- this is a measurement/reconciliation pass, not a code change. The
         adversarial control for the underlying locator authority was already executed
         and reported in AR-1355.
GRADER : not required -- no new production code, no new certification claim beyond a
         mechanical count reconciliation.
FINDINGS: none against the current state. Per AR-1354A SS4, the refusal-heavy
         disposition (93/102 `OTHER_MEASURED_REFUSAL`) is explicitly NOT reopened by
         this report -- "the current refusal dispositions merely because yield is low"
         stays frozen. I did not re-litigate why any individual unit refused.
STOP   : AR-1354A SS9 stop-condition 3 fired -- "the current frozen Factory population
         completes and the final disposition counts are available." It fired
         IMMEDIATELY on resume: every one of the 120 manifest rows already carries a
         final disposition (0 pending Stage-1/Stage-2 dispatch, 0 needs_regeneration).
         There was no unprocessed unit to run the conveyor against under the CURRENT
         manifest pin. I did not manufacture work by expanding the manifest myself --
         population size is a scope decision (0-CTRL.6: I may not silently expand
         scope).
NEXT   : population EXPANSION (the "40-video modern extraction upgrade" / "200-video
         library plan" referenced in AR-1338A / AR-1141) is a scope decision reserved for
         GPT -- not self-authorized here. Of AR-1354A SS6's two nonblocking maintenance
         items, item A (evidence-preservation try/finally hardening in
         `_ar1353_f5_escalated_attack_proof.py`) is narrow, already pre-authorized
         ("Do not hold the Strategy Factory waiting on those maintenance items"), and is
         MY OWN prior AR-1354/AR-1353 lane -- in scope for compiler-factory. Per
         worker-execution SS11a ("is my next item already authorized? if yes, start it in
         the same turn"), starting it now; separate report to follow. Item B (isolated
         grader-seat/guard compatibility) requires editing guard/session-arming
         config/hooks, which is a protected control-plane surface this lane does not own
         (`worker1-hook-guard-manifest.json`, `claude_guard_hook.mjs`,
         `worker1_seat_launch.ps1`) -- explicitly NOT attempted; flagging for whichever
         lane owns control-plane/guard repair (a `control-plane/ar-1278-guard-repair`-
         style lane already exists in this repo's worktree list).
