/**
 * The Office — RISK TRUTH card (Layer-4 Office P0, 2026-07-02).
 *
 * Compact always-visible card fed by GET /api/production/status (poll ~10s,
 * same cadence family as the SPA ProductionStatusPanel). Renders:
 *   - pipeline / trading state (plain English)
 *   - daily-loss buffer remaining ($ and %) + firm-limit headroom
 *   - 9-layer kill-switch summary (n clear / any tripped → red)
 *   - reconciliation age ("books last verified clean Xh ago")
 *
 * TRUTH RULES:
 *   - EVERY render carries "as of Xs ago" staleness from the last SUCCESSFUL poll.
 *   - If a poll fails or data is older than 30s the card visibly degrades:
 *     grey + "TOWER DATA STALE — showing last known" banner. NEVER a silent
 *     frozen-green card.
 *
 * No build step, no framework — plain script loaded by office.html. Activates
 * on the `office:unlocked` document event, sleeps on `office:locked`.
 */
(function () {
  var POLL_MS = (window.__OFFICE_RISK_POLL_MS | 0) || 10000;   // fetch cadence (test override)
  var TICK_MS = 1000;                                          // "as of Xs ago" label refresh
  var STALE_MS = (window.__OFFICE_RISK_STALE_MS | 0) || 30000; // older ⇒ degraded (test override)

  var root = document.getElementById('of-risk');
  if (!root) return;

  // ── styles (self-injected so office.html stays small) ─────────────────────
  var css = '' +
    '#of-risk { max-width: 1020px; margin: 18px auto 8px; padding: 0 16px; }' +
    '.ofr-card { position: relative; border-radius: 16px; padding: 18px 20px 14px;' +
    '  background: rgba(8, 10, 8, 0.55); backdrop-filter: blur(20px) saturate(1.15);' +
    '  -webkit-backdrop-filter: blur(20px) saturate(1.15);' +
    '  border: 1px solid rgba(255,255,255,0.10);' +
    '  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 60px rgba(0,0,0,0.55), 0 0 50px rgba(163,255,18,0.05); }' +
    '.ofr-card.stale { filter: grayscale(0.9); border-color: rgba(255,255,255,0.16); }' +
    '.ofr-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }' +
    '.ofr-title { font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--dim, #8a938a); }' +
    '.ofr-asof { font-family: var(--num-font, monospace); font-size: 11px; color: var(--mute, #6b746b); }' +
    '.ofr-asof.bad { color: var(--red, #ff6363); }' +
    '.ofr-banner { display: none; margin: -4px 0 10px; padding: 8px 12px; border-radius: 10px;' +
    '  font-size: 12px; font-weight: 700; letter-spacing: 0.08em;' +
    '  color: #ffd9a0; background: rgba(120,80,0,0.25); border: 1px solid rgba(255,190,90,0.4); }' +
    '.ofr-card.stale .ofr-banner { display: block; }' +
    '.ofr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }' +
    '.ofr-item { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.03);' +
    '  border: 1px solid rgba(255,255,255,0.06); min-height: 64px; }' +
    '.ofr-k { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mute, #6b746b); margin-bottom: 5px; }' +
    '.ofr-v { font-size: 15px; font-weight: 700; color: var(--ink, #eef3ee); line-height: 1.3; }' +
    '.ofr-v.good { color: var(--lime, #a3ff12); }' +
    '.ofr-v.warn { color: #f0b429; }' +
    '.ofr-v.bad  { color: var(--red, #ff6363); }' +
    '.ofr-sub { margin-top: 3px; font-size: 11px; color: var(--dim, #8a938a); line-height: 1.35; }' +
    '@media (max-width: 480px) { #of-risk { padding: 0 12px; margin-top: 10px; } .ofr-grid { grid-template-columns: 1fr 1fr; } }';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  root.innerHTML =
    '<div class="ofr-card stale" id="ofr-card">' +
      '<div class="ofr-head">' +
        '<span class="ofr-title">Risk Truth</span>' +
        '<span class="ofr-asof" id="ofr-asof">waiting for the tower…</span>' +
      '</div>' +
      '<div class="ofr-banner" id="ofr-banner">TOWER DATA STALE — showing last known</div>' +
      '<div class="ofr-grid" id="ofr-grid"></div>' +
    '</div>';

  var cardEl = document.getElementById('ofr-card');
  var asofEl = document.getElementById('ofr-asof');
  var bannerEl = document.getElementById('ofr-banner');
  var gridEl = document.getElementById('ofr-grid');

  var lastData = null;      // last successful /api/production/status payload
  var lastOkTs = 0;         // ms epoch of last successful poll
  var pollTimer = null;
  var tickTimer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sevClass(sev) {
    return sev === 'green' ? 'good' : sev === 'yellow' ? 'warn' : sev === 'red' ? 'bad' : '';
  }
  function money(n) {
    if (n == null || !isFinite(n)) return null;
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  // DS19 (H-office-label): map the wire dllModel to plain-English copy so this card
  // names the ACTUAL loss-limit model instead of hardcoding "Trailing-DD". The value
  // shown here is the DAILY firm loss limit — Topstep = EOD trailing DD; MFFU = fixed
  // daily loss limit; unknown firm = conservative estimate. Mirrors the SPA
  // ProductionStatusPanel dllModelLabel() so an MFFU daily-DLL account isn't mislabeled.
  function dllModelLabel(m) {
    switch (m) {
      case 'trailing_dd_hwm': return 'trailing DD';
      case 'daily_dll_pct':   return 'daily loss limit';
      case 'estimate_5pct':   return 'est. loss limit';
      default:                return 'loss limit';
    }
  }

  function item(label, value, cls, sub) {
    return '<div class="ofr-item"><div class="ofr-k">' + esc(label) + '</div>' +
      '<div class="ofr-v ' + (cls || '') + '">' + esc(value) + '</div>' +
      (sub ? '<div class="ofr-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function renderData() {
    if (!lastData) {
      gridEl.innerHTML = item('Tower', 'No data yet', 'warn',
        'The Office has not heard from the tower since this page opened.');
      return;
    }
    var d = lastData;
    var six = d.sixQuestions || {};
    var html = '';

    // 1. Trading / pipeline mode
    var awt = six.areWeTrading || {};
    html += item(
      'Is the bot allowed to trade?',
      awt.halted ? 'No — stopped' : 'Yes',
      sevClass(awt.severity),
      (awt.answer || '') + (awt.reason ? ' · ' + awt.reason : '')
    );

    // 2. Daily loss buffer ($ and %)
    var dd = six.drawdownDistance || {};
    if (dd.bufferRemaining != null && dd.usedPct != null) {
      var leftPct = Math.max(0, Math.round((1 - dd.usedPct) * 100));
      html += item(
        'Loss room left today',
        money(dd.bufferRemaining) + ' (' + leftPct + '% left)',
        sevClass(dd.severity),
        Math.round(dd.usedPct * 100) + '% of today’s loss limit already used'
      );
    } else {
      html += item('Loss room left today', 'No live session', sevClass(dd.severity),
        'Nothing is at risk right now — no active trading session reported.');
    }

    // 3. Firm loss-limit headroom (DS19 H-office-label: dll-model-aware — this value is
    // the DAILY firm loss limit, so name the actual model instead of hardcoding "Trailing-DD")
    var modelLabel = dllModelLabel(dd.dllModel);
    if (dd.firmLimit != null) {
      html += item(
        modelLabel.charAt(0).toUpperCase() + modelLabel.slice(1) + ' headroom',
        (dd.bufferRemaining != null ? money(dd.bufferRemaining) : '—') + ' of ' + money(dd.firmLimit),
        sevClass(dd.severity),
        'Room left before today’s ' + modelLabel + ' is hit'
      );
    } else {
      html += item(
        modelLabel.charAt(0).toUpperCase() + modelLabel.slice(1) + ' headroom',
        'Unknown', 'warn',
        'The tower did not report a firm loss limit — treat as no headroom.'
      );
    }

    // 4. Kill switches (9-layer)
    var ks = six.killSwitchLayers || {};
    var layers = Array.isArray(ks.layers) ? ks.layers : [];
    var tripped = layers.filter(function (l) { return l && l.halted; });
    if (layers.length === 0) {
      html += item('Safety switches', 'Unknown', 'warn', 'Kill-switch report missing from the tower.');
    } else if (tripped.length > 0) {
      html += item(
        'Safety switches',
        tripped.length + ' TRIPPED',
        'bad',
        'Tripped: ' + tripped.map(function (l) { return l.name; }).join(', ')
      );
    } else {
      html += item('Safety switches', layers.length + ' of ' + layers.length + ' clear', 'good',
        'Every safety layer is armed and none has fired.');
    }

    // 5. Reconciliation age
    var rec = six.lastCleanReconciliation || {};
    if (rec.ageHours != null) {
      html += item(
        'Books verified clean',
        Math.round(rec.ageHours) + 'h ago',
        sevClass(rec.severity),
        'Last day the trade records matched the broker exactly: ' + (rec.lastCleanDate || 'unknown')
      );
    } else {
      html += item('Books verified clean', 'Never', 'bad',
        'No clean reconciliation on record — trade books are unverified.');
    }

    // 6. Overall + production mode
    html += item(
      'Overall',
      d.overall === 'green' ? 'All good' : d.overall === 'yellow' ? 'Needs a look' : 'Problem',
      sevClass(d.overall),
      'Tower mode: ' + (d.productionMode || 'unknown')
    );

    gridEl.innerHTML = html;
  }

  function tick() {
    var now = Date.now();
    if (!lastOkTs) {
      cardEl.classList.add('stale');
      asofEl.className = 'ofr-asof bad';
      asofEl.textContent = 'no data from the tower yet';
      bannerEl.textContent = 'NO TOWER DATA YET — nothing to show';
      return;
    }
    var age = now - lastOkTs;
    var secs = Math.round(age / 1000);
    asofEl.textContent = 'as of ' + secs + 's ago';
    if (age > STALE_MS) {
      cardEl.classList.add('stale');
      asofEl.className = 'ofr-asof bad';
      bannerEl.textContent = 'TOWER DATA STALE — showing last known (' + secs + 's old)';
    } else {
      cardEl.classList.remove('stale');
      asofEl.className = 'ofr-asof';
    }
  }

  function poll() {
    fetch('/api/production/status', { credentials: 'same-origin' })
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
