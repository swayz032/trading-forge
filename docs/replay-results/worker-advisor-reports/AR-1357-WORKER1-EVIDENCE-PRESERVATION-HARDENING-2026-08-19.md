AR-1357

RULING : AR-1354A (`b3229880`) SS6.A -- narrow nonblocking maintenance item: harden
         `scripts/_ar1353_f5_escalated_attack_proof.py`'s real-evidence mutation with
         try/finally + verified restoration, per AR-1355's own finding against my prior
         AR-1354/AR-1353 lane.
PIN    : `claude/worker1-h1-20260815` @ `968f8f12` (pre-fix) -> this commit (post-fix)
CHANGED: scripts/_ar1353_f5_escalated_attack_proof.py (33 insertions / 12 deletions)

REPAIR : the script mutates a real committed evidence file
         (`opus-batch/75DJN5UVQnw__s0/batch_raw_response.txt`) to construct its attack
         fixture, then restored it via plain sequential statements AFTER the validator
         call -- if anything raised between the mutation and the restore (e.g. the
         unguarded `json.load` a few lines away in `_validate_receipt`), the real file
         would be left stranded with unit E8Wg6tFPYjo's bytes, silently. Wrapped the
         mutate/validate sequence in try/finally so restoration is unconditional, and
         added a post-restore SHA-256 positive witness that raises loudly
         (`EVIDENCE CORRUPTION`) if the restore did not actually land the original bytes
         -- writing bytes back is not proof they landed.

RED    : constructed a throwaway copy of the script (never committed, deleted
         immediately after use) with one injected line -- `raise RuntimeError(...)`
         right before the validator call, i.e. exactly the failure shape the old code
         could not survive. Captured the real file's SHA-256 before running:
           abde6aabe4d6e4bf98922a3b17e5367b14268836a29dfeb50e65bf28d3c8daec
         Ran it: traceback propagated, exit 1 (the crash is NOT swallowed -- a script
         that silently "succeeds" after failing to restore would be worse than one that
         crashes loudly). Re-hashed the real file immediately after:
           abde6aabe4d6e4bf98922a3b17e5367b14268836a29dfeb50e65bf28d3c8daec
         IDENTICAL. The finally block restored the real evidence file correctly even
         though the try block never reached its normal end -- this is the exact
         discriminating proof the old code could not have passed (its restore statement
         was unreachable after an early raise).
GREEN  : $ python scripts/_ar1353_f5_escalated_attack_proof.py
         {"escalated_attack_caught": true, "ok": false, "detail": "batch_task_sha256
          MISMATCH: receipt claims 062d61d2..., this unit's own batch_task_index.json
          records 07b57834..."}
         EXIT=0
         Identical behavior to pre-fix (functional regression check) -- ran twice,
         `git status --short` clean apart from the one intended file both times.
CONTROL: the injected-failure run above IS the adversarial control -- it discriminates
         exactly "restore survives a mid-sequence exception" (fails on the unpatched
         code, passes on the patched code); not re-run against the pre-fix version here
         since AR-1355 already measured the pre-fix behavior directly (unguarded
         sequential statements, confirmed by reading the diff).
GRADER : not required -- test-harness-only change, no production code touched, no new
         certification claim; AR-1354A named this as a narrow nonblocking item, not one
         requiring a fresh independent grade.
FINDINGS: none beyond what AR-1355 already reported (this report closes that finding).
STOP   : none.
NEXT   : none self-authorized. Item B from AR-1354A SS6 (isolated grader-seat/guard
         compatibility) remains explicitly NOT attempted -- protected control-plane
         surface outside this lane's ownership, per AR-1356's disposition. Strategy
         Factory population remains complete per AR-1356 pending GPT's scope decision on
         expansion. Holding here for the next GPT ruling.
