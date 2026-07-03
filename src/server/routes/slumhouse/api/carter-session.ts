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
 *
 * FIX 1 (deep-scan #12): Guard changed from requireSlumhouseUserOrAdmin to
 * requireAdminSession (admin-only). A plain Discord friend session is no longer
 * sufficient to mint Carter tokens. The Carter voice agent's mutation tools
 * (bot-power toggle, promotion request, save_code_draft) are operator-only
 * capabilities — any Discord member should not be able to drive them.
 *
 * FIX 5 (deep-scan #12): Origin check applied as defense-in-depth.
 */
import { Router, type Request, type Response } from "express";
import {
  requireAdminSession,
  checkSlumhouseOrigin,
} from "../../../lib/slumhouse/require-session.js";

const CARTER_AGENT_ID = process.env.CARTER_AGENT_ID;
const ELEVENLABS_CONVERSATION_TOKEN_URL = "https://api.elevenlabs.io/v1/convai/conversation/token";

export async function postCarterSession(req: Request, res: Response): Promise<void> {
  // FIX 5: Origin check before minting.
  if (!checkSlumhouseOrigin(req, res)) return;

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
// FIX 1 (deep-scan #12): Admin-ONLY. A plain Discord friend session (requireSlumhouseUserOrAdmin)
// was not sufficient — any Discord member could drive Carter's mutation tools. The Carter
// connect page lives inside the operator-only Office, so only the admin session is valid here.
carterSessionRouter.post("/slumhouse/api/carter-session", requireAdminSession, postCarterSession);
