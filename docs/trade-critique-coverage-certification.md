# Trade-Critique Coverage — Structural Certification

**Question (charter Tier-3 item 11):** does every closed position actually receive its
plain-English critique block?

**This page certifies the STRUCTURAL half from code.** The empirical half — *how many closed
positions currently lack a critique* — needs a read-only query against the production database and
is **RESERVED, owner: operator**. See §5.

---

## 1. Verdict

**Coverage is best-effort, not guaranteed.** One dispatch site, fire-and-forget, **no retry, no
sweep, no reconciler.** A position that misses its critique is never revisited.

This is a *structural* statement about the mechanism, not a claim that any position is currently
uncovered. Those are different questions and only the first is answered here.

## 2. How coverage actually works

**One production dispatch**, at position close — `src/server/services/paper-execution-service.ts:3227`:

```ts
void import("./trade-critique-service.js").then(({ runTradeCritique }) => {
  void runTradeCritique(pos.id, correlationId).catch((err) => …)
```

So a position gets no critique if the call throws, the model call fails, or the process dies
mid-flight. The `.catch` logs, so it is **not silent server-side** — but nothing reconciles
afterwards. The service documents this itself (`trade-critique-service.ts:123`: *"dispatches
runTradeCritique() fire-and-forget per closed position"*).

## 3. What does NOT guarantee coverage — checked, so nobody re-checks

Each of these looks like it might be the guarantor. None is:

| candidate | why it is not the reconciler |
|---|---|
| **no CI gate / checker script** | `critique` appears **0×** in `package.json` scripts and **0×** in CI workflows. (Control: 84 other scripts are present, so the file is being read.) Unlike the family-grade postscript, which *does* have a blocking AST gate, this has none. |
| **`nightly-critique-service.ts`** | **Name-trap.** It reads `systemJournal`, groups by tier and stores *generation-side* lessons. It never touches `paperPositions` or `tradeCritique`. |
| **`scripts/replay-grade-critique.ts`** | Research, not reconciliation: it replays closed positions with **`dryRun=true` mandated** ("never pollutes prod tables") to test whether critique grade predicts Sharpe decay. It writes nothing. |
| **`trade-journal.ts:146`** | Already left-joins `tradeCritique` on `paperPositions.id` filtering `isNull(tradeCritique.grade)` — but it is wired as a **journal view, not a coverage check**. **The measurement exists; the certification did not.** |

## 4. Fix-shape — RESERVED, deliberately NOT built

If the operator wants guaranteed coverage, the pieces already exist and only need wiring:

- **The query** is already written — `trade-journal.ts`'s `isNull(tradeCritique.grade)` left-join
  is exactly "closed positions with no critique."
- **The iteration template** is `scripts/replay-grade-critique.ts` — it already walks closed
  positions invoking `runTradeCritique`. A backfill is that loop with `dryRun` off and the
  `isNull(grade)` filter applied.

**Not built, on purpose.** It is machinery ahead of a verified need, gated behind two operator
inputs that do not exist yet: *is automatic backfill wanted at all*, and *what is the current gap*.
Building it now would repeat the pattern this campaign has hit twice — a mechanism justified by an
unmeasured hole.

## 5. RESERVED — the empirical half, owner: operator

**Unblock is one line:** a read-only `SELECT` counting closed positions vs those with a critique row.

It is held rather than run because **production-database access is a live-system key, and the
operator holds the keys.** "It is only a `SELECT`" is the incremental reasoning that widens a
boundary one step at a time; what is protected is the boundary, not this query's blast radius.

Cost of holding is ~zero: pre-live and paper-only, the count gates nothing. If the count comes back
zero, the fire-and-forget risk is theoretical; if non-zero, the number is the finding.

---

**Scope of this certification:** structural only, derived from source at the branch tip. It does not
claim any position is currently uncovered, and it does not claim the gap is zero — **it claims the
mechanism cannot guarantee either way**, which is the honest thing a code reading can establish.
