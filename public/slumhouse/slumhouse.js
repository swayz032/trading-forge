// Slumhouse shared client helpers.
// Auth: redirects to /login.html on 401, /not-mapped.html on 403.
// el() is a tiny createElement shorthand.

async function fetchJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) { window.location.href = "/slumhouse/login.html"; return null; }
  if (res.status === 403) { window.location.href = "/slumhouse/not-mapped.html"; return null; }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("slumhouse fetch failed", res.status, txt);
    return null;
  }
  return res.json();
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return node;
}

window.SH = { fetchJSON, el };
