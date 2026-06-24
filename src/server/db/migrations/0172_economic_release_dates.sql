-- Migration 0172 — economic_release_dates: authoritative macro release calendar (2026-06-22)
--
-- ROOT-CAUSE FIX: the Tier-1 news blackout dates were HARDCODED static lists, and several
-- (notably FOMC) were PROJECTED by shifting the prior year's calendar forward — i.e. WRONG.
-- Verified: code FOMC 2026 had May 6 / Nov 4 / Dec 16 vs the Fed's published Apr 29 / Oct 28
-- / Dec 9. We have authoritative APIs (FRED_API_KEY, BLS_API_KEY, EIA_API_KEY) the whole time.
--
-- This table is populated by economic-calendar-sync-service.ts from AUTHORITATIVE sources:
--   • FRED /fred/release/dates — NFP (release_id 50), CPI (10), PPI (46), GDP (53). Future
--     scheduled dates as BLS/BEA publish them (mirrored by FRED).
--   • Federal Reserve published FOMC calendar (stable, 2yr ahead) — FOMC + FOMC_MINUTES.
--   • EIA crude oil inventory schedule (Wed 10:30 ET, holiday-shifted) for MCL/CL.
-- Cron-refreshed (monthly + boot). The blackout consumers read from here; the hardcoded
-- lists remain only as a fail-safe fallback when this table is empty/stale.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + unique(event_type, release_date) for upsert.

CREATE TABLE IF NOT EXISTS economic_release_dates (
    id              BIGSERIAL PRIMARY KEY,
    event_type      TEXT NOT NULL,        -- FOMC | FOMC_MINUTES | NFP | CPI | EIA | PPI | GDP
    release_date    DATE NOT NULL,        -- ET calendar date of the release
    time_et         TEXT NOT NULL,        -- "HH:MM" ET (e.g. 08:30, 14:00, 10:30)
    source          TEXT NOT NULL,        -- fred | fed | eia | eia_generated | fallback
    affects_products TEXT,                -- optional CSV scope hint (e.g. "MCL,CL"); null = per news-policy default
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_economic_release_dates_type_date
    ON economic_release_dates (event_type, release_date);

CREATE INDEX IF NOT EXISTS idx_economic_release_dates_date
    ON economic_release_dates (release_date);
