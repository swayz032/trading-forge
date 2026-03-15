import "dotenv/config";
import express from "express";
import pino from "pino";
import { authMiddleware } from "./middleware/auth.js";
import { strategyRoutes } from "./routes/strategies.js";
import { journalRoutes } from "./routes/journal.js";
import { riskRoutes } from "./routes/risk.js";
import { dataRoutes } from "./routes/data.js";
import { indicatorRoutes } from "./routes/indicators.js";
import { backtestRoutes } from "./routes/backtests.js";
import { agentRoutes } from "./routes/agent.js";
import { monteCarloRoutes } from "./routes/monte-carlo.js";
import complianceRoutes from "./routes/compliance.js";
import { compilerRoutes } from "./routes/compiler.js";
import { survivalRoutes } from "./routes/survival.js";
import { skipRoutes } from "./routes/skip.js";
import { macroRoutes } from "./routes/macro.js";
import { graveyardRoutes } from "./routes/graveyard.js";
import { decayRoutes } from "./routes/decay.js";
import { archetypeRoutes } from "./routes/archetypes.js";
import { tournamentRoutes } from "./routes/tournament.js";
import { antiSetupRoutes } from "./routes/anti-setups.js";
import { governorRoutes } from "./routes/governor.js";

const app = express();
const port = Number(process.env.PORT) || 4000;

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty" }
      : undefined,
});

// Middleware
app.use(express.json());

// Health check (no auth)
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "trading-forge", timestamp: new Date().toISOString() });
});

// Auth gate
app.use("/api", authMiddleware);

// Routes
app.use("/api/strategies", strategyRoutes);
app.use("/api/journal", journalRoutes);
app.use("/api/risk", riskRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/indicators", indicatorRoutes);
app.use("/api/backtests", backtestRoutes);
app.use("/api/agent", agentRoutes);
app.use("/api/monte-carlo", monteCarloRoutes);
app.use("/api/compliance", complianceRoutes);
app.use("/api/compiler", compilerRoutes);
app.use("/api/survival", survivalRoutes);
app.use("/api/skip", skipRoutes);
app.use("/api/macro", macroRoutes);
app.use("/api/graveyard", graveyardRoutes);
app.use("/api/decay", decayRoutes);
app.use("/api/archetypes", archetypeRoutes);
app.use("/api/tournament", tournamentRoutes);
app.use("/api/anti-setups", antiSetupRoutes);
app.use("/api/governor", governorRoutes);

app.listen(port, () => {
  logger.info(`Trading Forge running on http://localhost:${port}`);
});
