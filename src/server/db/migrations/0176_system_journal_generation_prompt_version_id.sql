-- 0176: Stamp generation_prompt_version_id on system_journal rows so the
--        A/B-test comparator can attribute each strategy to the real prompt
--        version that generated it, instead of the coin-flip hashToVariant()
--        fallback that measured random noise.
--
--        Nullable — NULL means the strategy pre-dates the stamp (legacy) and
--        is EXCLUDED from A/B comparisons rather than coin-flipped into a
--        random bucket.  Exclusion is safer than guessing.
--
--        NOT boot-critical: a missing stamp on an entry is handled gracefully
--        by the comparator (filter out rather than crash).
--
--        ADD COLUMN IF NOT EXISTS is idempotent — safe to re-run.

ALTER TABLE system_journal
  ADD COLUMN IF NOT EXISTS generation_prompt_version_id TEXT;
