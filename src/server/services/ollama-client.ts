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
  fast: "llama3.1:8b",
  generate: "trading-quant",
  embed: "nomic-embed-text",
};

export type ModelRole = keyof typeof MODEL_ROUTES;

export class OllamaClient {
  public readonly baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, timeoutMs = 120_000) {
    this.baseUrl = baseUrl ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Ollama unreachable at ${this.baseUrl}: ${msg}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    try {
      return (await res.json()) as T;
    } catch {
      throw new Error("Failed to parse Ollama response");
    }
  }

  private async *streamRequest(path: string, body: Record<string, unknown>): AsyncGenerator<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Ollama unreachable at ${this.baseUrl}: ${msg}`);
    }

    if (!res.ok) {
      clearTimeout(timeout);
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

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
    } finally {
      clearTimeout(timeout);
    }
  }
}
