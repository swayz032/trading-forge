-- W19 Schema 3: Opening Auction Imbalance from Databento Imbalance schema
-- CME publishes opening auction imbalance ~1 second before 8:30 AM ET open.
-- Documented predictive edge on opening direction; enhances ORB archetype.
-- Cost: ~$5/month at Databento per-message pricing (2 symbols x 250 days x 1 msg).
--
-- Apply via direct SQL on Railway (drizzle-kit broken for this repo):
--   psql $DATABASE_URL -c "$(cat 0087_opening_auction_imbalance.sql)"

CREATE TABLE IF NOT EXISTS opening_auction_imbalance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,                   -- 'ES' or 'NQ' (large contracts; imbalance most meaningful)
  auction_date date NOT NULL,             -- the trading day of the auction
  imbalance_quantity bigint NOT NULL,     -- net imbalance size in contracts
  imbalance_side text NOT NULL,           -- 'buy' | 'sell' | 'none' (balanced)
  paired_quantity bigint,                 -- contracts already matched at indicative price
  indicative_price numeric,              -- CME indicative opening price at imbalance time
  auction_time timestamp NOT NULL,        -- exact timestamp of the imbalance message (~8:29:59 ET)
  pulled_at timestamp DEFAULT now() NOT NULL,
  UNIQUE(symbol, auction_date)            -- one row per symbol per trading day
);

-- Fast date-range lookup for backtesting and pre-market read
CREATE INDEX IF NOT EXISTS idx_auction_imbalance_symbol_date
  ON opening_auction_imbalance(symbol, auction_date DESC);

COMMENT ON TABLE opening_auction_imbalance IS
  'W19 Schema 3: CME opening auction imbalance from Databento Imbalance schema. '
  'Pulled at 8:25 AM ET daily for ES and NQ. Surfaces openingAuctionBias to '
  'opening_range_breakout strategies via regime-state-service. '
  'Cost: ~$5/month at Databento per-message pricing.';
