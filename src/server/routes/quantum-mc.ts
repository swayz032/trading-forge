import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { runQuantumMC, runHybridCompare, getQuantumRun, getBenchmark } from "../services/quantum-mc-service.js";
import { quantumRunRequestSchema, hybridCompareRequestSchema } from "../lib/quantum-run-schema.js";
import { db } from "../db/index.js";
import { rlTrainingRuns } from "../db/schema.js";
import { runPythonModule } from "../lib/python-runner.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";

export const quantumMcRoutes = Router();

/**
 * FIX 5 — pipeline pause gate. Every POST under /api/quantum-mc spawns a
 * Python subprocess and writes a DB row. When the pipeline is PAUSED /
 * VACATION, all of these must short-circuit with 423 (Locked) and a stable
 * { error: "pipeline_paused" } body so n8n + dashboards can distinguish a
 * pause from a real failure.
 *
 * GET routes (read-only) are NOT gated.
 */
async function pipelinePauseGate(_req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await isPipelineActive())) {
    res.status(423).json({ error: "pipeline_paused" });
    return;
  }
  next();
}

// POST /api/quantum-mc/run — Single quantum challenger job
quantumMcRoutes.post("/run", pipelinePauseGate, async (req, res) => {
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
    req.log.error({ err }, "Quantum MC run failed");
    res.status(500).json({ error: "Quantum MC run failed" });
  }
});

// POST /api/quantum-mc/hybrid-compare — Classical + quantum side-by-side
quantumMcRoutes.post("/hybrid-compare", pipelinePauseGate, async (req, res) => {
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
    req.log.error({ err }, "Hybrid compare failed");
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
quantumMcRoutes.post("/tensor-train", pipelinePauseGate, async (req, res) => {
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
    const config = {
      features: parsed.data.features,
      labels: parsed.data.labels,
      bond_dim: parsed.data.bondDim,
      epochs: parsed.data.epochs,
      mode: "train",
    };
    const result = await runPythonModule({
      module: "src.engine.tensor_signal_model",
      config,
      componentName: "tensor-train",
      timeoutMs: 300_000, // 5 min
      correlationId: req.id,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Tensor train failed");
    res.status(500).json({ error: "Tensor train failed" });
  }
});

// POST /api/quantum-mc/tensor-predict — MPS prediction
quantumMcRoutes.post("/tensor-predict", pipelinePauseGate, async (req, res) => {
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
    const config = {
      features: parsed.data.features,
      model_path: parsed.data.modelPath,
      mode: "predict",
    };
    const result = await runPythonModule({
      module: "src.engine.tensor_signal_model",
      config,
      componentName: "tensor-predict",
      timeoutMs: 300_000, // 5 min
      correlationId: req.id,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Tensor predict failed");
    res.status(500).json({ error: "Tensor predict failed" });
  }
});

// POST /api/quantum-mc/sqa-optimize — SQA parameter search
quantumMcRoutes.post("/sqa-optimize", pipelinePauseGate, async (req, res) => {
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
    const config = {
      param_ranges: parsed.data.paramRanges,
      num_reads: parsed.data.numReads,
      num_sweeps: parsed.data.numSweeps,
      objective: parsed.data.objective,
    };
    const result = await runPythonModule({
      module: "src.engine.quantum_annealing_optimizer",
      config,
      componentName: "sqa-optimizer",
      timeoutMs: 300_000, // 5 min
      correlationId: req.id,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "SQA optimize failed");
    res.status(500).json({ error: "SQA optimize failed" });
  }
});

// POST /api/quantum-mc/qubo-timing — QUBO trade timing
quantumMcRoutes.post("/qubo-timing", pipelinePauseGate, async (req, res) => {
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
    const config = {
      session_profile: parsed.data.sessionProfile,
      historical_returns: parsed.data.historicalReturns,
      max_active_blocks: parsed.data.maxActiveBlocks,
      risk_constraints: parsed.data.riskConstraints,
    };
    const result = await runPythonModule({
      module: "src.engine.qubo_trade_timing",
      config,
      componentName: "qubo-timing",
      timeoutMs: 300_000, // 5 min
      correlationId: req.id,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "QUBO timing failed");
    res.status(500).json({ error: "QUBO timing failed" });
  }
});

// POST /api/quantum-mc/rl-train — Train quantum RL agent
quantumMcRoutes.post("/rl-train", pipelinePauseGate, async (req, res) => {
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
    const config = {
      prices: parsed.data.prices,
      features: parsed.data.features,
      n_qubits: parsed.data.nQubits,
      n_layers: parsed.data.nLayers,
      episodes: parsed.data.episodes,
      n_steps: parsed.data.nSteps,
      mode: "train",
    };

    const result = await runPythonModule<Record<string, unknown>>({
      module: "src.engine.quantum_rl_agent",
      config,
      componentName: "rl-agent",
      timeoutMs: 300_000, // 5 min
      correlationId: req.id,
    });

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
          experimental: true,
          authoritative: false,
          decision_role: "challenger_only",
        },
        executionTimeMs: typeof result.execution_time_ms === "number" ? result.execution_time_ms : null,
      });
    } catch (dbErr) {
      // Persistence failure must not suppress the training result.
      // Log and surface in response so the caller can observe the gap.
      req.log.error({ err: dbErr }, "RL train: failed to persist to rl_training_runs");
      res.json({ ...result, persistence_error: "rl_training_runs insert failed" });
      return;
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "RL train failed");
    res.status(500).json({ error: "RL train failed" });
  }
});

// POST /api/quantum-mc/rl-evaluate — Evaluate agent on test data
quantumMcRoutes.post("/rl-evaluate", pipelinePauseGate, async (req, res) => {
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
    req.log.error({ err }, "RL evaluate failed");
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
