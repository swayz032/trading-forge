/**
 * Wave 13 Track A — Restore real strategy semantics (A.3 / CF-2 / CF-4)
 *
 * Updates both stuck strategies with correct engine-parseable DSL:
 *   1. ema_9_21_pullback_mes_5m — EMA 9/21 pullback (entry already correct, update prose fields)
 *   2. orb_15m_mes — ORB 15m (switch from SMA proxy to real opening_range_breakout indicator)
 *
 * Run: npx tsx scripts/wave13-restore-strategy-semantics.ts
 */

import { db } from "../src/server/db/index.js";
import { strategies, auditLog } from "../src/server/db/schema.js";
import { eq } from "drizzle-orm";

const EMA_ID = "3e6e94d6-4486-4a69-a0c2-b7f8eb8b5431";
const ORB_ID = "dc6df7af-7277-4187-a860-e6ee6f8f12de";

async function restoreEmaSemantics() {
  const [row] = await db.select().from(strategies).where(eq(strategies.id, EMA_ID));
  if (!row) throw new Error(`Strategy ${EMA_ID} not found`);

  const cfg = row.config as Record<string, unknown>;
  const strategy = (cfg.strategy ?? {}) as Record<string, unknown>;

  // EMA entry already correct: "ema_9 crosses_above ema_21"
  // Add/update prose fields and ensure indicator list is correct
  const updatedStrategy = {
    ...strategy,
    entry_long: "ema_9 crosses_above ema_21",
    entry_long_prose:
      "After 9 EMA crosses above 21 EMA and price remains above 21 EMA, enter long on the crossover bar (momentum confirmation).",
    entry_short: "high < low", // long-only strategy; never-true sentinel
    entry_short_prose: "",
    exit: "high < low", // never-true sentinel; Style D exit handled by exit_type=trailing_stop
    exit_prose:
      "Style D: 50% off at +1R, move stop to BE+1tick on TP1, Chandelier(14,2) trail, 15:55 ET hard flatten.",
    indicators: [
      { type: "ema", period: 9 },
      { type: "ema", period: 21 },
      { type: "atr", period: 14 },
    ],
  };

  const updatedConfig = {
    ...cfg,
    strategy: updatedStrategy,
    metadata: {
      ...(cfg.metadata as Record<string, unknown> ?? {}),
      wave13_semantics_restored: true,
      wave13_restored_at: new Date().toISOString(),
    },
  };

  await db.update(strategies)
    .set({ config: updatedConfig, updatedAt: new Date() })
    .where(eq(strategies.id, EMA_ID));

  await db.insert(auditLog).values({
    action: "strategy.wave13_semantics_restored",
    entityType: "strategy",
    entityId: EMA_ID,
    input: { script: "wave13-restore-strategy-semantics.ts" } as Record<string, unknown>,
    result: {
      entry_long: updatedStrategy.entry_long,
      entry_long_prose: updatedStrategy.entry_long_prose,
      exit: updatedStrategy.exit,
      indicators: updatedStrategy.indicators,
      change: "prose fields + indicator list updated; entry_long already correct",
    } as Record<string, unknown>,
    status: "success",
    decisionAuthority: "operator",
    correlationId: null,
  });

  console.log(`[EMA] Updated ${EMA_ID}: entry_long="${updatedStrategy.entry_long}"`);
}

async function restoreOrbSemantics() {
  const [row] = await db.select().from(strategies).where(eq(strategies.id, ORB_ID));
  if (!row) throw new Error(`Strategy ${ORB_ID} not found`);

  const cfg = row.config as Record<string, unknown>;
  const strategy = (cfg.strategy ?? {}) as Record<string, unknown>;

  // ORB: switch from SMA proxy to real opening_range_breakout indicator
  // entry_long: close > orh_15m (breakout above 15-min opening range high)
  // entry_short: empty (long-only)
  // exit: never-true sentinel (Style D handles exits)
  const updatedStrategy = {
    ...strategy,
    entry_long: "close > orh_15m",
    entry_long_prose:
      "After the 9:30 ET 15-min opening range forms and locks, enter long on the first 15-min candle close above the opening range high (breakout confirmation).",
    entry_short: "high < low", // long-only; never-true sentinel
    entry_short_prose: "",
    exit: "high < low", // never-true sentinel; Style D exit handled by exit_type=trailing_stop
    exit_prose:
      "Style D: 50% off at +1R, move stop to BE+1tick on TP1, Chandelier(14,2) trail, 15:55 ET hard flatten. Structural stop at OR-low.",
    indicators: [
      { type: "opening_range_breakout", period: 15, range_minutes: 15, session_start_et: "09:30" },
      { type: "atr", period: 14 },
    ],
    // update stop to reflect structural stop at OR-low (engine reads exit_params.stop_ref)
    stop_loss: { type: "atr", multiplier: 1.5 }, // floor; actual stop at OR-low if tighter
  };

  const updatedConfig = {
    ...cfg,
    strategy: updatedStrategy,
    entry_indicator: "session_open_breakout",
    entry_params: { range_minutes: 15, session_start_et: "09:30" },
    metadata: {
      ...(cfg.metadata as Record<string, unknown> ?? {}),
      routing_mode: "parametric_indicator",
      compile_notes: [
        "session_open_breakout{range_minutes=15} → opening_range_breakout indicator → close > orh_15m",
        "ORB indicator landed Wave 13 A.2 — no-lookahead, ET-aware, resets daily",
      ],
      wave13_semantics_restored: true,
      wave13_restored_at: new Date().toISOString(),
    },
  };

  await db.update(strategies)
    .set({ config: updatedConfig, updatedAt: new Date() })
    .where(eq(strategies.id, ORB_ID));

  await db.insert(auditLog).values({
    action: "strategy.wave13_semantics_restored",
    entityType: "strategy",
    entityId: ORB_ID,
    input: { script: "wave13-restore-strategy-semantics.ts" } as Record<string, unknown>,
    result: {
      entry_long: updatedStrategy.entry_long,
      entry_long_prose: updatedStrategy.entry_long_prose,
      exit: updatedStrategy.exit,
      indicators: updatedStrategy.indicators,
      change: "switched from SMA proxy to opening_range_breakout indicator; entry_long=close>orh_15m",
    } as Record<string, unknown>,
    status: "success",
    decisionAuthority: "operator",
    correlationId: null,
  });

  console.log(`[ORB] Updated ${ORB_ID}: entry_long="${updatedStrategy.entry_long}"`);
}

async function main() {
  console.log("Wave 13 Track A — Restoring strategy semantics...");
  await restoreEmaSemantics();
  await restoreOrbSemantics();
  console.log("Done. Both strategies updated with real semantics.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
