import { Router } from "express";
import { z } from "zod";
import { runQuantumMC, runHybridCompare, getQuantumRun, getBenchmark } from "../services/quantum-mc-service.js";
import { quantumRunRequestSchema, hybridCompareRequestSchema } from "../lib/quantum-run-schema.js";
import { logger } from "../index.js";
import { db } from "../db/index.js";
import { rlTrainingRuns } from "../db/schema.js";

export const quantumMcRoutes = Router();

// POST /api/quantum-mc/run — Single quantum challenger job
quantumMcRoutes.post("/run", async (req, res) => {
  const parsed = quantumRunRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runQuantumMC(
      parsed.data.backtestId,
      parsed.data.eventType,
      parsed.data.firmKey,
      {
        threshold: parsed.data.threshold,
        epsilon: parsed.data.epsilon,
        alpha: parsed.data.alpha,
        backend: parsed.data.backend,
      },
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Quantum MC run failed");
    res.status(500).json({ error: "Quantum MC run failed" });
  }
});

// POST /api/quantum-mc/hybrid-compare — Classical + quantum side-by-side
quantumMcRoutes.post("/hybrid-compare", async (req, res) => {
  const parsed = hybridCompareRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runHybridCompare(
      parsed.data.backtestId,
      parsed.data.eventType,
      parsed.data.firmKey,
      parsed.data.threshold,
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Hybrid compare failed");
    res.status(500).json({ error: "Hybrid compare failed" });
  }
});

// GET /api/quantum-mc/benchmarks/:id — Fetch comparison details
quantumMcRoutes.get("/benchmarks/:id", async (req, res) => {
  const bench = await getBenchmark(req.params.id);
  if (!bench) {
    res.status(404).json({ error: "Benchmark not found" });
    return;
  }
  res.json(bench);
});

// POST /api/quantum-mc/tensor-train — Train MPS model
quantumMcRoutes.post("/tensor-train", async (req, res) => {
  const schema = z.object({
    features: z.array(z.array(z.number())),
    labels: z.array(z.number()),
    bondDim: z.number().int().min(2).max(16).default(4),
    epochs: z.number().int().min(1).max(500).default(50),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const { spawn } = await import("child_process");
    const { resolve: pathResolve } = await import("path");
    const { writeFileSync, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { randomUUID } = await import("crypto");

    const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");
    const config = {
      features: parsed.data.features,
      labels: parsed.data.labels,
      bond_dim: parsed.data.bondDim,
      epochs: parsed.data.epochs,
    };

    const tmpPath = pathResolve(tmpdir(), `tensor-train-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, ["-m", "src.engine.tensor_signal_model", "--mode", "train", "--input-json", tmpPath], {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      try { unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
      if (code === 0) {
        try { res.json(JSON.parse(stdout.trim())); }
        catch { res.status(500).json({ error: "Failed to parse output" }); }
      } else {
        res.status(500).json({ error: `Training failed (exit ${code})`, details: stderr.slice(0, 500) });
      }
    });
  } catch (err) {
    logger.error({ err }, "Tensor train failed");
    res.status(500).json({ error: "Tensor train failed" });
  }
});

// POST /api/quantum-mc/tensor-predict — MPS prediction
quantumMcRoutes.post("/tensor-predict", async (req, res) => {
  const schema = z.object({
    modelPath: z.string(),
    features: z.array(z.array(z.number())),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const { spawn } = await import("child_process");
    const { resolve: pathResolve } = await import("path");
    const { writeFileSync, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { randomUUID } = await import("crypto");

    const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");
    const config = { features: parsed.data.features };
    const tmpPath = pathResolve(tmpdir(), `tensor-predict-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, [
      "-m", "src.engine.tensor_signal_model", "--mode", "predict",
      "--input-json", tmpPath, "--model-path", parsed.data.modelPath,
    ], { env: { ...process.env }, cwd: PROJECT_ROOT });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      try { unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
      if (code === 0) {
        try { res.json(JSON.parse(stdout.trim())); }
        catch { res.status(500).json({ error: "Failed to parse output" }); }
      } else {
        res.status(500).json({ error: `Prediction failed (exit ${code})` });
      }
    });
  } catch (err) {
    logger.error({ err }, "Tensor predict failed");
    res.status(500).json({ error: "Tensor predict failed" });
  }
});

// POST /api/quantum-mc/sqa-optimize — SQA parameter search
quantumMcRoutes.post("/sqa-optimize", async (req, res) => {
  const schema = z.object({
    paramRanges: z.array(z.object({
      name: z.string(),
      min_val: z.number(),
      max_val: z.number(),
      n_bits: z.number().int().min(2).max(8).default(4),
    })),
    numReads: z.number().int().min(10).max(10000).default(100),
    numSweeps: z.number().int().min(100).max(100000).default(1000),
    objective: z.enum(["maximize_sharpe", "minimize_drawdown", "maximize_profit_factor"]).default("maximize_sharpe"),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const { spawn } = await import("child_process");
    const { resolve: pathResolve } = await import("path");
    const { writeFileSync, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { randomUUID } = await import("crypto");

    const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");
    const config = {
      param_ranges: parsed.data.paramRanges,
      num_reads: parsed.data.numReads,
      num_sweeps: parsed.data.numSweeps,
      objective: parsed.data.objective,
    };

    const tmpPath = pathResolve(tmpdir(), `sqa-config-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, ["-m", "src.engine.quantum_annealing_optimizer", "--input-json", tmpPath], {
      env: { ...process.env }, cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      try { unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
      if (code === 0) {
        try { res.json(JSON.parse(stdout.trim())); }
        catch { res.status(500).json({ error: "Failed to parse output" }); }
      } else {
        res.status(500).json({ error: `SQA optimization failed (exit ${code})`, details: stderr.slice(0, 500) });
      }
    });
  } catch (err) {
    logger.error({ err }, "SQA optimize failed");
    res.status(500).json({ error: "SQA optimize failed" });
  }
});

// POST /api/quantum-mc/qubo-timing — QUBO trade timing
quantumMcRoutes.post("/qubo-timing", async (req, res) => {
  const schema = z.object({
    sessionProfile: z.enum(["RTH", "ETH", "FULL"]).default("RTH"),
    historicalReturns: z.array(z.number()).optional(),
    maxActiveBlocks: z.number().int().optional(),
    riskConstraints: z.object({
      max_consecutive_active: z.number().int().default(4),
    }).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const { spawn } = await import("child_process");
    const { resolve: pathResolve } = await import("path");
    const { writeFileSync, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { randomUUID } = await import("crypto");

    const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");
    const config = {
      session_profile: parsed.data.sessionProfile,
      historical_returns: parsed.data.historicalReturns,
      max_active_blocks: parsed.data.maxActiveBlocks,
      risk_constraints: parsed.data.riskConstraints,
    };

    const tmpPath = pathResolve(tmpdir(), `qubo-timing-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, ["-m", "src.engine.qubo_trade_timing", "--input-json", tmpPath], {
      env: { ...process.env }, cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      try { unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
      if (code === 0) {
        try { res.json(JSON.parse(stdout.trim())); }
        catch { res.status(500).json({ error: "Failed to parse output" }); }
      } else {
        res.status(500).json({ error: `QUBO timing failed (exit ${code})`, details: stderr.slice(0, 500) });
      }
    });
  } catch (err) {
    logger.error({ err }, "QUBO timing failed");
    res.status(500).json({ error: "QUBO timing failed" });
  }
});

// POST /api/quantum-mc/rl-train — Train quantum RL agent
quantumMcRoutes.post("/rl-train", async (req, res) => {
  const schema = z.object({
    strategyId: z.string().uuid(),
    prices: z.array(z.number()).optional(),
    features: z.array(z.array(z.number())).optional(),
    nQubits: z.number().int().min(2).max(16).default(8),
    nLayers: z.number().int().min(1).max(10).default(3),
    episodes: z.number().int().min(1).max(1000).default(100),
    nSteps: z.number().int().default(200),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const { spawn } = await import("child_process");
    const { resolve: pathResolve } = await import("path");
    const { writeFileSync, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { randomUUID } = await import("crypto");

    const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");
    const config = {
      prices: parsed.data.prices,
      features: parsed.data.features,
      n_qubits: parsed.data.nQubits,
      n_layers: parsed.data.nLayers,
      episodes: parsed.data.episodes,
      n_steps: parsed.data.nSteps,
    };

    const tmpPath = pathResolve(tmpdir(), `rl-train-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, ["-m", "src.engine.quantum_rl_agent", "--mode", "train", "--input-json", tmpPath], {
      env: { ...process.env }, cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    const TIMEOUT_MS = 300_000;
    const timer = setTimeout(() => { proc.kill("SIGTERM"); }, TIMEOUT_MS);

    proc.on("close", async (code) => {
      clearTimeout(timer);
      try { unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
      if (code === 0) {
        let result: Record<string, unknown>;
        try {
          result = JSON.parse(stdout.trim());
        } catch {
          res.status(500).json({ error: "Failed to parse output" });
          return;
        }

        // Persist to rl_training_runs so the critic can read training evidence.
        // Governance: challenger-only — this insert is evidence persistence, not
        // authority escalation. The critic reads and scores; it does not execute.
        try {
          await db.insert(rlTrainingRuns).values({
            strategyId: parsed.data.strategyId,
            method: "pennylane_vqc",
            nQubits: parsed.data.nQubits,
            nLayers: parsed.data.nLayers,
            episodes: parsed.data.episodes,
            maxSteps: parsed.data.nSteps,
            totalReturn: result.total_return != null ? String(result.total_return) : null,
            sharpeRatio: result.sharpe_ratio != null ? String(result.sharpe_ratio) : null,
            winRate: result.win_rate != null ? String(result.win_rate) : null,
            totalTrades: typeof result.total_trades === "number" ? result.total_trades : null,
            policyWeights: null, // weights not serialized in current agent output
            comparisonResult: null,
            governanceLabels: (result.governance as Record<string, unknown>) ?? {
              experimental: false,
              authoritative: true,
              decision_role: "pre_deploy_autonomous",
            },
            executionTimeMs: typeof result.execution_time_ms === "number" ? result.execution_time_ms : null,
          });
        } catch (dbErr) {
          // Persistence failure must not suppress the training result.
          // Log and surface in response so the caller can observe the gap.
          logger.error({ err: dbErr }, "RL train: failed to persist to rl_training_runs");
          res.json({ ...result, persistence_error: "rl_training_runs insert failed" });
          return;
        }

        res.json(result);
      } else {
        res.status(500).json({ error: `RL training failed (exit ${code})`, details: stderr.slice(0, 500) });
      }
    });
  } catch (err) {
    logger.error({ err }, "RL train failed");
    res.status(500).json({ error: "RL train failed" });
  }
});

// POST /api/quantum-mc/rl-evaluate — Evaluate agent on test data
quantumMcRoutes.post("/rl-evaluate", async (req, res) => {
  const schema = z.object({
    prices: z.array(z.number()).optional(),
    features: z.array(z.array(z.number())).optional(),
    nQubits: z.number().int().default(8),
    nLayers: z.number().int().default(3),
    nSteps: z.number().int().default(200),
    mode: z.enum(["evaluate", "compare"]).default("evaluate"),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const { spawn } = await import("child_process");
    const { resolve: pathResolve } = await import("path");
    const { writeFileSync, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { randomUUID } = await import("crypto");

    const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");
    const config = {
      prices: parsed.data.prices,
      features: parsed.data.features,
      n_qubits: parsed.data.nQubits,
      n_layers: parsed.data.nLayers,
      n_steps: parsed.data.nSteps,
    };

    const tmpPath = pathResolve(tmpdir(), `rl-eval-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, [
      "-m", "src.engine.quantum_rl_agent",
      "--mode", parsed.data.mode,
      "--input-json", tmpPath,
    ], { env: { ...process.env }, cwd: PROJECT_ROOT });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      try { unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
      if (code === 0) {
        try { res.json(JSON.parse(stdout.trim())); }
        catch { res.status(500).json({ error: "Failed to parse output" }); }
      } else {
        res.status(500).json({ error: `RL evaluation failed (exit ${code})`, details: stderr.slice(0, 500) });
      }
    });
  } catch (err) {
    logger.error({ err }, "RL evaluate failed");
    res.status(500).json({ error: "RL evaluate failed" });
  }
});

// GET /api/quantum-mc/:id — Fetch persisted run
quantumMcRoutes.get("/:id", async (req, res) => {
  const run = await getQuantumRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Quantum run not found" });
    return;
  }
  res.json(run);
});
