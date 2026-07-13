# Design-pool 16 STARTED + PAUSED at the cross-run wall — card protected (2026-07-13)

## What happened (the operator's designed rhythm, correctly enforced)
gpt-5.4 whole-job design-pool driver built (`h1-frontier-designpool.ts`), smoke-tested end-to-end on 4cT8WTyxhYY (Phase-A k=5 mode 1 cached + Phase-B extracted: entry_sequence=3, confluences=4, targets=2, stop — real conditions). Launched on all 16 → **correctly PAUSED at the wall on the first call** (resume tomorrow). Vault + cache + ledger all resumable.

## THE CARD-PROTECTION CATCH (load-bearing governor completion)
The in-run token counter RESETS per invocation, so it could NOT enforce the true daily partition across the day's multiple runs (birth + smoke + design-pool). Reconstructed today's real spend from the cache:
- **gpt54 (gpt-5.4): 251,436 tokens today** — OVER the 200K extraction partition AND over the 250K free pool (full-weight count; prefix-cache discount, if it counts against the free allowance, is the still-open day-one unknown — surprises favor the wallet).
- mini (gpt-5.4-mini): 213,199 / 1M — healthy.

**Had the design-pool launched on the in-run counter (starting at 0), it would have spent up to 200K MORE gpt54 today → ~450K → a real card breach.** Fix: PERSISTENT DAILY LEDGER (`extraction-token-governor.ts` readTodaySpend/recordSpend/seedTodaySpend; ledger `frontier-daily-ledger.json`). Every run now starts from the day's true spend and records each call immediately. The wall held: design-pool refused (`251436+5677 > 200000`). Governor trip test still 22/22 after the addition.

## Resume mechanism
The ledger keys by UTC date → resets at UTC midnight → tomorrow the driver reads 0 for gpt54, runs until it hits 200K, pauses, repeats. The result-cache makes each day continue from where it stopped (completed videos free). ~3-4 days for all 16. Re-run: `npx tsx scripts/h1-frontier-designpool.ts` (daily; a cron can automate).

## mini Phase-B tryout (parallel, mini pool has 787K room today)
Runs on the mini's separate pool — no contention with gpt54. Copy the 6 birth videos' conditions using gpt-5.4's CERTIFIED consensus enumerations as scope, judged MECHANICALLY (locator anchor rate + F-2 floor + WEh variant-B present + -igp FVG endpoints) — no raters, qualifier probe only. Building next.
