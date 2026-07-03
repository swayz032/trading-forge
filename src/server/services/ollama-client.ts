export interface GenerateResponse {
  response: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  message: { role: string; content: string };
  [key: string]: unknown;
}

export interface OllamaOptions {
  temperature?: number;
  num_ctx?: number;
  num_gpu?: number;
  [key: string]: unknown;
}

export interface EmbedResponse {
  embeddings: number[][];
}

import { CircuitBreakerRegistry, CircuitOpenError } from "../lib/circuit-breaker.js";

// FINDING #8 FIX: per-chunk deadline for streaming responses.
// The initial connect has a 120s AbortController timeout, but after connection is
// established, mid-stream stalls hang the caller indefinitely (reader.read() never
// resolves). OLLAMA_STREAM_CHUNK_TIMEOUT_MS is env-overridable; default 30s.
const OLLAMA_STREAM_CHUNK_TIMEOUT_MS = parseInt(
  process.env.OLLAMA_STREAM_CHUNK_TIMEOUT_MS ?? "30000",
  10,
);

// Model routing: task type → model name
// 2026-07-03 tower-model consolidation: the tower now serves exactly ONE local
// model — gemma4:e4b-it-qat (the YouTube/transcript extraction model). The old
// deepseek-r1:14b / trading-quant / nomic-embed-text builds are no longer pulled.
// All three roles collapse to the one model.
// NOTE (embed): gemma4:e4b-it-qat is an instruct model, not a dedicated embedder.
// Ollama /api/embed still returns vectors from it, but their dimensionality differs
// from the retired nomic-embed-text — see graveyard-gate.ts (stored graveyard
// embeddings are nomic-dim, so the similarity gate stays fail-open until they are
// recomputed or the embedding feature is formally retired).
const MODEL_ROUTES: Record<string, string> = {
  fast: "gemma4:e4b-it-qat",
  generate: "gemma4:e4b-it-qat",
  embed: "gemma4:e4b-it-qat",
};

export type ModelRole = keyof typeof MODEL_ROUTES;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class OllamaClient {
  public readonly baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, timeoutMs = 120_000) {
    this.baseUrl = baseUrl ?? process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    this.timeoutMs = timeoutMs;
  }

  /** Resolve a role name (fast/generate/embed) to a model, or pass through a model name directly. */
  resolveModel(modelOrRole: string): string {
    return MODEL_ROUTES[modelOrRole] ?? modelOrRole;
  }

  async generate(
    model: string,
    prompt: string,
    options?: OllamaOptions,
    /** Wave 26 Pass B:
     *  - `true`  → body.format = "json"  (syntactic JSON enforcement, backward-compat)
     *  - object  → body.format = <schema> (GBNF grammar-constrained, Ollama 0.5+, strict shape)
     *  - falsy   → omit format entirely
     */
    format?: boolean | Record<string, unknown>,
  ): Promise<GenerateResponse> {
    const body: Record<string, unknown> = {
      model: this.resolveModel(model),
      prompt,
      stream: false,
    };
    if (format === true) body.format = "json";
    else if (format && typeof format === "object") body.format = format;
    if (options) body.options = options;
    return this.request<GenerateResponse>("/api/generate", body);
  }

  async chat(
    model: string,
    messages: ChatMessage[],
    options?: OllamaOptions,
    /** Wave 26 Pass B:
     *  - `true`  → body.format = "json"  (syntactic JSON enforcement, backward-compat)
     *  - object  → body.format = <schema> (GBNF grammar-constrained, Ollama 0.5+, strict shape)
     *  - falsy   → omit format entirely
     */
    format?: boolean | Record<string, unknown>,
    /** Wave 26 Pass C-fix: top-level Ollama keep_alive (e.g. "30m"). Keeps the
     *  model resident in VRAM/RAM after the call so subsequent calls skip cold
     *  start. Avoids 30-90s reload tax per call on Gemma 4 / 8 GB VRAM hosts. */
    keepAlive?: string,
  ): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.resolveModel(model),
      messages,
      stream: false,
    };
    if (format === true) body.format = "json";
    else if (format && typeof format === "object") body.format = format;
    if (options) body.options = options;
    if (keepAlive) body.keep_alive = keepAlive;
    return this.request<ChatResponse>("/api/chat", body);
  }

  async embed(text: string | string[], model = "embed"): Promise<number[][]> {
    const input = Array.isArray(text) ? text : [text];
    const body = {
      model: this.resolveModel(model),
      input,
    };
    const res = await this.request<EmbedResponse>("/api/embed", body);
    return res.embeddings;
  }

  async *generateStream(
    model: string,
    prompt: string,
    options?: OllamaOptions,
    /** Wave 26 Pass B: true → "json", object → schema, falsy → omit */
    format?: boolean | Record<string, unknown>,
  ): AsyncGenerator<string> {
    const body: Record<string, unknown> = {
      model: this.resolveModel(model),
      prompt,
      stream: true,
    };
    if (format === true) body.format = "json";
    else if (format && typeof format === "object") body.format = format;
    if (options) body.options = options;
    yield* this.streamRequest("/api/generate", body);
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const cb = CircuitBreakerRegistry.get("ollama", { failureThreshold: 3, cooldownMs: 30_000 });

    // The entire retry loop is the unit of work for the circuit breaker.
    // If the loop exhausts all retries and throws, that counts as one failure.
    return cb.call(async () => {
      let lastError: unknown;

      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const res = await fetch(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          // 503 = Service Unavailable (often model loading)
          if (!res.ok) {
            if (res.status === 503 && attempt < 2) {
              clearTimeout(timeout);
              await sleep(1000 * Math.pow(2, attempt));
              continue;
            }
            const text = await res.text().catch(() => "");
            throw new Error(`Ollama error ${res.status}: ${text}`);
          }

          try {
            return (await res.json()) as T;
          } catch {
            throw new Error("Failed to parse Ollama response");
          }
        } catch (err) {
          // Do not let CircuitOpenError be swallowed by the retry loop
          if (err instanceof CircuitOpenError) throw err;

          lastError = err;
          const isRetryable =
            err instanceof Error &&
            (err.name === "AbortError" || // Timeout
              (err.cause as any)?.code === "ECONNREFUSED" || // Connection refused
              (err.cause as any)?.code === "ETIMEDOUT"); // Network timeout

          if (isRetryable && attempt < 2) {
            clearTimeout(timeout);
            await sleep(1000 * Math.pow(2, attempt));
            continue;
          }

          clearTimeout(timeout);
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Ollama unreachable at ${this.baseUrl}: ${msg}`, { cause: err });
        } finally {
          clearTimeout(timeout);
        }
      }

      throw lastError;
    });
  }

  private async *streamRequest(path: string, body: Record<string, unknown>): AsyncGenerator<string> {
    const cb = CircuitBreakerRegistry.get("ollama", { failureThreshold: 3, cooldownMs: 30_000 });

    // Wrap the initial connection (including retries) in the circuit breaker.
    // Once connected, streaming chunks flow outside the CB.
    const res = await cb.call(async () => {
      let lastError: unknown;

      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const response = await fetch(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            if (response.status === 503 && attempt < 2) {
              clearTimeout(timeout);
              await sleep(1000 * Math.pow(2, attempt));
              continue;
            }
            const text = await response.text().catch(() => "");
            throw new Error(`Ollama error ${response.status}: ${text}`);
          }

          clearTimeout(timeout);
          return response;
        } catch (err) {
          if (err instanceof CircuitOpenError) throw err;

          lastError = err;
          const isRetryable =
            err instanceof Error &&
            (err.name === "AbortError" ||
              (err.cause as any)?.code === "ECONNREFUSED" ||
              (err.cause as any)?.code === "ETIMEDOUT");

          if (isRetryable && attempt < 2) {
            clearTimeout(timeout);
            await sleep(1000 * Math.pow(2, attempt));
            continue;
          }

          clearTimeout(timeout);
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Ollama unreachable at ${this.baseUrl}: ${msg}`, { cause: err });
        }
      }

      throw lastError;
    });

    // Connection established — stream chunks outside the circuit breaker
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();

    try {
      // FINDING #8 FIX: per-chunk deadline — cancel reader if no chunk arrives within
      // OLLAMA_STREAM_CHUNK_TIMEOUT_MS. Without this, a mid-stream stall hangs forever.
      while (true) {
        let chunkTimer: ReturnType<typeof setTimeout> | null = null;
        const chunkOrTimeout = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            chunkTimer = setTimeout(
              () => reject(new Error(`Ollama stream stalled: no chunk for ${OLLAMA_STREAM_CHUNK_TIMEOUT_MS}ms`)),
              OLLAMA_STREAM_CHUNK_TIMEOUT_MS,
            );
          }),
        ]).finally(() => {
          if (chunkTimer !== null) clearTimeout(chunkTimer);
        });
        const { done, value } = chunkOrTimeout;
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n").filter(Boolean)) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) yield parsed.response;
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err) {
      // Cancel the reader on stall/error so downstream callers are not left hanging
      reader.cancel().catch(() => {});
      throw err;
    } finally {
      reader.releaseLock();
    }
  }
}
