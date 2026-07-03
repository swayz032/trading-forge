/**
 * The Office — GO-LIVE APPROVALS (Layer-4 Office P0, 2026-07-02).
 *
 * Lists every strategy sitting at DEPLOY_READY with a plain-English evidence
 * card (verdict pills like "2% chance results are luck"; the raw number rides
 * small beneath each pill). Approve / Reject buttons call the authenticated
 * Office endpoints:
 *   GET  /slumhouse/admin/deploy-approvals
 *   POST /slumhouse/admin/deploy-approvals/:id/approve
 *   POST /slumhouse/admin/deploy-approvals/:id/reject   { reason }
 *
 * Fail-closed: when the server says a strategy's evidence is missing/stale/
 * failing, the Approve button is DISABLED and the blockers are shown in plain
 * English. The server re-checks the same evidence on approve, so a tampered
 * page cannot force a go-live.
 *
 * No build step, no framework — plain script loaded by office.html. Activates
 * on `office:unlocked`, sleeps on `office:locked`.
 */
(function () {
  var REFRESH_MS = 30000;

  var root = document.getElementById('of-approvals');
  if (!root) return;

  var css = '' +
    '#of-approvals { max-width: 1020px; margin: 10px auto 40px; padding: 0 16px; }' +
    '.ofa-title { font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--dim, #8a938a); margin: 14px 4px 10px; }' +
    '.ofa-empty { border-radius: 14px; padding: 16px 18px; font-size: 13px; color: var(--dim, #8a938a);' +
    '  background: rgba(8,10,8,0.45); border: 1px solid rgba(255,255,255,0.07); }' +
    '.ofa-card { border-radius: 16px; padding: 18px 20px; margin-bottom: 14px;' +
    '  background: rgba(8, 10, 8, 0.55); backdrop-filter: blur(20px) saturate(1.15);' +
    '  -webkit-backdrop-filter: blur(20px) saturate(1.15);' +
    '  border: 1px solid rgba(163,255,18,0.18);' +
    '  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 60px rgba(0,0,0,0.55), 0 0 40px rgba(163,255,18,0.05); }' +
    '.ofa-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }' +
    '.ofa-name { font-size: 19px; font-weight: 800; color: var(--ink, #eef3ee); }' +
    '.ofa-meta { font-family: var(--num-font, monospace); font-size: 11px; letter-spacing: 0.1em; color: var(--mute, #6b746b); text-transform: uppercase; }' +
    '.ofa-pills { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin: 14px 0 4px; }' +
    '.ofa-pill { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); }' +
    '.ofa-pill.ok   { border-color: rgba(163,255,18,0.35); }' +
    '.ofa-pill.fail { border-color: rgba(255,99,99,0.45); background: rgba(255,80,80,0.06); }' +
    '.ofa-pill.miss { border-color: rgba(255,190,90,0.35); background: rgba(120,80,0,0.08); }' +
    '.ofa-pill-h { font-size: 13px; font-weight: 700; line-height: 1.35; color: var(--ink, #eef3ee); }' +
    '.ofa-pill.ok .ofa-pill-h   { color: var(--lime, #a3ff12); }' +
    '.ofa-pill.fail .ofa-pill-h { color: var(--red, #ff6363); }' +
    '.ofa-pill.miss .ofa-pill-h { color: #f0b429; }' +
    '.ofa-pill-d { margin-top: 4px; font-family: var(--num-font, monospace); font-size: 10px; color: var(--mute, #6b746b); }' +
    '.ofa-blockers { margin: 10px 0 0; padding: 10px 14px; border-radius: 12px; font-size: 12.5px; line-height: 1.5;' +
    '  color: #ffd9a0; background: rgba(120,80,0,0.18); border: 1px solid rgba(255,190,90,0.35); }' +
    '.ofa-blockers b { display: block; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 4px; }' +
    '.ofa-actions { display: flex; gap: 12px; margin-top: 14px; flex-wrap: wrap; }' +
    '.ofa-btn { border: none; border-radius: 999px; padding: 11px 22px; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; transition: transform .15s, filter .15s; }' +
    '.ofa-btn:hover { transform: translateY(-1px); filter: brightness(1.08); }' +
    '.ofa-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; filter: none; }' +
    '.ofa-approve { background: var(--lime, #a3ff12); color: #000; }' +
    '.ofa-reject  { background: rgba(255,80,80,0.14); color: #ffb1b1; border: 1px solid rgba(255,99,99,0.4); }' +
    '.ofa-note { margin-top: 8px; font-size: 11px; color: var(--mute, #6b746b); }' +
    '.ofa-msg { margin-top: 10px; font-size: 12px; min-height: 14px; }' +
    '.ofa-msg.err { color: var(--red, #ff6363); }' +
    '.ofa-msg.okc { color: var(--lime, #a3ff12); }' +
    '@media (max-width: 480px) { #of-approvals { padding: 0 12px; } .ofa-pills { grid-template-columns: 1fr; } }';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var timer = null;
  var busy = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pillClass(m) {
    if (m.missing) return 'miss';
    if (m.ok === false) return 'fail';
    if (m.ok === true) return 'ok';
    return '';
  }

  function render(list) {
    var html = '<div class="ofa-title">Go-Live Approvals</div>';
    if (!list || list.length === 0) {
      html += '<div class="ofa-empty">Nothing is waiting for your approval. When a strategy passes every gate and reaches DEPLOY_READY, it shows up here with its evidence.</div>';
      root.innerHTML = html;
      return;
    }
    list.forEach(function (s) {
      var pills = (s.evidence || []).map(function (m) {
        return '<div class="ofa-pill ' + pillClass(m) + '">' +
          '<div class="ofa-pill-h">' + esc(m.headline) + '</div>' +
          '<div class="ofa-pill-d">' + esc(m.detail) + '</div>' +
        '</div>';
      }).join('');
      var blockers = '';
      if (s.blockers && s.blockers.length) {
        blockers = '<div class="ofa-blockers"><b>Why Approve is locked</b>' +
          s.blockers.map(function (b) { return '&#8226; ' + esc(b); }).join('<br>') + '</div>';
      }
      var age = (s.backtestAgeDays != null) ? ('evidence ' + s.backtestAgeDays + 'd old') : 'no backtest on file';
      html +=
        '<div class="ofa-card" data-sid="' + esc(s.id) + '">' +
          '<div class="ofa-head">' +
            '<span class="ofa-name">' + esc(s.name) + '</span>' +
            '<span class="ofa-meta">' + esc(s.symbol) + ' &#183; ' + esc(s.timeframe) + ' &#183; ' + esc(age) + '</span>' +
          '</div>' +
          '<div class="ofa-pills">' + pills + '</div>' +
          blockers +
          '<div class="ofa-actions">' +
            '<button class="ofa-btn ofa-approve" data-approve' + (s.approvable ? '' : ' disabled') + '>Approve &#8212; go live</button>' +
            '<button class="ofa-btn ofa-reject" data-reject>Reject &#8212; back to paper</button>' +
          '</div>' +
          '<div class="ofa-note">Approving is the final human step. Every automated gate has already run &#8212; and runs again on the server when you press this.</div>' +
          '<div class="ofa-msg" data-msg></div>' +
        '</div>';
    });
    root.innerHTML = html;

    Array.prototype.forEach.call(root.querySelectorAll('.ofa-card'), function (card) {
      var sid = card.getAttribute('data-sid');
      var name = card.querySelector('.ofa-name').textContent;
      var msg = card.querySelector('[data-msg]');
      var approveBtn = card.querySelector('[data-approve]');
      var rejectBtn = card.querySelector('[data-reject]');

      function setMsg(text, cls) {
        msg.textContent = text || '';
        msg.className = 'ofa-msg' + (cls ? ' ' + cls : '');
      }
      function post(url, body, okText) {
        if (busy) return;
        busy = true;
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        setMsg('Working…', '');
        fetch(url, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body || {})
        })
          .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
          .then(function (res) {
            busy = false;
            if (res.status === 200 && res.body && res.body.ok) {
              setMsg(okText, 'okc');
              setTimeout(load, 900);
              return;
            }
            if (res.status === 401) { window.location.reload(); return; }
            var b = res.body || {};
            var detail = b.blockers ? b.blockers.join(' ') : (b.error || 'failed');
            setMsg('Refused: ' + detail, 'err');
            rejectBtn.disabled = false;
            approveBtn.disabled = !cardApprovable();
          })
          .catch(function () {
            busy = false;
            setMsg('Network error — nothing changed. Try again.', 'err');
            rejectBtn.disabled = false;
            approveBtn.disabled = !cardApprovable();
          });
      }
      function cardApprovable() {
        return approveBtn.getAttribute('data-was-approvable') === '1';
      }
      approveBtn.setAttribute('data-was-approvable', approveBtn.disabled ? '0' : '1');

      approveBtn.addEventListener('click', function () {
        if (!window.confirm('Put "' + name + '" LIVE?\n\nThis is the real go-live switch. The evidence above was checked by the system and will be re-checked on the server before anything happens.')) return;
        post('/slumhouse/admin/deploy-approvals/' + encodeURIComponent(sid) + '/approve', {}, 'Approved — strategy is DEPLOYED.');
      });
      rejectBtn.addEventListener('click', function () {
        var reason = window.prompt('Send "' + name + '" back to paper trading.\n\nWhy? (a few words is fine — this is written to the audit log)');
        if (reason == null) return;
        reason = reason.trim();
        if (reason.length < 3) { setMsg('Give a short reason so the audit log makes sense later.', 'err'); return; }
        post('/slumhouse/admin/deploy-approvals/' + encodeURIComponent(sid) + '/reject', { reason: reason }, 'Sent back to paper.');
      });
    });
  }

  function load() {
    fetch('/slumhouse/admin/deploy-approvals', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) { throw new Error('locked'); }
        return r.json();
      })
      .then(function (d) { render((d && d.strategies) || []); })
      .catch(function () {
        root.innerHTML = '<div class="ofa-title">Go-Live Approvals</div>' +
          '<div class="ofa-empty">Couldn&#39;t load the approval list — will retry shortly.</div>';
      });
  }

  function start() {
    root.classList.remove('of-hide');
    load();
    if (!timer) timer = setInterval(load, REFRESH_MS);
  }
  function stop() {
    root.classList.add('of-hide');
    if (timer) { clearInterval(timer); timer = null; }
  }

  document.addEventListener('office:unlocked', start);
  document.addEventListener('office:locked', stop);
})();
