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

export class OllamaClient {
  public readonly baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, timeoutMs = 120_000) {
    this.baseUrl = baseUrl ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
    this.timeoutMs = timeoutMs;
  }

  async generate(model: string, prompt: string, options?: OllamaOptions): Promise<GenerateResponse> {
    const body: Record<string, unknown> = { model, prompt, stream: false };
    if (options) body.options = options;
    return this.request<GenerateResponse>("/api/generate", body);
  }

  async chat(model: string, messages: ChatMessage[], options?: OllamaOptions): Promise<ChatResponse> {
    const body: Record<string, unknown> = { model, messages, stream: false };
    if (options) body.options = options;
    return this.request<ChatResponse>("/api/chat", body);
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
}
