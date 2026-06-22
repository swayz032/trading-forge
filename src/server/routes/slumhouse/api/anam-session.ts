/**
 * POST /slumhouse/api/anam-session — mints a one-hour Anam session token for the
 * Slumdawg UpTOP persona so the browser SDK can auto-stream video without
 * exposing ANAM_API_KEY to the client.
 *
 * Persona ID is hard-coded to the Slumdawg UpTOP UUID — Slumhouse only ever
 * launches that one persona, and locking it server-side prevents a hostile
 * friend from minting tokens for arbitrary persona IDs.
 */
import { Router, type Response } from "express";
import { requireSlumhouseUser, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";

const SLUMDAWG_PERSONA_ID = "026cacc4-619e-4cec-a144-c4a8dfcb623e";
const ANAM_SESSION_TOKEN_URL = "https://api.anam.ai/v1/auth/session-token";

export async function postAnamSession(req: SlumhouseRequest, res: Response): Promise<void> {
  const apiKey = process.env.ANAM_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "anam_api_key_missing" });
    return;
  }
  try {
    const r = await fetch(ANAM_SESSION_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientLabel: `slumhouse:${req.slumhouseUser?.discordUserId ?? "anon"}`,
        personaConfig: { personaId: SLUMDAWG_PERSONA_ID },
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      res.status(502).json({ error: "anam_upstream_failed", status: r.status, detail: errText.slice(0, 500) });
      return;
    }
    const data = (await r.json()) as { sessionToken?: string };
    if (!data.sessionToken) {
      res.status(502).json({ error: "anam_no_token" });
      return;
    }
    res.json({ sessionToken: data.sessionToken });
  } catch (e) {
    res.status(500).json({ error: "anam_mint_failed", detail: e instanceof Error ? e.message : String(e) });
  }
}

export const anamSessionRouter = Router();
anamSessionRouter.post("/slumhouse/api/anam-session", requireSlumhouseUser, postAnamSession);
