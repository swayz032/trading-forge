/**
 * Model Router — Selects local Ollama or cloud GPT-5-mini based on task role.
 *
 * Local models handle volume (fast, free, 24/7).
 * Cloud model handles depth (frontier reasoning for critic, proposer, review).
 * Every cloud call has a local fallback.
 *
 * Token budget: ~185K tokens/day out of 2.5M free (7.4%).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { logger } from "../index.js";
import { CircuitBreakerRegistry, CircuitOpenError } from "../lib/circuit-breaker.js";

const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "../../..");

export interface ModelConfig {
  provider: "openai" | "ollama";
  model: string;
  temperature: number;
  maxTokens: number;
  systemPromptPath?: string;
  responseFormat?: "json" | "text";
  fallback?: {
    provider: "ollama";
    model: string;
  };
}

export type ModelRole =
  | "critic_evaluator"
  | "strategy_proposer"
  | "nightly_review"
  | "fast_critique"
  | "dsl_writer"
  | "embedder";

const MODEL_CONFIGS: Record<ModelRole, ModelConfig> = {
  // Cloud models — frontier reasoning for depth
  critic_evaluator: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.2,
    maxTokens: 2048,
    systemPromptPath: "src/agents/critic-evaluator.md",
    responseFormat: "json",
    fallback: { provider: "ollama", model: "deepseek-r1:14b" },
  },
  strategy_proposer: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.7,
    maxTokens: 3072,
    systemPromptPath: "src/agents/strategy-proposer.md",
    responseFormat: "json",
    fallback: { provider: "ollama", model: "qwen3-coder:30b" },
  },
  nightly_review: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.4,
    maxTokens: 4096,
    systemPromptPath: "src/agents/nightly-self-critique.md",
    responseFormat: "json",
    fallback: { provider: "ollama", model: "deepseek-r1:14b" },
  },
  // Local models — volume, speed, cost
  fast_critique: {
    provider: "ollama",
    model: "deepseek-r1:14b",
    temperature: 0.3,
    maxTokens: 2048,
  },
  dsl_writer: {
    provider: "ollama",
    model: "qwen3-coder:30b",
    temperature: 0.5,
    maxTokens: 3072,
  },
  embedder: {
    provider: "ollama",
    model: "nomic-embed-text",
    temperature: 0,
    maxTokens: 0,
  },
};

/**
 * Select model config for a given role.
 * Falls back to local model if cloud is unavailable.
 */
export function selectModel(role: ModelRole): ModelConfig {
  const config = MODEL_CONFIGS[role];
  if (!config) {
    logger.warn({ role }, "Unknown model role, falling back to fast_critique");
    return MODEL_CONFIGS.fast_critique;
  }
  return config;
}

/**
 * Load system prompt from file.
 * Returns empty string if file not found (non-fatal).
 */
export function loadSystemPrompt(role: ModelRole): string {
  const config = MODEL_CONFIGS[role];
  if (!config?.systemPromptPath) return "";

  try {
    const fullPath = resolve(PROJECT_ROOT, config.systemPromptPath);
    return readFileSync(fullPath, "utf-8");
  } catch {
    logger.warn({ role, path: config.systemPromptPath }, "System prompt file not found");
    return "";
  }
}

/**
 * Get fallback config for a role (when cloud API is down).
 */
export function getFallback(role: ModelRole): ModelConfig | null {
  const config = MODEL_CONFIGS[role];
  if (!config?.fallback) return null;

  return {
    provider: config.fallback.provider,
    model: config.fallback.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  };
}

/**
 * Check if a role uses cloud model.
 */
export function isCloudModel(role: ModelRole): boolean {
  return MODEL_CONFIGS[role]?.provider === "openai";
}

/**
 * Call OpenAI API with the model config for a role.
 * Falls back to null on failure (caller should use Ollama fallback).
 */
export async function callOpenAI(
  role: ModelRole,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<string | null> {
  const config = MODEL_CONFIGS[role];
  if (!config || config.provider !== "openai") return null;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn({ role }, "OPENAI_API_KEY not set, skipping cloud model");
    return null;
  }

  const cb = CircuitBreakerRegistry.get("openai", { failureThreshold: 3, cooldownMs: 30_000 });

  // If the circuit is open, skip immediately and let caller fall back to Ollama
  if (cb.currentState === "OPEN") {
    logger.warn({ role, circuitState: cb.status() }, "OpenAI circuit OPEN — skipping, caller should use fallback");
    return null;
  }

  try {
    const result = await cb.call(async () => {
      const { default: OpenAI } = await import("openai");
      // Route through proxy so backend services share the same daily budget
      // and telemetry as n8n workflows. Falls back to direct OpenAI if proxy
      // is down (proxy URL is reachable from same host).
      const proxyBase = process.env.OPENAI_PROXY_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}/api/openai-proxy/v1`;
      const client = new OpenAI({ apiKey, baseURL: proxyBase });

      // Load system prompt from file
      const systemPrompt = loadSystemPrompt(role);
      const allMessages = systemPrompt
        ? [{ role: "system" as const, content: systemPrompt }, ...messages]
        : messages;

      const isGpt5 = config.model.startsWith("gpt-5");
      const response = await client.chat.completions.create({
        model: config.model,
        messages: allMessages,
        ...(isGpt5
          ? { max_completion_tokens: config.maxTokens }
          : { max_tokens: config.maxTokens, temperature: config.temperature }),
        ...(config.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        logger.warn({ role }, "OpenAI returned empty response");
        return null;
      }

      logger.info({
        role,
        model: config.model,
        tokens: response.usage?.total_tokens,
      }, "OpenAI call completed");

      return content;
    });

    return result;
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      logger.warn({ role, endpoint: "openai", reopensAt: err.reopensAt.toISOString() }, "OpenAI circuit OPEN — caller should use fallback");
    } else {
      logger.error({ role, err }, "OpenAI call failed, caller should use fallback");
    }
    return null;
  }
}

export { MODEL_CONFIGS };
