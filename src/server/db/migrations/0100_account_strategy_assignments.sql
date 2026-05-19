-- Migration 0100: Account Strategy Assignments
-- Track 5 (Pass 2): Strategy Selection UI + Publish-to-Family Gate
--
-- Assigns strategies (by account_id FK → broker_accounts) to specific accounts.
-- UNIQUE (account_id, strategy_id) — one active assignment record per pair.
-- released_to_family enables the per-recipient Pine export downstream (Track 6).
-- MFFU collaborative-trading detection: service layer warns when 2+ family members
-- run the same strategy on the same firm. This table provides the FK anchor.
--
-- Depends on: migration 0098 (broker_accounts), migration 0099 (instance_config),
--             strategies table (pre-existing).

-- UP ─────────────────────────────────────────────────────────────────────────

CREATE TABLE account_strategy_assignments (
    id                 BIGSERIAL PRIMARY KEY,
    account_id         UUID NOT NULL REFERENCES broker_accounts(account_id) ON DELETE CASCADE,
    strategy_id        UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    status             TEXT NOT NULL CHECK (status IN ('active', 'paused', 'archived'))
                       DEFAULT 'active',
    released_to_family BOOLEAN NOT NULL DEFAULT false,
    family_member_label TEXT,            -- e.g. "Alice", "Bob" — operator-assigned label for family member
    assigned_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by        TEXT NOT NULL,    -- 'operator' | 'system' | email/label
    UNIQUE (account_id, strategy_id)
);

-- Index for family-published strategy queries (Track 6 Pine export)
CREATE INDEX idx_asa_account_id ON account_strategy_assignments (account_id);
CREATE INDEX idx_asa_strategy_id ON account_strategy_assignments (strategy_id);
CREATE INDEX idx_asa_released_family ON account_strategy_assignments (released_to_family)
    WHERE released_to_family = true;
CREATE INDEX idx_asa_status ON account_strategy_assignments (status);

-- DOWN ───────────────────────────────────────────────────────────────────────

-- DROP TABLE account_strategy_assignments;
