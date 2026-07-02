// Trading Forge HTTP-over-WebSocket reverse tunnel SERVER (runs on Railway).
//
// Architecture:
//   external HTTP →  Railway HTTPS proxy  →  this server (PORT)
//   tower client  ⇄  this server (WS on /__relay?token=...)
//
// External requests are wrapped as JSON frames, sent over WS to tower, tower
// proxies to localhost:4000, response framed back. Single Railway port. No
// TCP Proxy beta needed. Auth via shared token (RELAY_TOKEN env).

const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.RELAY_TOKEN;
if (!TOKEN) { console.error("FATAL: RELAY_TOKEN env var required"); process.exit(1); }

const REQUEST_TIMEOUT_MS = Number(process.env.RELAY_REQUEST_TIMEOUT_MS || 90000);
const MAX_BODY_BYTES = Number(process.env.RELAY_MAX_BODY_BYTES || 50 * 1024 * 1024); // 50 MB

// Deep-scan #6 S1 (2026-07-01): the /__ollama prefix forwards straight to the tower's
// Ollama (localhost:11434) which has NO auth of its own. Before this, ANY internet caller
// could hit /__ollama/api/* — inference (compute theft) AND destructive model management
// (/api/pull, /api/delete, ...) which can wedge the extraction pipeline. Two-layer fix:
//   (1) UNCONDITIONALLY block destructive Ollama management endpoints (never used by the
//       legitimate inference callers — n8n chat + backend). Closes the wedge/delete vector
//       with zero risk to inference. No config required.
//   (2) OPTIONAL bearer gate on the whole /__ollama (+ /__oc sidecar) prefix via
//       OLLAMA_PROXY_TOKEN. When set, callers must send X-Relay-Proxy-Token; when unset,
//       inference stays open (back-compat) but a one-time warning is logged. Set the env +
//       add the header to the n8n Ollama HTTP nodes to fully lock inference down too.
const OLLAMA_PROXY_TOKEN = process.env.OLLAMA_PROXY_TOKEN || null;
// Ollama write/management endpoints — never needed by inference; always refused via the relay.
const OLLAMA_BLOCKED_RE = /^\/__ollama\/(api\/(pull|push|create|copy|delete|blobs)\b|v1\/(models\/.*\/delete))/i;
const PROXY_GATED_PREFIX_RE = /^\/(__ollama|__oc)\b/i;
let _ollamaTokenWarned = false;

function guardSensitiveProxy(req, res) {
  const url = req.url || "";
  if (OLLAMA_BLOCKED_RE.test(url)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "ollama_management_endpoint_blocked" }));
    console.warn("BLOCKED destructive ollama proxy call:", req.method, url.split("?")[0]);
    return true; // handled (blocked)
  }
  if (PROXY_GATED_PREFIX_RE.test(url)) {
    if (OLLAMA_PROXY_TOKEN) {
      const presented = req.headers["x-relay-proxy-token"];
      if (presented !== OLLAMA_PROXY_TOKEN) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "proxy_token_required" }));
        return true; // handled (rejected)
      }
    } else if (!_ollamaTokenWarned) {
      _ollamaTokenWarned = true;
      console.warn("SECURITY: OLLAMA_PROXY_TOKEN unset — /__ollama inference is open (management endpoints still blocked). Set the env + n8n header to lock down.");
    }
  }
  return false; // not handled — continue normal forwarding
}

let tower = null;          // current WS connection from tower (singleton)
const pending = new Map(); // requestId -> { res, timer }

function sendFrame(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (e) { console.error("send err:", e.message); }
}

const server = http.createServer((req, res) => {
  // Health endpoint (does not require tower)
  if (req.url === "/__relay/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, tower: !!tower, pending: pending.size }));
  }

  // S1: refuse destructive Ollama proxy calls + enforce optional proxy token (before tower check).
  if (guardSensitiveProxy(req, res)) return;

  if (!tower || tower.readyState !== 1) {
    res.writeHead(503, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "tower_offline" }));
  }

  const chunks = [];
  let total = 0;
  let overflow = false;
  req.on("data", (c) => {
    total += c.length;
    if (total > MAX_BODY_BYTES) { overflow = true; req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (overflow) { res.writeHead(413).end("body too large"); return; }
    const id = crypto.randomBytes(8).toString("hex");
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        try { res.writeHead(504, { "content-type": "text/plain" }); res.end("relay timeout"); } catch (_) {}
      }
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { res, timer });
    sendFrame(tower, {
      type: "request", id,
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: chunks.length ? Buffer.concat(chunks).toString("base64") : null,
    });
  });
  req.on("error", (e) => { console.error("inbound err:", e.message); });
});

// Accept whatever subprotocol the client offered so the client-side `ws`
// library does not reject the handshake. Auth is enforced separately in the
// upgrade handler below; this callback only echoes the negotiated protocol.
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols /* Set<string> */) => {
    for (const p of protocols) return p;
    return false;
  },
});

server.on("upgrade", (req, socket, head) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname !== "/__relay") { socket.destroy(); return; }
  // F-1: token transmitted via Sec-WebSocket-Protocol (primary) — keeps it
  // out of URLs / access logs. ?token= remains as transition fallback.
  const subprotocolHeader = req.headers["sec-websocket-protocol"];
  const subprotocolToken = subprotocolHeader
    ? String(subprotocolHeader).split(",")[0].trim()
    : null;
  const queryToken = u.searchParams.get("token");
  const presented = subprotocolToken || queryToken;
  if (presented !== TOKEN) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws) => {
  if (tower) { console.warn("replacing existing tower connection"); try { tower.close(4000, "replaced"); } catch (_) {} }
  tower = ws;
  console.log("tower connected");

  const keepalive = setInterval(() => {
    if (ws.readyState === 1) ws.ping();
  }, 25000);

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    if (msg.type !== "response") return;
    const slot = pending.get(msg.id);
    if (!slot) return;
    clearTimeout(slot.timer);
    pending.delete(msg.id);
    try {
      // Filter hop-by-hop headers
      const hdrs = { ...(msg.headers || {}) };
      ["transfer-encoding", "connection", "keep-alive"].forEach((k) => delete hdrs[k]);
      slot.res.writeHead(msg.status || 502, hdrs);
      slot.res.end(msg.body ? Buffer.from(msg.body, "base64") : undefined);
    } catch (e) { console.error("response write err:", e.message); }
  });

  ws.on("close", () => {
    clearInterval(keepalive);
    if (tower === ws) tower = null;
    console.log("tower disconnected, pending=" + pending.size);
    // Fail all pending requests
    for (const [id, slot] of pending.entries()) {
      clearTimeout(slot.timer);
      try { slot.res.writeHead(502).end("tower disconnected"); } catch (_) {}
    }
    pending.clear();
  });

  ws.on("error", (e) => { console.error("ws err:", e.message); });
});

server.listen(PORT, () => {
  console.log(`relay listening on :${PORT}  (token len=${TOKEN.length})`);
});
