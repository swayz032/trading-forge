import { describe, it, expect, vi, beforeEach } from "vitest";
import { exchangeCodeForToken, fetchDiscordUser } from "../../lib/slumhouse/discord-oauth.js";

describe("discord-oauth", () => {
  beforeEach(() => {
    process.env.DISCORD_CLIENT_ID = "cid";
    process.env.DISCORD_CLIENT_SECRET = "secret";
    process.env.DISCORD_REDIRECT_URI = "https://example/cb";
    vi.restoreAllMocks();
  });

  it("exchangeCodeForToken POSTs to Discord and returns access_token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(JSON.stringify({ access_token: "tok_123", token_type: "Bearer" }), { status: 200 }),
    );
    const tok = await exchangeCodeForToken("abc");
    expect(tok).toBe("tok_123");
    const call = (fetchSpy.mock.calls[0] as any[])[0];
    expect(String(call)).toContain("discord.com/api/oauth2/token");
  });

  it("fetchDiscordUser GETs /users/@me with bearer", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "111", username: "kee", global_name: "Kee" }), { status: 200 }),
    );
    const u = await fetchDiscordUser("tok_123");
    expect(u.id).toBe("111");
    expect(u.displayName).toBe("Kee");
  });

  it("fetchDiscordUser falls back to username when global_name is missing", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "111", username: "kee", global_name: null }), { status: 200 }),
    );
    const u = await fetchDiscordUser("tok");
    expect(u.displayName).toBe("kee");
  });

  it("exchangeCodeForToken throws on non-200", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(exchangeCodeForToken("bad")).rejects.toThrow(/discord_oauth_token_exchange_failed/);
  });

  it("exchangeCodeForToken throws when env vars missing", async () => {
    delete process.env.DISCORD_CLIENT_ID;
    await expect(exchangeCodeForToken("abc")).rejects.toThrow(/DISCORD_CLIENT_ID/);
  });
});
