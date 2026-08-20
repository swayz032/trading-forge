# AR-1374 — GUARD-V2 PROMOTION CLOSEOUT (CPB-0011)

**Date:** 2026-08-19
**Actor:** top-level-control-plane-guard-repair
**Ruling:** AR-1367A
**Authorization:** cpb-2026-08-19-0011
**Branch:** control-plane/ar-1367a-guard-repair-cpb-2026-08-19-0011
**Source HEAD:** 39b354e4cb9dfacf2a615605b1cfaf2fd948787d

---

## 1. BOOTSTRAP PLAN & CLAIM

Bootstrap `--plan` accepted the cpb-2026-08-19-0011 marker from the AR-1367A ruling on `origin/external-advisor/gpt-rulings`. The claim was durably written before the privileged SessionStart launched (claim-before-launch law).

**Privileged SessionStart result:** CONTROL-PLANE SEAT ARMED: actor=top-level-control-plane-guard-repair packet=AR-1367A branch=control-plane/ar-1367a-guard-repair-cpb-2026-08-19-0011 head=39b354e4cb9d authorization=cpb-2026-08-19-0011 authorized_paths=4.

---

## 2. TOOLBOX PIN CHANGE

**Before:**
- `scripts/claude_toolbox.mjs` TOOLBOX_PIN = `59cfb1cdd1a9779e2a7be406397bea52362db467`

**After:**
- `scripts/claude_toolbox.mjs` TOOLBOX_PIN = `4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`

Pin-history comment updated with the deliberate descendant transition record.

---

## 3. MANIFEST IDENTITY UPDATE

**Before:**
- `_toolbox_pin` = `59cfb1cdd1a9779e2a7be406397bea52362db467`
- `_toolbox_bundle_sha256` = `849253f1e5a08f7c9f1e0f177d9a956e50a249612df24476a97dde6c0f36ee7d`

**After:**
- `_toolbox_pin` = `4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`
- `_toolbox_bundle_sha256` = `5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801`

Pin history updated with the `-> 4c6f36ea (AR-1367A Guard-V2 promotion, cpb-2026-08-19-0011, 2026-08-19, 56-file target bundle 5b54027e)` entry. Provenance note `_why_4c6f36ea` added. No other manifest fields changed; edit scope, G2 policy, session identity, lifecycle controls all untouched.

---

## 4. GUARD-V2 TARGET IDENTITY

- **Target commit:** `4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`
- **Target toolbox bundle (56 files):** `5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801`
- **Bootstrap bundle (10 files):** `f75739efcc41fe8763b6f779e46ee4862900ebbd0673d799d344c4f5fb1dc613`

---

## 5. PROMPT-TRANSPORT MATERIALIZER

**Command:** `python scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py`

Result: WROTE 8 prompt artifacts + index to `docs/replay-results/g2d-prompt-transport`. All 8 entries hashed against the frozen native-call manifest.

---

## 6. BOUNDED REGRESSION TESTS

### Test 1: `node --test scripts/control_plane_bootstrap.test.mjs`
- **Result:** 175 pass, 0 fail, 0 cancelled, 0 skipped
- **Duration:** ~15.9s

### Test 2: `node --test scripts/control-plane-bootstrap/lifecycle.test.mjs`
- **Result:** File does not exist at this HEAD. Not a failure — the allowlist names it for future use; no lifecycle test file is present in the current repository state.

---

## 7. FROZEN QUEUE/RECEIPT STATE

**Before and after — unchanged:**
- Queue SHA256: `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`
- READY: 8
- SPENT: 0
- Receipt tree: `GIT_TREE:c11966868f8a511554e1f26bf6e5555c59833d04`
- Receipt path: clean

Zero frozen-state files touched by this seat.

---

## 8. STAGED PATH SET

Exactly:
1. `scripts/claude_toolbox.mjs`
2. `.claude/worker1-hook-guard-manifest.json`
3. `docs/replay-results/worker-advisor-reports/AR-1374-WORKER1-GUARD-V2-PROMOTION-CLOSEOUT-CPB0011-2026-08-19.md`

`scripts/control-plane-bootstrap/.cp-commit-msg.tmp` is writable but **never staged** — consumed and deleted by cp-finalize.mjs.

---

## 9. FINAL COMMIT & PUSH

- **Commit SHA:** _(populated by cp-finalize.mjs)_
- **Push result:** _(populated by cp-finalize.mjs)_
- **Completion receipt:** written by cp-finalize.mjs into the git directory, outside the working tree.

---

## 10. INVARIANTS

- Zero Agent/Task/model execution inside this privileged seat.
- Zero PowerShell execution.
- Zero edits to frozen G2 queue, receipts, or native-call manifest.
- Zero edits to `.claude/settings.json` or `.claude/settings.local.json`.
- Zero edits outside the 4 authorized paths.
- `scripts/control-plane-bootstrap/.cp-commit-msg.tmp` written but never staged.
- Phase 2 verification (traversal calibration, Worker-1 acceptance checks per ruling section 3) deferred to a fresh, ordinary Worker-1 seat as required — this privileged seat does not perform it.
