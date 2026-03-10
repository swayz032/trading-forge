import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaClient } from "./ollama-client.js";

describe("OllamaClient", () => {
  let client: OllamaClient;

  beforeEach(() => {
    client = new OllamaClient("http://localhost:11434");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generate", () => {
    it("sends correct request to /api/generate", async () => {
      const mockResponse = { response: "test output" };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const result = await client.generate("trading-quant", "Generate a strategy");

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "trading-quant",
            prompt: "Generate a strategy",
            stream: false,
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("passes options through to request body", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ response: "ok" }), { status: 200 })
      );

      await client.generate("trading-quant", "test", { temperature: 0.5, num_ctx: 4096 });

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.objectContaining({
          body: JSON.stringify({
            model: "trading-quant",
            prompt: "test",
            stream: false,
            options: { temperature: 0.5, num_ctx: 4096 },
          }),
        })
      );
    });

    it("throws on network error (Ollama unreachable)", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("fetch failed"));

      await expect(client.generate("trading-quant", "test")).rejects.toThrow(
        "Ollama unreachable at http://localhost:11434: fetch failed"
      );
    });

    it("throws on non-200 response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("model not found", { status: 404 })
      );

      await expect(client.generate("bad-model", "test")).rejects.toThrow(
        "Ollama error 404"
      );
    });

    it("throws on malformed JSON response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("not json", { status: 200 })
      );

      await expect(client.generate("trading-quant", "test")).rejects.toThrow(
        "Failed to parse Ollama response"
      );
    });
  });

  describe("chat", () => {
    it("sends correct request to /api/chat", async () => {
      const mockResponse = { message: { role: "assistant", content: "critique here" } };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const messages = [{ role: "user" as const, content: "Review these results" }];
      const result = await client.chat("llama3:8b", messages);

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/chat",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            model: "llama3:8b",
            messages,
            stream: false,
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("defaults", () => {
    it("uses default host when not specified", () => {
      const defaultClient = new OllamaClient();
      expect(defaultClient.baseUrl).toBe("http://localhost:11434");
    });
  });
});
