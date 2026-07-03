/**
 * The Office — CONVEYOR card (deep-scan #13, 2026-07-03).
 *
 * Closes the #1 CRITICAL from the frontend deep-scan: The Office had the Bot
 * Power switch that GATES the strategy-finding conveyor, but NO view of what
 * that switch controls. Control without visibility. This card is that view.
 *
 * Fed by GET /api/scout/health (poll ~15s, same-origin — the Office admin
 * cookie satisfies the /api auth middleware). Renders, in plain English:
 *   - conveyor / pipeline mode (running / paused / unknown)
 *   - new strategies produced today
 *   - when the last strategy was found (age)
 *   - where they came from over 7 days (web / youtube / reddit) — the n8n
 *     strategy-finding layer output
 *   - auditor rejects in the last 24h
 *   - any recent conveyor alerts (drain stall, reject skew, none-today)
 *
 * TRUTH RULES (same contract as office-risk.js):
 *   - EVERY render carries "as of Xs ago" from the last SUCCESSFUL poll.
 *   - A failed poll or data older than STALE_MS visibly degrades the card
 *     (grey + banner). NEVER a silent frozen-green card.
 *
 * No build step, no framework — plain script loaded by office.html. Wakes on
 * the `office:unlocked` document event, sleeps on `office:locked`.
 */
(function () {
  var POLL_MS = (window.__OFFICE_CONVEYOR_POLL_MS | 0) || 15000;
  var TICK_MS = 1000;
  var STALE_MS = (window.__OFFICE_CONVEYOR_STALE_MS | 0) || 45000;

  var root = document.getElementById('of-conveyor');
  if (!root) return;

  var css = '' +
    '#of-conveyor { max-width: 1020px; margin: 8px auto 8px; padding: 0 16px; }' +
    '.ofc-card { position: relative; border-radius: 16px; padding: 18px 20px 14px;' +
    '  background: rgba(8, 10, 8, 0.55); backdrop-filter: blur(20px) saturate(1.15);' +
    '  -webkit-backdrop-filter: blur(20px) saturate(1.15);' +
    '  border: 1px solid rgba(255,255,255,0.10);' +
    '  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 60px rgba(0,0,0,0.55), 0 0 50px rgba(163,255,18,0.05); }' +
    '.ofc-card.stale { filter: grayscale(0.9); border-color: rgba(255,255,255,0.16); }' +
    '.ofc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }' +
    '.ofc-title { font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--dim, #8a938a); }' +
    '.ofc-asof { font-family: var(--num-font, monospace); font-size: 11px; color: var(--mute, #6b746b); }' +
    '.ofc-asof.bad { color: var(--red, #ff6363); }' +
    '.ofc-banner { display: none; margin: -4px 0 10px; padding: 8px 12px; border-radius: 10px;' +
    '  font-size: 12px; font-weight: 700; letter-spacing: 0.08em;' +
    '  color: #ffd9a0; background: rgba(120,80,0,0.25); border: 1px solid rgba(255,190,90,0.4); }' +
    '.ofc-card.stale .ofc-banner { display: block; }' +
    '.ofc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }' +
    '.ofc-item { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.03);' +
    '  border: 1px solid rgba(255,255,255,0.06); min-height: 64px; }' +
    '.ofc-k { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mute, #6b746b); margin-bottom: 5px; }' +
    '.ofc-v { font-size: 15px; font-weight: 700; color: var(--ink, #eef3ee); line-height: 1.3; }' +
    '.ofc-v.good { color: var(--lime, #a3ff12); }' +
    '.ofc-v.warn { color: #f0b429; }' +
    '.ofc-v.bad  { color: var(--red, #ff6363); }' +
    '.ofc-sub { margin-top: 3px; font-size: 11px; color: var(--dim, #8a938a); line-height: 1.35; }' +
    '@media (max-width: 480px) { #of-conveyor { padding: 0 12px; } .ofc-grid { grid-template-columns: 1fr 1fr; } }';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  root.innerHTML =
    '<div class="ofc-card stale" id="ofc-card">' +
      '<div class="ofc-head">' +
        '<span class="ofc-title">Conveyor</span>' +
        '<span class="ofc-asof" id="ofc-asof">waiting for the tower…</span>' +
      '</div>' +
      '<div class="ofc-banner" id="ofc-banner">TOWER DATA STALE — showing last known</div>' +
      '<div class="ofc-grid" id="ofc-grid"></div>' +
    '</div>';

  var cardEl = document.getElementById('ofc-card');
  var asofEl = document.getElementById('ofc-asof');
  var bannerEl = document.getElementById('ofc-banner');
  var gridEl = document.getElementById('ofc-grid');

  var lastData = null;
  var lastOkTs = 0;
  var pollTimer = null;
  var tickTimer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function item(label, value, cls, sub) {
    return '<div class="ofc-item"><div class="ofc-k">' + esc(label) + '</div>' +
      '<div class="ofc-v ' + (cls || '') + '">' + esc(value) + '</div>' +
      (sub ? '<div class="ofc-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }
  function ageText(iso) {
    if (!iso) return null;
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    var mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.round(hrs / 24) + 'd ago';
  }

  function renderData() {
    if (!lastData) {
      gridEl.innerHTML = item('Tower', 'No data yet', 'warn',
        'The Office has not heard from the tower since this page opened.');
      return;
    }
    var d = lastData;
    var html = '';

    // 1. Conveyor / pipeline mode
    var mode = String(d.pipelineMode || 'UNKNOWN').toUpperCase();
    var modeCls = mode === 'ACTIVE' ? 'good' : mode === 'UNKNOWN' ? 'warn' : 'warn';
    var modeVal = mode === 'ACTIVE' ? 'Running' : mode === 'UNKNOWN' ? 'Unknown' : (mode.charAt(0) + mode.slice(1).toLowerCase());
    html += item('Is the conveyor running?', modeVal, modeCls,
      mode === 'ACTIVE' ? 'Bot Power is on — the strategy-finder is scouting.'
        : mode === 'UNKNOWN' ? 'Tower did not report a pipeline mode — treat as stalled.'
        : 'Bot Power is off / paused — no new strategies are being found.');

    // 2. New strategies today
    var today = Number(d.strategiesProducedToday || 0);
    html += item('New strategies today', String(today), today > 0 ? 'good' : 'warn',
      today > 0 ? 'Reached the CANDIDATE stage today.'
        : 'Nothing new today yet — normal early in the day, worth a look if the conveyor is running and it is late.');

    // 3. Last strategy found
    var lastAge = ageText(d.lastStrategyCreatedAt);
    html += item('Last strategy found', lastAge || 'Never', lastAge ? '' : 'bad',
      lastAge ? 'Most recent strategy to enter the library.'
        : 'No strategy on record — the conveyor has never produced one.');

    // 4. Where they came from (7d) — the n8n strategy-finding layer output
    var src = d.scoutsBySourceLast7d || {};
    var srcKeys = Object.keys(src);
    if (srcKeys.length > 0) {
      var srcStr = srcKeys.map(function (k) { return k + ' ' + Number(src[k] || 0); }).join(' · ');
      var srcTotal = srcKeys.reduce(function (a, k) { return a + Number(src[k] || 0); }, 0);
      html += item('Scouted (7 days)', String(srcTotal), srcTotal > 0 ? 'good' : 'warn', srcStr);
    } else {
      html += item('Scouted (7 days)', '0', 'warn',
        'No web / youtube / reddit scouts logged in the last 7 days.');
    }

    // 5. Auditor rejects (24h)
    var rej = Number(d.auditorRejectsLast24h || 0);
    html += item('Rejected by auditor (24h)', String(rej), '',
      'Extractions the gate refused in the last day — some rejection is healthy.');

    // 6. Recent alerts (drain stall / reject skew / none-today)
    var alerts = Array.isArray(d.recentAlerts) ? d.recentAlerts : [];
    if (alerts.length > 0) {
      var kinds = alerts.map(function (a) { return String(a.action || '').replace(/^alert\./, ''); });
      html += item('Conveyor alerts (24h)', alerts.length + ' active', 'bad', kinds.join(', '));
    } else {
      html += item('Conveyor alerts (24h)', 'None', 'good', 'No stalls or reject-skew alerts in the last day.');
    }

    gridEl.innerHTML = html;
  }

  function tick() {
    var now = Date.now();
    if (!lastOkTs) {
      cardEl.classList.add('stale');
      asofEl.className = 'ofc-asof bad';
      asofEl.textContent = 'no data from the tower yet';
      bannerEl.textContent = 'NO TOWER DATA YET — nothing to show';
      return;
    }
    var age = now - lastOkTs;
    var secs = Math.round(age / 1000);
    asofEl.textContent = 'as of ' + secs + 's ago';
    if (age > STALE_MS) {
      cardEl.classList.add('stale');
      asofEl.className = 'ofc-asof bad';
      bannerEl.textContent = 'TOWER DATA STALE — showing last known (' + secs + 's old)';
    } else {
      cardEl.classList.remove('stale');
      asofEl.className = 'ofc-asof';
    }
  }

  function poll() {
    fetch('/api/scout/health', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) {
        lastData = d;
        lastOkTs = Date.now();
        renderData();
        tick();
      })
      .catch(function () {
        // keep last-known data; tick() degrades the card as it ages
        tick();
      });
  }

  function start() {
    root.classList.remove('of-hide');
    if (!pollTimer) { poll(); pollTimer = setInterval(poll, POLL_MS); }
    if (!tickTimer) { tickTimer = setInterval(tick, TICK_MS); }
  }
  function stop() {
    root.classList.add('of-hide');
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  document.addEventListener('office:unlocked', start);
  document.addEventListener('office:locked', stop);
})();
