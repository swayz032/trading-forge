import "dotenv/config";
import express from "express";
import pino from "pino";
import { authMiddleware } from "./middleware/auth.js";
import { strategyRoutes } from "./routes/strategies.js";
import { journalRoutes } from "./routes/journal.js";
import { riskRoutes } from "./routes/risk.js";

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

app.listen(port, () => {
  logger.info(`Trading Forge running on http://localhost:${port}`);
});
