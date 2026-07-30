# spec-binding-parity-expanded — RED-BEFORE baseline corpus (R-481 step 3)

STAGED BASELINE, NOT YET WIRED. These fixtures reproduce the Ledger-E parity
false green measured in R-481 and independently re-measured in AR-488.

Run (Windows-style path required -- an MSYS `/c/...` path makes Windows
node/python raise MODULE_NOT_FOUND/FileNotFoundError, R-481 sec51b):

    $env:TF_SPEC_BINDING_SAMPLES_DIR = "<abs windows path to this dir>"
    node node_modules\tsx\dist\cli.mjs scripts\check-spec-binding-plan-parity.ts

PRE-FIX EXPECTATION (measured AR-488, worktree pinned 9af37b8f): FAIL 3 of 7, exit 1.

  RED   10-lunch-orphan      spine_bound ts=2 py=1 | bindable ts=true py=false
                             primitive ts="session_windows" py=null
                             approximation ts=false py=true
                             session_zone ts="lunch_blackout" py=null
  RED   11-premarket-orphan  same shape, session_zone ts="overnight"
  RED   30-compiled-flip     the above PLUS compiled: ts=true py=false
  GREEN 00-control-shipped   byte copy of the shipped fixture -- MUST stay green
  GREEN 20-nyam-evaluable    evaluable zone binds in both lanes
  GREEN 21-fivemin-chart     unbindable in both lanes
  GREEN 31-flip-neg-control  *** THE DISCRIMINATOR *** identical 3-spine shape to
                             30- but with "ny am" instead of "during lunch".
                             Green here proves the compiled flip is caused by the
                             ORPHAN ZONE, not by the fixture shape.

POST-FIX EXPECTATION: all 7 GREEN, exit 0. A fix that turns 20-/21-/31- red is
refusing everything, which is not a repair.

NOT SUFFICIENT ON ITS OWN. R-481 sec82: F-G (the comparator compares 5 of the 10
fields it collects -- `reason` among the 5 it ignores) MUST close before any
parity result may be admitted. Until then a green run here does NOT establish
that the lanes refuse with the SAME REASON, and that criterion is structurally
uncheckable by this comparator. Do not cite a green run as parity closed.
