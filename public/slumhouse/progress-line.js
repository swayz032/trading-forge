// Slumhouse strategy progress line — renders a Gate[] into a container.
// Gate = { key, label, sub, status: "pass"|"now"|"fail"|"wait" }
// Usage: renderProgressLine(el, gates, { dead: true, legend: true })
(function () {
  var ICON = { pass: "✓", now: "▸", fail: "✗", wait: "·" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function orb(g) {
    var halo = g.status === "now" ? '<div class="pl-halo"></div>' : "";
    return '<div class="pl-node pl-' + g.status + '"><div class="pl-shadow"></div>' + halo +
      '<div class="pl-orb"><div class="pl-bezel"></div><div class="pl-body">' + (ICON[g.status] || "·") + '</div><div class="pl-reflect"></div></div>' +
      '<div class="pl-lbl"><b>' + esc(g.label) + '</b><span>' + esc(g.sub) + '</span></div></div>';
  }
  function pctFor(gates) {
    var lastPass = -1;
    for (var i = 0; i < gates.length; i++) { if (gates[i].status === "pass") lastPass = i; }
    var n = gates.length - 1;
    return n <= 0 ? 0 : Math.round(((lastPass < 0 ? 0 : lastPass) / n) * 100);
  }
  function legendHtml(dead) {
    if (dead) return '<div class="pl-legend"><span class="pl-l-pass"><i></i>cleared</span><span class="pl-l-fail"><i></i>failed here</span><span class="pl-l-wait"><i></i>never reached</span></div>';
    return '<div class="pl-legend"><span class="pl-l-pass"><i></i>cleared</span><span class="pl-l-now"><i></i>cooking now</span><span class="pl-l-wait"><i></i>not yet</span></div>';
  }
  window.renderProgressLine = function (container, gates, opts) {
    if (!container) return;
    gates = Array.isArray(gates) ? gates : [];
    opts = opts || {};
    var dead = !!opts.dead;
    var html = '<div class="pl-stage"><div class="pl-track">' +
      '<div class="pl-rail"></div><div class="pl-fill' + (dead ? " pl-dead" : "") + '" style="width:' + pctFor(gates) + '%"></div>' +
      '<div class="pl-nodes">' + gates.map(orb).join("") + '</div>' +
      '</div></div>';
    if (opts.legend !== false) html += legendHtml(dead);
    container.innerHTML = html;
  };
})();
