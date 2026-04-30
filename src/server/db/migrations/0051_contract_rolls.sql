-- Wave D3: contract roll events
-- Logs every flatten/roll action triggered by the roll calendar handler.
-- Includes pre_roll_pnl for analysis of P&L at flatten time.

CREATE TABLE IF NOT EXISTS contract_rolls (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id     uuid        NOT NULL,          -- FK to paper_positions (soft — position may be closed by the time we query)
  session_id      uuid        NOT NULL,
  symbol          text        NOT NULL,
  action          text        NOT NULL,          -- 'flatten' | 'roll' | 'warn'
  roll_date       date        NOT NULL,          -- the CME roll date that triggered this
  flatten_date    date        NOT NULL,          -- the day the action was taken (roll_date - 1 biz day)
  contracts       integer     NOT NULL,
  pre_roll_pnl    numeric,                       -- unrealized P&L at flatten time (from paper_positions)
  active_contract text,                          -- e.g. 'MESH26'
  reason          text        NOT NULL DEFAULT 'contract_rollover',
  created_at      timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contract_rolls_session_idx  ON contract_rolls (session_id);
CREATE INDEX IF NOT EXISTS contract_rolls_symbol_idx   ON contract_rolls (symbol);
CREATE INDEX IF NOT EXISTS contract_rolls_created_idx  ON contract_rolls (created_at);
