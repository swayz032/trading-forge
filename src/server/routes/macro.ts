/**
 * Macro Routes — FRED/BLS/EIA macro data overlay + regime classification.
 *
 * GET   /api/macro/current            — Current macro regime (latest snapshot + classification)
 * GET   /api/macro/history            — Historical snapshots (with pagination ?limit=&offset=)
 * POST  /api/macro/sync               — Trigger manual data sync from FRED/BLS/EIA
 * GET   /api/macro/calendar           — Upcoming FOMC/CPI/NFP events
 * GET   /api/macro/strategy-fit/:id   — Strategy performance across macro regimes (stub)
 */

import { Router } from "express";
import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { z } from "zod";
import { db } from "../db/index.js";
import { macroSnapshots } from "../db/schema.js";
import { desc, eq, sql } from "drizzle-orm";
import { logger } from "../index.js";

export const macroRoutes = Router();

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../..");

// ─── Python subprocess helper ──────────────────────────────────

function runPython(module: string, configJson: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-c", `
import json, sys
sys.path.insert(0, '.')
config = json.loads('''${configJson.replace(/'/g, "\\'")}''')
${module}
`];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "macro-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse macro output: ${stdout}`));
        }
      } else {
        reject(new Error(`Macro engine failed (exit ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => reject(err));
  });
}

// ─── GET /api/macro/current ────────────────────────────────────
// Returns the latest macro snapshot + regime classification
macroRoutes.get("/current", async (_req, res) => {
  try {
    const [latest] = await db
      .select()
      .from(macroSnapshots)
      .orderBy(desc(macroSnapshots.snapshotDate))
      .limit(1);

    if (!latest) {
      res.json({
        message: "No macro snapshots available. Run POST /api/macro/sync first.",
        regime: "TRANSITION",
        confidence: 0,
        snapshot: null,
      });
      return;
    }

    res.json({
      regime: latest.macroRegime || "TRANSITION",
      confidence: Number(latest.regimeConfidence) || 0,
      snapshot_date: latest.snapshotDate,
      data: {
        fed_funds_rate: latest.fedFundsRate ? Number(latest.fedFundsRate) : null,
        treasury_10y: latest.treasury10y ? Number(latest.treasury10y) : null,
        treasury_2y: latest.treasury2y ? Number(latest.treasury2y) : null,
        treasury_3m: latest.treasury3m ? Number(latest.treasury3m) : null,
        vix: latest.vix ? Number(latest.vix) : null,
        yield_spread_10y2y: latest.yieldSpread10y2y ? Number(latest.yieldSpread10y2y) : null,
        unemployment: latest.unemployment ? Number(latest.unemployment) : null,
        cpi_yoy: latest.cpiYoy ? Number(latest.cpiYoy) : null,
        pce_yoy: latest.pceYoy ? Number(latest.pceYoy) : null,
        wti_crude: latest.wtiCrude ? Number(latest.wtiCrude) : null,
        natural_gas: latest.naturalGas ? Number(latest.naturalGas) : null,
      },
      raw_data: latest.rawData,
      created_at: latest.createdAt,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch current macro regime");
    res.status(500).json({ error: "Failed to fetch current macro regime", details: String(err) });
  }
});

// ─── GET /api/macro/history ────────────────────────────────────
// Historical macro snapshots with pagination
macroRoutes.get("/history", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 500);
  const offset = Number(req.query.offset) || 0;

  try {
    const rows = await db
      .select()
      .from(macroSnapshots)
      .orderBy(desc(macroSnapshots.snapshotDate))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(macroSnapshots);

    res.json({
      data: rows.map((r) => ({
        id: r.id,
        snapshot_date: r.snapshotDate,
        regime: r.macroRegime,
        confidence: r.regimeConfidence ? Number(r.regimeConfidence) : null,
        vix: r.vix ? Number(r.vix) : null,
        fed_funds_rate: r.fedFundsRate ? Number(r.fedFundsRate) : null,
        treasury_10y: r.treasury10y ? Number(r.treasury10y) : null,
        yield_spread_10y2y: r.yieldSpread10y2y ? Number(r.yieldSpread10y2y) : null,
        unemployment: r.unemployment ? Number(r.unemployment) : null,
        cpi_yoy: r.cpiYoy ? Number(r.cpiYoy) : null,
        wti_crude: r.wtiCrude ? Number(r.wtiCrude) : null,
      })),
      pagination: {
        limit,
        offset,
        total: Number(countResult?.count ?? 0),
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch macro history");
    res.status(500).json({ error: "Failed to fetch macro history", details: String(err) });
  }
});

// ─── POST /api/macro/sync ──────────────────────────────────────
// Trigger manual data sync from FRED/BLS/EIA
macroRoutes.post("/sync", async (_req, res) => {
  try {
    // Run Python sync script
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, ["-c", `
import json, sys, os
sys.path.insert(0, '.')

results = {"status": "partial", "sources": {}}

# FRED
try:
    from src.data.macro.fred_client import get_latest_values
    fred_data = get_latest_values()
    results["sources"]["fred"] = {"status": "ok", "series_count": len([v for v in fred_data.values() if v is not None])}
    results["fred_data"] = fred_data
except Exception as e:
    results["sources"]["fred"] = {"status": "error", "error": str(e)}
    results["fred_data"] = {}

# Classify regime
try:
    from src.data.macro.macro_tagger import classify_macro_regime
    snapshot = results.get("fred_data", {})
    regime = classify_macro_regime(snapshot)
    results["regime"] = regime
except Exception as e:
    results["regime"] = {"regime": "TRANSITION", "confidence": 0, "error": str(e)}

results["status"] = "ok"
print(json.dumps(results))
`], {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "macro-sync" }, data.toString().trim());
    });

    proc.on("close", async (code) => {
      if (code !== 0) {
        res.status(500).json({
          error: "Macro sync failed",
          details: stderr,
        });
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        const fredData = result.fred_data || {};
        const regime = result.regime || {};

        // Store snapshot in DB
        await db.insert(macroSnapshots).values({
          snapshotDate: new Date(),
          fedFundsRate: fredData.fed_funds_rate?.toString() ?? null,
          treasury10y: fredData.treasury_10y?.toString() ?? null,
          treasury2y: fredData.treasury_2y?.toString() ?? null,
          treasury3m: fredData.treasury_3m?.toString() ?? null,
          vix: fredData.vix?.toString() ?? null,
          yieldSpread10y2y: fredData.yield_spread_10y2y?.toString() ?? null,
          unemployment: fredData.unemployment?.toString() ?? null,
          cpiYoy: fredData.cpi_yoy?.toString() ?? null,
          pceYoy: fredData.pce_yoy?.toString() ?? null,
          wtiCrude: fredData.wti_crude?.toString() ?? null,
          naturalGas: fredData.natural_gas?.toString() ?? null,
          macroRegime: regime.regime || "TRANSITION",
          regimeConfidence: regime.confidence?.toString() ?? "0",
          rawData: result,
        });

        res.json({
          status: "ok",
          regime: regime.regime || "TRANSITION",
          confidence: regime.confidence || 0,
          sources: result.sources || {},
          snapshot_date: new Date().toISOString(),
        });
      } catch (parseErr) {
        logger.error({ parseErr, stdout }, "Failed to parse/store macro sync result");
        res.status(500).json({ error: "Failed to store sync result", details: String(parseErr) });
      }
    });

    proc.on("error", (err) => {
      res.status(500).json({ error: "Failed to start Python process", details: String(err) });
    });
  } catch (err) {
    logger.error({ err }, "Macro sync failed");
    res.status(500).json({ error: "Macro sync failed", details: String(err) });
  }
});

// ─── GET /api/macro/calendar ───────────────────────────────────
// Upcoming FOMC/CPI/NFP/PPI events
macroRoutes.get("/calendar", async (req, res) => {
  const daysAhead = Math.min(Number(req.query.days_ahead) || 30, 365);

  try {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, ["-c", `
import json, sys
sys.path.insert(0, '.')
from src.data.macro.event_calendar import get_upcoming_events, event_proximity
from datetime import date

events = get_upcoming_events(days_ahead=${daysAhead})
proximity = event_proximity()

print(json.dumps({
    "events": events,
    "proximity": proximity,
    "today": date.today().isoformat(),
}))
`], {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          res.json(JSON.parse(stdout.trim()));
        } catch {
          res.status(500).json({ error: "Failed to parse calendar output", details: stdout });
        }
      } else {
        res.status(500).json({ error: "Calendar fetch failed", details: stderr });
      }
    });

    proc.on("error", (err) => {
      res.status(500).json({ error: "Failed to start Python", details: String(err) });
    });
  } catch (err) {
    logger.error({ err }, "Calendar fetch failed");
    res.status(500).json({ error: "Calendar fetch failed", details: String(err) });
  }
});

// ─── GET /api/macro/strategy-fit/:id ───────────────────────────
// Strategy performance across macro regimes (future use, stub)
macroRoutes.get("/strategy-fit/:id", async (req, res) => {
  const { id } = req.params;

  res.json({
    strategy_id: id,
    message: "Strategy-fit analysis coming soon. Will show performance breakdown by macro regime.",
    regimes: [
      "RISK_ON", "RISK_OFF", "TIGHTENING", "EASING",
      "STAGFLATION", "GOLDILOCKS", "TRANSITION",
    ],
    hint: "Run backtests across multiple macro regimes to populate this endpoint.",
  });
});
