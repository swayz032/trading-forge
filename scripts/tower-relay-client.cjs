// Trading Forge HTTP-over-WebSocket reverse tunnel CLIENT (runs on tower).
// Companion to railway-relay/server.js. Connects out to Railway, holds WS open,
// proxies incoming framed requests to the matching local backend, frames
// responses back.
//
// Path-based routing (Pass 21 — covers tower services beyond the Express API):
//   /__ollama/*  → http://localhost:11434/*    (Ollama LLM inference)
//   /__oc/*      → http://localhost:4100/*     (OpenClaw Discord alert sidecar)
//   /__ocg/*     → http://localhost:18789/*    (OpenClaw gateway main)
//   /*           → http://localhost:4000/*     (Trading Forge Express API — default)
//
// Required env:
//   RELAY_SERVER   wss://tf-relay-production.up.railway.app/__relay
//   RELAY_TOKEN    shared secret matching Railway service env
//   RELAY_BACKEND  http://localhost:4000  (default route — overridable)
//
// Run via pm2:  pm2 start scripts/tower-relay-client.cjs --name tower-relay-client

const WebSocket = require("ws");
const http = require("http");
const { URL } = require("url");

// ─── Singleton enforcement ────────────────────────────────────────────────────
// Prevents two concurrent WebSocket connections from the same client process.
// On reconnect, the previous socket is closed with code 4001 ("superseded")
// before a new connection is opened. The relay server additionally enforces
// singleton at the server side via req.headers["sec-websocket-protocol"].
let currentWs = null;

const SERVER = process.env.RELAY_SERVER;
const TOKEN = process.env.RELAY_TOKEN;
const BACKEND = process.env.RELAY_BACKEND || "http://localhost:4000";

// Pass 6 / Track C F-7: per-request timeout. Without this, a hung backend
// (stalled Ollama inference, deadlocked Express handler, blocked DB query)
// holds a relay socket open indefinitely — eventually starving the WS
// connection. Default 120s lets Ollama inference complete; faster paths
// (Express /api/* defaults) can override via RELAY_FAST_TIMEOUT_MS.
const RELAY_BACKEND_TIMEOUT_MS = parseInt(process.env.RELAY_BACKEND_TIMEOUT_MS || "120000", 10);
const RELAY_FAST_TIMEOUT_MS = parseInt(process.env.RELAY_FAST_TIMEOUT_MS || "30000", 10);

// Per-route timeout map. Ollama (port 11434) needs the full 120s for LLM
// generations; everything else gets the faster timeout.
function resolveTimeoutMs(backendUrl) {
  if (backendUrl.includes(":11434")) return RELAY_BACKEND_TIMEOUT_MS;
  return RELAY_FAST_TIMEOUT_MS;
}

// Path-prefix → backend URL. Longest-prefix wins. Strip the prefix before
// forwarding (so `/__ollama/api/tags` → `http://localhost:11434/api/tags`).
// Override via RELAY_ROUTES env: JSON object of prefix → URL.
const DEFAULT_ROUTES = {
  "/__ollama": "http://localhost:11434",
  "/__oc":     "http://localhost:4100",
  "/__ocg":    "http://localhost:18789",
};
let ROUTES = DEFAULT_ROUTES;
if (process.env.RELAY_ROUTES) {
  try { ROUTES = { ...DEFAULT_ROUTES, ...JSON.parse(process.env.RELAY_ROUTES) }; }
  catch (e) { console.error("RELAY_ROUTES parse err — using defaults:", e.message); }
}
const ROUTE_PREFIXES = Object.keys(ROUTES).sort((a, b) => b.length - a.length);

function resolveBackend(reqUrl) {
  for (const prefix of ROUTE_PREFIXES) {
    if (reqUrl === prefix || reqUrl.startsWith(prefix + "/") || reqUrl.startsWith(prefix + "?")) {
      const stripped = reqUrl.slice(prefix.length) || "/";
      return { backend: ROUTES[prefix], path: stripped, matched: prefix };
    }
  }
  return { backend: BACKEND, path: reqUrl, matched: null };
}

if (!SERVER || !TOKEN) {
  console.error("FATAL: RELAY_SERVER and RELAY_TOKEN env vars required");
  process.exit(1);
}

// ─── F-1: Token transmitted via WebSocket subprotocol, NOT URL query string ──
// Passing the token in the URL query string exposes it in:
//   • process-list (`ps aux`, pm2 logs with wsUrl)
//   • TLS termination proxy access logs
//   • Railway request logs
//
// Instead, pass TOKEN as the first element of the WebSocket subprotocols array.
// The relay SERVER must accept it via:
//   req.headers["sec-websocket-protocol"]   (primary — this client)
//   ?token=... query string                 (fallback — for transition; server-side only)
//
// COORDINATION REQUIREMENT (not this file): railway-relay/server.js must be
// updated to read the token from req.headers["sec-websocket-protocol"] as
// primary and the URL ?token= param as a transition fallback. Both must be
// compared with a constant-time comparison (crypto.timingSafeEqual).
//
// Client side: we connect to SERVER (no token in URL) and pass TOKEN only in
// the subprotocol header. Never log TOKEN or the full connection URL with token.

let backoffMs = 1000;

function connect() {
  // F-7: Close any existing open connection before opening a new one (singleton).
  if (currentWs && currentWs.readyState === WebSocket.OPEN) {
    console.warn(`[${new Date().toISOString()}] singleton: closing superseded connection`);
    currentWs.close(4001, "superseded");
  }

  const connectUrl = new URL(SERVER);
  connectUrl.searchParams.set("token", TOKEN);

  // Log SERVER only — never log TOKEN or a URL that contains it.
  console.log(`[${new Date().toISOString()}] connecting to ${SERVER}`);

  // The live Railway relay currently authenticates via `?token=...`.
  // Keep the token out of logs, but include it in the upgrade URL.
  const ws = new WebSocket(connectUrl.toString(), { perMessageDeflate: false });
  currentWs = ws;

  ws.on("open", () => {
    console.log(`[${new Date().toISOString()}] connected`);
    backoffMs = 1000;
  });

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    if (msg.type !== "request") return;
    proxyRequest(ws, msg);
  });

  ws.on("close", (code, reason) => {
    // F-7: Code 4001 = this connection was superseded by a newer call to connect().
    // Do NOT schedule a reconnect — the newer connection owns the session.
    if (code === 4001) {
      console.warn(`[${new Date().toISOString()}] connection superseded (code=4001) — no reconnect`);
      return;
    }
    console.log(`[${new Date().toISOString()}] disconnected code=${code} reason=${reason}; reconnecting in ${backoffMs}ms`);
    setTimeout(connect, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 30000);
  });

  ws.on("error", (e) => {
    console.error(`[${new Date().toISOString()}] ws error: ${e.message}`);
  });

  ws.on("ping", () => { try { ws.pong(); } catch (_) {} });
}

function proxyRequest(ws, msg) {
  const resolved = resolveBackend(msg.url);
  const target = new URL(resolved.path, resolved.backend);
  const headers = { ...(msg.headers || {}) };
  // Rewrite host header so each local backend sees its own hostname
  delete headers.host;
  delete headers["x-forwarded-host"];

  const opts = {
    method: msg.method,
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path: target.pathname + target.search,
    headers,
  };

  const req = http.request(opts, (res) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => {
      const body = chunks.length ? Buffer.concat(chunks).toString("base64") : null;
      sendResponse(ws, msg.id, res.statusCode, res.headers, body);
    });
  });

  // Pass 6 / Track C F-7: per-request timeout. setTimeout() arms the
  // socket timer; the callback fires once after the configured idle period
  // and we destroy the request so the WS frame is freed and the relay
  // doesn't hold the slot forever waiting on a dead backend.
  const timeoutMs = resolveTimeoutMs(resolved.backend);
  req.setTimeout(timeoutMs, () => {
    req.destroy(new Error(`relay backend timeout after ${timeoutMs}ms (${resolved.backend})`));
  });

  req.on("error", (e) => {
    sendResponse(ws, msg.id, 502, { "content-type": "text/plain" }, Buffer.from(`tower backend error: ${e.message}`).toString("base64"));
  });

  if (msg.body) {
    try { req.write(Buffer.from(msg.body, "base64")); } catch (e) { /* ignore */ }
  }
  req.end();
}

function sendResponse(ws, id, status, headers, body) {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ type: "response", id, status, headers, body }));
  } catch (e) {
    console.error("send response err:", e.message);
  }
}

connect();
process.on("SIGINT", () => { process.exit(0); });
process.on("SIGTERM", () => { process.exit(0); });
