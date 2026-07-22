# RATIFY PACKET — TOOTH-1 FIX (Leg A compile-fidelity: F-1 false-positive + F-2 fail-open)

Date: 2026-07-21 · Worktree: `wt-h1-wave4-20260712` (branch `h1-wave4-sealed12-driver`)
Anchors: `docs/designs/survivor-forensics-preregistration-2026-07-19.md` (sha256
`7fe3995b…`, R-070) §1-A(ii) / §6a; **R-260 §1** (F-1 direction RULED: Leg A(ii) anchors to
the enforced honest accounting, flag-independent).

Class: **AUTONOMOUS** (pre-live, pre-candidacy; the Tooth-1 detector is inert — its passage-
ledger GateClass is `reserved=True`, no live candidacy invocation runs. No live default, no
frozen-ref re-baseline, no operator data touched). The **independent grader that found these
two holes is the gate**; this packet does not self-certify.

---

## 1. What & why now (receipts — both holes reproduced, flags OFF/default)

The independent grader found two CRITICAL holes in the Leg A compile-fidelity detector.
Reproduced verbatim (`scratchpad/repro_holes.py`, `PYTHONPATH=. python …`, flag
`TF_FAMILY_META_ENFORCED` unset = OFF):

**F-1 (false positive).** Leg A(ii) reads `binding.approximation`, which
`compile_binding_plan` sets to `meta.effective_approximation()` — and that is FLAG-GATED
(`spec_family_bindings.py:588-591`): with the flag OFF it returns `base_approximation`, the
engine's own convenience label. For `ENABLE_ENTRY`/`ENTER` and `INVALIDATE`,
`base_approximation=False` while the enforced honest value `enforced_approximation=True`
(`spec_family_bindings.py:663,683,705,713`; the code's own comments call the legacy values a
"fidelity lie", `:676`, and "never evaluated as conditions at all", `:689`). Measured:

```
ENABLE_ENTRY:t#2   binding.approximation=False   HONEST_enforced_approx=True
INVALIDATE:s#3     binding.approximation=False   HONEST_enforced_approx=True
```

Repro: retype a clean spine condition to `ENABLE_ENTRY` → Leg A returns **PASS, checks_failed=[]**.
It must BLOCK. The clean known-good fixture itself was passing whole PARTLY on this hole (its
`ENABLE_ENTRY` trigger and `INVALIDATE` both scored (ii)=PASS via the convenience label).

**F-2 (fail-open).** `_check_provenance_chain` only special-cased `certificate is None`.
- `certificate={}` → PASS, `checks_failed=set()` (a leg with zero provenance certifies clean).
- `certificate=[…]` (any non-dict) → PASS (the `isinstance(dict)` guards silently skip the
  drop-audit and the video-link, so `vi_cert` passes vacuously).
- `countersignatures=[…]` (non-empty non-dict) → **uncaught `AttributeError`** in
  `countersign_phase2` (`countersignatures.get(cid)`) — a crash, not a fail-closed BLOCK.

**Latent bypass.** `run_leg_a_phase1(…, binding_plan=…)` lets a caller inject a pre-built plan
that skips the fresh re-derivation — the exact thing (ii) exists to prevent ("re-derived from
the live code path, never trusted"). Grep confirms **no external caller** supplies it (only
`run_leg_a` passes it through internally; `spec_condition_compiler.py`'s param is a different
class).

## 2. Blast radius

- **What "concretely bound" now means:** a load-bearing condition of family `ENABLE_ENTRY`,
  `ENTER`, or `INVALIDATE` now fails Leg A(ii) — because their honest enforced accounting is
  `approximation=True` (spine-conjunction mechanism / a structural stop measured
  `production_executed=False`). This is the intended consequence of R-260 §1.
- **Corpus Leg-A(ii) verdicts (COMPUTED, 16 shakedown + 2 dod = 18 paths; 16 unique + 2 dod
  that duplicate 2 shakedown by video-id):** BEFORE — 18/18 BLOCK, **0 pass Leg A(ii)**, 175
  rows fail (ii). AFTER — still 18/18 BLOCK, **still 0 pass Leg A(ii)**; the row-level (ii)
  failure count rises (monotonic — the anchor only ADDS convictions, never removes one), so no
  spec flips from BLOCK→PASS or PASS→BLOCK. No published verdict changes.
- **No published number moves.** The detector is inert (reserved gate, no consumer). The honest
  values it now reads are the SAME `enforced_approximation` accounting the §6a denominators and
  the 0.9531 figure were computed under (R-260 §1(i)) — they AGREE by construction; this fix
  does not touch, recompute, or re-baseline them. `2/21/4`, the resolver, the sealed fence, the
  77 sealed, and every flag are untouched.
- **Fixture rebuild (in-scope, required):** the synthetic clean known-good fixture must now
  pass whole for the RIGHT reason (its genuinely honest-bound `WAIT_SESSION` spine), so its
  `ENABLE_ENTRY` trigger is dispositioned non-load-bearing (role=trigger, `gates=False` by
  family — the trigger IS the spine conjunction, audited via the spine's own (ii) rows) and its
  load-bearing `INVALIDATE` is removed (a load-bearing `INVALIDATE` honestly fails (ii) and may
  not appear in a whole-passing fixture). Placeholder m2 is re-pointed to drop a spine condition
  (it previously dropped the removed `INVALIDATE`). No live m1–m7 (grader-authored) touched.

## 3. The exact change, scope-locked

IN:
- `src/engine/spec_family_bindings.py` — ADD one pure, flag-independent read-only method
  `FamilyMeta.enforced_honest_approximation()` mirroring the existing flag-independent
  `enforced_declaration()`. Additive; changes no existing behavior, flips no flag.
- `src/engine/forensics/compile_fidelity.py` —
  (F-1) route (ii)'s approximation truth through `enforced_honest_approximation()` in
  `_check_concretely_bound`;
  (F-2) shape-guard the certificate (`isinstance(dict)` + required keys `video`,`conditions`;
  `{}`/non-dict → named BLOCK) in `_check_provenance_chain`; shape-guard `countersignatures`
  (non-dict → graceful BLOCK) in `countersign_phase2`;
  (#3) REMOVE the `binding_plan=` parameter from `run_leg_a_phase1`/`run_leg_a`.
- `src/engine/tests/_forensics_fixtures.py` — rebuild `clean_spec_body` (honest-pass) + re-point
  placeholder m2.
- `src/engine/tests/test_compile_fidelity_leg_a.py` — ADD the founding red-proofs as revival
  probes (F-1 ×3, honest-good-passes, F-2 ×3, binding_plan removal).

OUT (explicitly): the m4 false-flag check's own comparison basis (separate check, unchanged);
`binding.executed`/`production_executed` anchoring (approximation anchor alone convicts the
only `production_executed=False` family, `INVALIDATE`, so no additional hole — NAMED, not
expanded); the live m1–m7 grader mutations; `spec_condition_compiler.py`'s own `binding_plan`;
the resolver; `2/21/4`; every flag; the sealed fence / 77 sealed; §6a denominators / 0.9531.

## 4. Verification plan (ships with the change)

- F-1 red-proofs (revival probes): retype-to-`ENABLE_ENTRY` → BLOCK on (ii); an
  `ENABLE_ENTRY`-leaning and an `INVALIDATE`-leaning spec both BLOCK on (ii); the honest-good
  fixture PASSES whole and its (ii)-applicable rows are exactly the `WAIT_SESSION` spine
  (right-reason assertion); all with flag OFF (proves flag-independence).
- F-2 red-proofs: `certificate={}` → BLOCK (named `vi_cert`); `certificate=[list]` → BLOCK;
  `countersignatures=[list]` → graceful BLOCK (no crash).
- #3 red-proof: `run_leg_a_phase1` no longer accepts `binding_plan` (TypeError on inject).
- Corpus blast-radius: re-run the 18-path measurement; assert still 0 pass (ii), 18/18 BLOCK,
  ii-fail rows monotonically ≥ before.
- Full `pytest src/engine/tests/test_compile_fidelity_leg_a.py
  test_calibration_battery_framework.py test_spec_family_bindings.py test_family_meta_enforcement.py`
  under system `python` (pure — no `data_cache`). Counts reported COMPUTED.

## 5. Rollback

All edits are additive or predicate-strengthening. Revert the single commit: the new method,
the four `compile_fidelity.py` edits, the fixture rebuild, and the new tests come and go
together. No flag, no migration, no live default, no frozen hash. The `binding_plan` removal
restores trivially (re-add the kwarg). Nothing downstream depends on the changed code (inert
detector).

---

## AMENDMENT A1 — F-2 validity residual (post-re-grade, 2026-07-21)

The same independent grader re-attacked the fixed surface (a fix is a new surface) and found a
narrower instance of the original F-2 fail-open class: the certificate shape-guard checked key
**presence** (`k not in certificate`), not key **validity**. A certificate carrying both
required keys **present but null/empty** slipped through to a clean pass:
`{'video':None,'conditions':None}` → PASS, `{'video':None,'conditions':[]}` → PASS
(reproduced end-to-end: a null-provenance certificate certified a `ROBUST-SURVIVOR` clean pass).
Mechanism: the presence list was empty for present-but-null keys, and the mismatch guard
`cert_video is not None` then never fired.

**Fix (scoped, additive/predicate-strengthening):** the guard now checks VALIDITY via
`_cert_key_invalid()` — a required key that is missing, `None`, empty/whitespace string, or an
empty/anchorless collection is as absent as a missing key → BLOCK with the named `vi_cert`
reason. **Valid-`conditions` choice (stated per the ambiguity call):** a NON-EMPTY list carrying
at least one dict with a non-empty `quote_anchor` — because `quote_anchor` is the only
provenance the (v) drop-audit can reconcile a spec condition against; a ledger with no
reconcilable anchor is provenance in name only.

**No regression:** `{}`, non-dict, and missing-key still BLOCK; F-1, the bypass removal, and the
honest-good fixture's real certificate (populated video + anchor-bearing conditions) still PASS
for the right reason. **Blast radius (R-261 mint):** corpus re-run unchanged — 18/18 BLOCK, 0
pass Leg A(ii), 183 ii-fail rows (identical to the pre-amendment fix; the change touches only
certificate validation, no `approximation` accounting), 0 verdict flips, no published number
moved. Registered as revival probes (`test_f2_null_valued_certificate_keys_block`,
`test_f2_honest_good_certificate_passes_for_the_right_reason`). Does NOT self-certify — the same
grader re-attacks after.

---

## AMENDMENT A2 — two compounding weaknesses on the `_cert_key_invalid` surface (a fix is a new surface)

The re-grade rose 5→6 and re-attacked the new validity surface; two compounding weaknesses,
both the any-vs-each shape:

- **Attack A (ANY-not-ALL):** `_cert_key_invalid`'s `conditions` branch validated with
  `any(... quote_anchor ...)` — a ledger of 5 anchorless entries riding 1 valid anchor passed.
  Aggregate-hides-individual blindness at the certificate layer.
- **Attack B (unbounded substring):** `_check_no_certificate_drops` matched with bare
  `anchor in st` — a one-char anchor `"a"` reconciled against essentially every spec text, so
  `certificate.conditions = [{"quote_anchor": "a"}]` rode to a full `ROBUST-SURVIVOR` PASS. The
  two compounded: `"a"` passed the (non-empty) validity gate AND the drop-audit.

**Fix (two parts, both required):**
1. **`any` → `all`:** every conditions entry must be a dict carrying a non-empty `quote_anchor`;
   one anchorless entry makes the ledger provenance-incomplete → BLOCK `vi_cert`.
2. **Anchor specificity:** a new `MIN_ANCHOR_TOKENS = 2` floor + token-boundary matching
   (`_anchor_maps_to_spec`, space-padded) replaces bare substring — a sub-threshold anchor
   (single char/word, punctuation) is a fabricated/meaningless anchor → fail-closed (v) drop.

**Threshold, MEASURED (not typed to pass):** the shortest legitimate anchor in the honest corpus
is **2 tokens / 16 chars** (`"spine completion"`); every real 18-corpus taught-text is
**≥ 4 tokens / 22 chars** (shortest `"literally a abc setup."`). So a 2-token floor sits AT the
honest-corpus minimum — it accepts every legitimate anchor and rejects single chars, single
words, and punctuation.

**Anchorless-legitimacy question (ruled — routing, not gate-weakening):** MEASURED — **no honest
condition is anchorless** (every honest cert entry carries its taught condition's `object` text
as its anchor), so the strict `all` gate forces nothing. Per the ruling, a genuinely-legitimate
anchorless condition would be carried through the **§0 disposition lane**, never through a gate
taught to accept a missing anchor (that would re-open the hole). The gate stays strict.

**No regression:** all prior BLOCKs (`{}`, non-dict, missing-key, null-value; F-1 retype /
INVALIDATE-leaning / ENABLE_ENTRY-leaning; bypass removal) stay closed; the honest-good real
certificate still PASSes for the right reason (every anchor present AND ≥ 2 tokens). **Blast
radius (R-261 mint):** corpus re-run unchanged — 18/18 BLOCK, 0 pass Leg A(ii), 183 ii-fail rows
(corpus specs carry no certificate; this change touches only certificate validation, no
`approximation` accounting), 0 verdict flips, no published number moved. Revival probes:
`test_f2_a2_any_not_all_and_anchor_specificity_block`,
`test_f2_a2_honest_certificate_anchors_clear_the_specificity_floor`. Does NOT self-certify — the
same grader re-attacks after.

---

## AMENDMENT A3 — the drop-audit was never a bijection (structural; defeats canonical m2)

The fourth re-attack found that A1/A2 hardened anchor *validity* but never touched anchor
*correspondence*. `_check_no_certificate_drops` built `spec_texts` as a **single flattened pool**
across every taught condition's object+evidence and asked only `any(anchor token-matches
somewhere)` — "does this anchor appear SOMEWHERE," never "does it correspond to ITS condition."
No distinctness / cardinality / bijection. So m2 (silently-dropped taught condition) — the class
this audit exists to catch — was defeatable:

- **Laundered drop (m2 defeated, verified):** drop `WAIT_SESSION:am#1` from the compiled spec
  and refill its certificate slot with a DUPLICATE of the kept condition's anchor
  (`"wait for the london killzone session"`) → PASS. The dropped safety-relevant condition is
  laundered behind another condition's valid anchor.
- **No cardinality (verified):** a certificate claiming 6 conditions, all one anchor, against a
  3-condition spec → PASS.

**Fix — a 1:1 RECONCILIATION (maximum bipartite matching), not a threshold tweak.** Each
certificate entry must claim a DISTINCT taught condition; per-condition texts replace the
flattened pool; `_max_bipartite_matching` (Kuhn) computes the matching. BLOCK when: cardinality
`|cert| != |taught|`; any certificate entry unmatched (duplicated/laundered anchor); any taught
condition unmatched (the silent drop — now un-launderable). **Ambiguous-anchor choice (STATED):**
an anchor that token-matches several conditions keeps edges to all; the matching resolves it and
it is only fatal when it breaks the 1:1 — a shared quote grounding two DISTINCT present
conditions, each claimed once, is legitimate. **MEASURED:** the honest corpus has **zero**
cross-condition phrasing overlap, so the strict bijection forces nothing (a legitimate
anchorless/shared case would route through the §0 disposition lane, never a gate weakening).

**No regression:** all prior BLOCKs (F-1; every F-2 shape — `{}`, non-dict, null-value,
missing-key, any→all, junk/short anchor; bypass removal) stay closed; m2 placeholder still
convicts and the honest-good real certificate still PASSes for the right reason (a genuine 1:1
ledger, one distinct anchor per taught condition). **Blast radius (R-261 mint):** corpus re-run
unchanged — 18/18 BLOCK, 0 pass Leg A(ii), 183 ii-fail rows (corpus specs carry no certificate;
this change touches only certificate reconciliation, no `approximation` accounting), 0 verdict
flips, no published number moved. Revival probes:
`test_f2_a3_drop_audit_is_a_bijection_launder_and_cardinality_block`,
`test_f2_a3_honest_certificate_reconciles_1to1`. Does NOT self-certify — the same grader
re-attacks after.
