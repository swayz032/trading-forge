# Ratify packet — R-054 compliance-refresh audit (governing values pinned by R-056/R-057/R-059)

Autonomous under independent grade (doer≠grader). Pre-live, no live capital
moving. Instrument-touching (`firm_config.py` + `firm-config.ts` feed sizing/
payout math) → packet + independent grade. Epoch-safe: this worktree's edits do
NOT move the battery's `wt-dod-404a3396` engine HEAD; tier-b ghosts don't gate on
payout/DD extraction.

## 0. Governing sources (ruling-pinned) — primary source WINS over aggregators

**R-058.2 method: files lead, web confirms.** Read in-repo rules docs FIRST
(`docs/prop-firm-rules-2026-topstep.md`, `docs/institutional-evidence/prop-firm-scaling-2026.md`,
`risk-kill-switch-sizing-2026.md`, the R-054 research evidence), THEN verify
currency against Topstep's live pages.

**R-056/R-057 GOVERNING VALUES (operator live-page screenshot 2026-07-19 — supersedes
the R-054 order-text aggregator "$2K/$3K cut", which applies only to No-Activation-Fee
variants and is reconciled product-by-product, NOT used for the operator plan):**
- Combine monthly: **$85 / $129 / $199** ($50K / $100K / $150K) — was $95/$149/$229.
- Post-Combine payout election, TWO options:
  - **Standard:** ≥5 winning days ≥$150; maintain balance between payouts; caps **$4,000 / $6,000 / $10,000**.
  - **Consistency:** ≥3 trading days (≥1 trade/day); best day ≤40% of total; caps **$6,000 / $8,000 / $12,000** (higher caps + faster clock).
- **R-059 scaling doctrine (canonical):** account SIZE is locked to the passed
  Combine forever. Within-account scaling = the micro contract pyramid (base
  9/9/18, +3 per proven-trades tier, ceiling 50 micros). Cross-account = HORIZONTAL
  (additional funded accounts, ~5/trader, copy-scaled). **Any `SCALING_PLANS`-style
  size-upgrade ladder is FICTION → removed/corrected; sweep every consumer.**

## 1. What & why now

R-054 order 1 (HIGH): Topstep shipped ~8 rule changes that may postdate our frozen
docs (last reviewed 2026-06-22). R-055/056/057/058/059 refined the audit. The
independent research (evidence file, product-by-product corroboration table) plus
the operator's governing screenshot establish the diffs.

## 2. Blast radius

- `docs/prop-firm-rules-2026-topstep.md` (SOURCE OF TRUTH; parsed by
  `scripts/verify-2026-rules-compliance.mjs` = `check:2026-compliance`).
- `src/engine/firm_config.py` (Py instrument) + `src/shared/firm-config.ts` (TS,
  cross-lang parity) — both must match the doc's Canonical Values.
- `src/engine/firm_rules_version.py` — the drift hash MC asserts; bumps with the change.
- `SCALING_PLANS` — verified **unconsumed** in `src/engine/*.py` (only its own def +
  a `.pyc`); R-059 class sweep still required across TS/dashboards/projections/survival.
- No frozen cert / live default invalidated. The 77 stay SEALED. In-flight battery untouched.

## 3. The exact change, scope-locked

IN scope:
1. **Payout caps → the two-option election model.** Replace the current
   `TOPSTEP_XFA_PAYOUT_CAPS` (standard base $2K/dll $4K, consistency base $3K/dll $6K)
   with the governing live-page values: **Standard $4K/$6K/$10K, Consistency
   $6K/$8K/$12K** by account size. Reconcile the DLL-doubling field against the
   live election mechanic (see #5). Record No-Activation-Fee variant caps
   ($2K/$3K) separately, labeled by product.
2. **Combine monthly pricing → $85/$129/$199** (doc + config; was $49 — stale).
3. **SCALING_PLANS fiction (R-059):** remove the size-upgrade tiers; replace with
   the real model documented (size locked; within-account micro pyramid
   9/9/18→+3/tier→50 ceiling; horizontal ~5 accounts). **Class sweep:** grep every
   consumer (Py/TS/dashboards/projections/survival) and re-verify against the real
   model — a consumer of fiction produces fiction.
4. **LFA 20%/80% reserve system (ADD; effective 2026-02-10; Live-Funded stage):**
   fresh LFA starts 20% tradeable / 80% reserve, 4×25% unlocks gated on
   net-profit-since-last-unlock ($3,000/unlock on the $50K tier). This reshapes
   DRAWDOWN_ROOM sizing for the live stage — document mechanics; wire the sizing
   note (pre-live, no live default changed).
5. **DLL-toggle mechanic (MANDATORY CAPTURE, R-055.0/R-057.2):** from Topstep's own
   help/product pages (after the in-repo docs), document the add-a-Daily-Loss-Limit
   setting + its payout-terms linkage (part of / prerequisite to / separate from the
   Consistency election). Verify our internal DLL ladder (reduce@60% / halt@67% /
   force-close@95% of firm DLL) lives strictly INSIDE Topstep's terms. If absent
   from primary sources, report explicitly with pages checked.
6. **Min-Payout-Balance second payout condition (Dec 30 2025; ADD to doc/config).**
7. **firm_rules_version bump** (rides the correction).
8. **Relocate** the research evidence mis-written to the doubled path
   `…/trading-forge/trading-forge/docs/institutional-evidence/…` into the canonical
   `docs/institutional-evidence/` (append a dated section, never overwrite).
9. `check:2026-compliance` GREEN after.

OUT of scope / STAGED (explicitly NOT now):
- **Commission $1.22 vs $1.24 RT:** single-source only (two-path INSUFFICIENT) →
  DO NOT change; record as a watch-item pending a second primary source.
- **Consistency-tracker retune 50%→40% (~38% margin) + DILUTE-DON'T-TAPER
  (R-057.3/R-058.1):** STAGED for the Phase-3.5 CONSISTENCY election, superseded
  AT ELECTION TIME, not before. The old "standard lane, gate OPT-IN OFF" note is
  NOT touched now. Record the staged consequence only.
- Reader-succession doc (R-054.3), scout/forensics decay-weighting (R-054.4),
  phase-gate lines (R-055.5) — separate packets, their own triggers.

## 4. Verification plan

- `npm run check:2026-compliance` GREEN (doc↔Py↔TS parity) — the empirical gate.
- `firm_rules_version` changes (drift detected + versioned).
- SCALING_PLANS class-sweep receipt: the grep list of consumers + each re-verified
  or confirmed-absent.
- DLL-toggle capture: the primary-source page URLs + the linkage finding (or an
  explicit "absent from primary sources, pages checked: …").
- No change to any tier-b battery number (compliance code isn't on the WF class path).

## 5. Rollback

All additive/corrective in doc + config; revert the files to restore prior state.
No live default altered (pre-live). The version bump is a hash recompute — reverting
the rules reverts the hash. Evidence relocation is a file move (git-tracked).
