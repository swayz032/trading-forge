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

// Model routing: task type → model name
const MODEL_ROUTES: Record<string, string> = {
  fast: "deepseek-r1:14b",
  generate: "trading-quant",
  embed: "nomic-embed-text",
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
    json?: boolean,
  ): Promise<GenerateResponse> {
    const body: Record<string, unknown> = {
      model: this.resolveModel(model),
      prompt,
      stream: false,
    };
    if (json) body.format = "json";
    if (options) body.options = options;
    return this.request<GenerateResponse>("/api/generate", body);
  }

  async chat(
    model: string,
    messages: ChatMessage[],
    options?: OllamaOptions,
    json?: boolean,
  ): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.resolveModel(model),
      messages,
      stream: false,
    };
    if (json) body.format = "json";
    if (options) body.options = options;
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
    json?: boolean,
  ): AsyncGenerator<string> {
    const body: Record<string, unknown> = {
      model: this.resolveModel(model),
      prompt,
      stream: true,
    };
    if (json) body.format = "json";
    if (options) body.options = options;
    yield* this.streamRequest("/api/generate", body);
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
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
  }

  private async *streamRequest(path: string, body: Record<string, unknown>): AsyncGenerator<string> {
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

        if (!res.ok) {
          if (res.status === 503 && attempt < 2) {
            clearTimeout(timeout);
            await sleep(1000 * Math.pow(2, attempt));
            continue;
          }
          const text = await res.text().catch(() => "");
          throw new Error(`Ollama error ${res.status}: ${text}`);
        }

        // Connection established — stream the body
        try {
          const reader = res.body?.getReader();
          if (!reader) throw new Error("No response body");
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
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
          return; // Success
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
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
  }
}
