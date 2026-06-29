/**
 * POST /slumhouse/api/carter-session — mints a short-lived ElevenLabs ConvAI
 * conversation token for the Carter voice agent so the browser SDK can open a
 * WebRTC/WebSocket session WITHOUT exposing ELEVENLABS_API_KEY to the client.
 *
 * Agent ID is locked server-side to CARTER_AGENT_ID — Slumhouse only ever
 * launches the one Carter agent, and minting tokens for arbitrary agent ids
 * is not a capability we want to expose to a hostile friend.
 *
 * Mirrors anam-session.ts (the Anam persona token mint) almost exactly.
 */
import { Router, type Response } from "express";
import { requireSlumhouseUser, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";

const CARTER_AGENT_ID = process.env.CARTER_AGENT_ID;
const ELEVENLABS_CONVERSATION_TOKEN_URL = "https://api.elevenlabs.io/v1/convai/conversation/token";

export async function postCarterSession(req: SlumhouseRequest, res: Response): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "elevenlabs_api_key_missing" });
    return;
  }
  try {
    const r = await fetch(`${ELEVENLABS_CONVERSATION_TOKEN_URL}?agent_id=${CARTER_AGENT_ID}`, {
      method: "GET",
      headers: { "xi-api-key": apiKey },
    });
    if (!r.ok) {
      const errText = await r.text();
      res.status(502).json({ error: "elevenlabs_upstream_failed", status: r.status, detail: errText.slice(0, 500) });
      return;
    }
    const data = (await r.json()) as { token?: string };
    if (!data.token) {
      res.status(502).json({ error: "elevenlabs_no_token" });
      return;
    }
    res.json({ conversationToken: data.token });
  } catch (e) {
    res.status(500).json({ error: "carter_mint_failed", detail: e instanceof Error ? e.message : String(e) });
  }
}

export const carterSessionRouter = Router();
carterSessionRouter.post("/slumhouse/api/carter-session", requireSlumhouseUser, postCarterSession);
