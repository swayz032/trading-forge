/**
 * OpenAI-Compatible Proxy Route
 *
 * Mounted at /api/openai-proxy. n8n workflows configure their lmChatOpenAi
 * sub-node with baseURL = http://host.docker.internal:4000/api/openai-proxy/v1
 * and apiKey = $API_KEY (the same Bearer token authMiddleware accepts).
 *
 * Why this exists:
 *   - GPT-5 series rejects max_tokens (must be max_completion_tokens) and
 *     rejects non-default temperature. n8n's lmChatOpenAi node still sends
 *     the legacy params, causing 400 errors that show as "execution failed".
 *   - Centralizing the call here lets us upgrade models without touching
 *     every workflow, apply the OpenAI circuit breaker, and log cost telemetry.
 */

import { Router } from "express";
import { z } from "zod";

import { CircuitBreakerRegistry, CircuitOpenError } from "../lib/circuit-breaker.js";
import { logger } from "../lib/logger.js";

export const openaiProxyRoutes = Router();

// ─── Daily token budget ───────────────────────────────────────────────────────
// User has 2.5M GPT-5-mini free tokens/day at the OpenAI org level, SHARED with
// the Aspire project. Trading Forge gets a hard daily cap so it can't starve
// Aspire. When budget hits, callers receive 429 → model-router falls back to
// local Ollama (deepseek-r1:14b / qwen3-coder:30b) automatically.
const DAILY_BUDGET = Number(process.env.TRADING_FORGE_DAILY_TOKEN_BUDGET ?? 1_000_000);
const ALERT_THRESHOLDS = [0.5, 0.75, 0.9, 1.0] as const;

interface DailyUsage {
  date: string;            // YYYY-MM-DD UTC
  tokensUsed: number;
  callCount: number;
  byModel: Record<string, number>;
  alertedAt: Set<number>;  // thresholds already alerted this day
  // ─── Prompt caching metrics ───
  // OpenAI auto-caches prompts ≥1024 tokens; cached-prefix tokens billed at 50%.
  // Tracking hit rate exposes which workflows are wasting budget on cache misses.
  promptTokensTotal: number;
  cachedTokensTotal: number;
  reasoningTokensTotal: number;
  callsWithCacheHit: number;
}

let dailyUsage: DailyUsage = freshUsage();

function freshUsage(): DailyUsage {
  return {
    date: new Date().toISOString().slice(0, 10),
    tokensUsed: 0,
    callCount: 0,
    byModel: {},
    alertedAt: new Set<number>(),
    promptTokensTotal: 0,
    cachedTokensTotal: 0,
    reasoningTokensTotal: 0,
    callsWithCacheHit: 0,
  };
}

function rolloverIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyUsage.date !== today) {
    logger.info(
      {
        previousDate: dailyUsage.date,
        previousTokens: dailyUsage.tokensUsed,
        previousCalls: dailyUsage.callCount,
        previousByModel: dailyUsage.byModel,
      },
      "openai-proxy: daily budget rolled over",
    );
    dailyUsage = freshUsage();
  }
}

async function postBudgetAlert(threshold: number, used: number): Promise<void> {
  const port = Number(process.env.DISCORD_ALERT_PORT) || 4100;
  const payload = {
    source: "openai-proxy",
    summary: `GPT-5 mini token budget at ${Math.round(threshold * 100)}% (${used.toLocaleString()} / ${DAILY_BUDGET.toLocaleString()} tokens used today)`,
    impact:
      threshold >= 1
        ? "Hard cap reached. Trading Forge calls now return 429; model-router will fall back to local Ollama (deepseek-r1:14b / qwen3-coder:30b). No outage but lower model quality until midnight UTC reset."
        : threshold >= 0.9
        ? "90% of daily Trading Forge GPT-5 mini budget consumed. Aspire project still has shared-pool access."
        : `${Math.round(threshold * 100)}% of daily Trading Forge budget consumed. Continue normal operation.`,
    remediation:
      threshold >= 1
        ? "If sustained: raise TRADING_FORGE_DAILY_TOKEN_BUDGET in .env, restart trading-forge-api. Investigate which workflow drove the spike via /api/openai-proxy/usage."
        : "Review usage breakdown at /api/openai-proxy/usage. Check for runaway loops in n8n workflows.",
    metadata: {
      thresholdPercent: Math.round(threshold * 100),
      tokensUsed: used,
      dailyBudget: DAILY_BUDGET,
      byModel: dailyUsage.byModel,
      callCount: dailyUsage.callCount,
    },
  };
  try {
    await fetch(`http://localhost:${port}/alert/critical-alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    logger.warn({ err, threshold }, "openai-proxy: failed to post budget alert");
  }
}

interface UsageBreakdown {
  prompt_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
}

function recordUsage(model: string, totalTokens: number, breakdown: UsageBreakdown): void {
  rolloverIfNeeded();
  dailyUsage.tokensUsed += totalTokens;
  dailyUsage.callCount += 1;
  dailyUsage.byModel[model] = (dailyUsage.byModel[model] ?? 0) + totalTokens;
  dailyUsage.promptTokensTotal += breakdown.prompt_tokens;
  dailyUsage.cachedTokensTotal += breakdown.cached_tokens;
  dailyUsage.reasoningTokensTotal += breakdown.reasoning_tokens;
  if (breakdown.cached_tokens > 0) dailyUsage.callsWithCacheHit += 1;
  for (const t of ALERT_THRESHOLDS) {
    if (!dailyUsage.alertedAt.has(t) && dailyUsage.tokensUsed >= DAILY_BUDGET * t) {
      dailyUsage.alertedAt.add(t);
      void postBudgetAlert(t, dailyUsage.tokensUsed);
      logger.warn(
        { thresholdPercent: t * 100, tokensUsed: dailyUsage.tokensUsed, dailyBudget: DAILY_BUDGET },
        "openai-proxy: budget threshold crossed",
      );
    }
  }
}

function isOverBudget(): boolean {
  rolloverIfNeeded();
  return dailyUsage.tokensUsed >= DAILY_BUDGET;
}

// GPT-5 introduced "developer" as a privileged-instruction role replacing
// "system" for the new reasoning models. Both are accepted by OpenAI; we
// pass through whichever the client sends.
const ChatMessage = z.object({
  role: z.enum(["system", "developer", "user", "assistant", "tool", "function"]),
  content: z.union([z.string(), z.array(z.any()), z.null()]).optional(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.any()).optional(),
});

const ChatRequest = z
  .object({
    model: z.string(),
    messages: z.array(ChatMessage).min(1),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    response_format: z.any().optional(),
    stream: z.boolean().optional(),
    tools: z.array(z.any()).optional(),
    tool_choice: z.any().optional(),
  })
  .passthrough();

openaiProxyRoutes.post("/v1/chat/completions", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: { message: "OPENAI_API_KEY not configured on server", type: "configuration_error" },
    });
    return;
  }

  const parsed = ChatRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { message: parsed.error.message, type: "invalid_request_error" },
    });
    return;
  }

  if (parsed.data.stream) {
    res.status(501).json({
      error: { message: "Streaming not supported by proxy yet", type: "unsupported_feature" },
    });
    return;
  }

  // Daily budget gate — return 429 so callers (model-router) fall back to Ollama
  if (isOverBudget()) {
    req.log.warn(
      { tokensUsed: dailyUsage.tokensUsed, dailyBudget: DAILY_BUDGET },
      "openai-proxy: daily budget exhausted, returning 429",
    );
    res.status(429).json({
      error: {
        message: `Trading Forge daily GPT-5 mini budget exhausted (${dailyUsage.tokensUsed.toLocaleString()} / ${DAILY_BUDGET.toLocaleString()} tokens). Resets at midnight UTC. Falling back to Ollama recommended.`,
        type: "daily_budget_exceeded",
      },
    });
    return;
  }

  const cb = CircuitBreakerRegistry.get("openai-proxy", { failureThreshold: 5, cooldownMs: 30_000 });
  if (cb.currentState === "OPEN") {
    res.status(503).json({
      error: { message: "Upstream circuit open", type: "service_unavailable" },
    });
    return;
  }

  const { model, messages, max_tokens, max_completion_tokens, temperature, top_p, response_format, tools, tool_choice } = parsed.data;
  const isGpt5 = model.startsWith("gpt-5");
  const startedAt = Date.now();

  try {
    const result = await cb.call(async () => {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey });

      const tokenLimit = max_completion_tokens ?? max_tokens;

      const upstreamPayload: Record<string, unknown> = {
        model,
        messages,
        ...(tokenLimit !== undefined
          ? isGpt5
            ? { max_completion_tokens: tokenLimit }
            : { max_tokens: tokenLimit }
          : {}),
        ...(isGpt5
          ? {}
          : {
              ...(temperature !== undefined ? { temperature } : {}),
              ...(top_p !== undefined ? { top_p } : {}),
            }),
        ...(response_format !== undefined ? { response_format } : {}),
        ...(tools !== undefined ? { tools } : {}),
        ...(tool_choice !== undefined ? { tool_choice } : {}),
      };

      return client.chat.completions.create(upstreamPayload as any);
    });

    const elapsedMs = Date.now() - startedAt;
    const usage = (result as any).usage ?? {};
    const totalTokens = usage.total_tokens ?? 0;
    const promptTokens = usage.prompt_tokens ?? 0;
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
    recordUsage(model, totalTokens, {
      prompt_tokens: promptTokens,
      cached_tokens: cachedTokens,
      reasoning_tokens: reasoningTokens,
    });
    req.log.info(
      {
        model,
        elapsedMs,
        promptTokens,
        cachedTokens,
        cacheHitRatio: promptTokens > 0 ? Math.round((cachedTokens / promptTokens) * 100) : 0,
        completionTokens: usage.completion_tokens,
        reasoningTokens,
        totalTokens,
        budgetUsedPercent: Math.round((dailyUsage.tokensUsed / DAILY_BUDGET) * 100),
        gpt5Translated: isGpt5,
      },
      "openai-proxy: completion served",
    );

    res.json(result);
  } catch (err: any) {
    const elapsedMs = Date.now() - startedAt;
    if (err instanceof CircuitOpenError) {
      req.log.warn({ model, elapsedMs }, "openai-proxy: circuit open");
      res.status(503).json({
        error: { message: "Upstream circuit open", type: "service_unavailable" },
      });
      return;
    }

    const status = typeof err?.status === "number" ? err.status : 502;
    const upstreamMessage = err?.error?.message ?? err?.message ?? "Upstream call failed";
    req.log.error({ model, elapsedMs, status, err: upstreamMessage }, "openai-proxy: upstream error");
    res.status(status).json({
      error: {
        message: upstreamMessage,
        type: err?.error?.type ?? "upstream_error",
      },
    });
  }
});

// GET /v1/models — LangChain OpenAI client probes this on startup for
// model validation. Forward to OpenAI so the upstream remains the source
// of truth for which models exist (and our proxy stays a thin shim).
openaiProxyRoutes.get("/v1/models", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: { message: "OPENAI_API_KEY not configured", type: "configuration_error" } });
    return;
  }
  try {
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    res.status(r.status);
    res.setHeader("Content-Type", r.headers.get("content-type") ?? "application/json");
    res.send(await r.text());
  } catch (err: any) {
    req.log.error({ err: err?.message }, "openai-proxy: /v1/models forward failed");
    res.status(502).json({ error: { message: err?.message ?? "upstream failed", type: "upstream_error" } });
  }
});

openaiProxyRoutes.get("/v1/models/:id", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: { message: "OPENAI_API_KEY not configured", type: "configuration_error" } });
    return;
  }
  try {
    const r = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(req.params.id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    res.status(r.status);
    res.setHeader("Content-Type", r.headers.get("content-type") ?? "application/json");
    res.send(await r.text());
  } catch (err: any) {
    req.log.error({ err: err?.message, modelId: req.params.id }, "openai-proxy: /v1/models/:id forward failed");
    res.status(502).json({ error: { message: err?.message ?? "upstream failed", type: "upstream_error" } });
  }
});

openaiProxyRoutes.get("/usage", (_req, res) => {
  rolloverIfNeeded();
  const cacheHitRatio = dailyUsage.promptTokensTotal > 0
    ? dailyUsage.cachedTokensTotal / dailyUsage.promptTokensTotal
    : 0;
  // OpenAI cached prompt tokens billed at 50% — effective cost vs all-uncached
  const billableTokens = dailyUsage.tokensUsed - dailyUsage.cachedTokensTotal * 0.5;
  res.json({
    date: dailyUsage.date,
    tokensUsed: dailyUsage.tokensUsed,
    dailyBudget: DAILY_BUDGET,
    percentUsed: Math.round((dailyUsage.tokensUsed / DAILY_BUDGET) * 1000) / 10,
    tokensRemaining: Math.max(0, DAILY_BUDGET - dailyUsage.tokensUsed),
    callCount: dailyUsage.callCount,
    byModel: dailyUsage.byModel,
    alertedThresholds: [...dailyUsage.alertedAt].sort(),
    overBudget: isOverBudget(),
    cache: {
      promptTokensTotal: dailyUsage.promptTokensTotal,
      cachedTokensTotal: dailyUsage.cachedTokensTotal,
      cacheHitRatio: Math.round(cacheHitRatio * 1000) / 10,  // percent with 1 decimal
      callsWithCacheHit: dailyUsage.callsWithCacheHit,
      cachedTokenSavings: Math.round(dailyUsage.cachedTokensTotal * 0.5),
      effectiveBillableTokens: Math.round(billableTokens),
    },
    reasoning: {
      reasoningTokensTotal: dailyUsage.reasoningTokensTotal,
      ratioOfCompletion: dailyUsage.tokensUsed > 0
        ? Math.round((dailyUsage.reasoningTokensTotal / dailyUsage.tokensUsed) * 1000) / 10
        : 0,
    },
    note: "Resets at midnight UTC. Cached tokens count in budget but billed at 50%.",
  });
});

openaiProxyRoutes.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "openai-proxy",
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    dailyBudget: DAILY_BUDGET,
    tokensUsedToday: dailyUsage.tokensUsed,
  });
});
