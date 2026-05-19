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

const SERVER = process.env.RELAY_SERVER;
const TOKEN = process.env.RELAY_TOKEN;
const BACKEND = process.env.RELAY_BACKEND || "http://localhost:4000";

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

const wsUrl = `${SERVER}?token=${encodeURIComponent(TOKEN)}`;
let backoffMs = 1000;

function connect() {
  console.log(`[${new Date().toISOString()}] connecting to ${SERVER}`);
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false });

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
