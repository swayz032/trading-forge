/**
 * The Office — PAYOUT REALITY panel (charter item 12, 2026-07-21).
 *
 * Scenario panel over the EXISTING `POST /api/prop-firm/payout` calculator.
 * Zero backend change: every number rendered here is computed server-side and
 * returned in the response. This file defines NO payout rule of its own.
 *
 * WHAT IT SHOWS (all server-computed):
 *   - payoutSplit (the 80/20), eval/buffer months, break-even month
 *   - total payout / costs / profit over the window
 *   - the full `payout_cap_applied` context: per-request cap, pinned
 *     requests-per-month cadence, monthly cap, stage / path / DLL
 *   - the month-by-month projection, marking every CAPPED month
 *   - ★ the projection's own `simplifications[]` — rendered as a visible
 *     "what this does NOT model" block, never dropped (OR-149: a projected
 *     number shown without its own caveats is the caption defect)
 *
 * DECLARED BOUNDARIES (visible in the panel, not just this comment):
 *   - 50K accounts only. `prop-firm.ts:149` pins ACCOUNT_TYPE = "50k" for every
 *     firm; there is no other account size in the config to project.
 *   - This is a SCENARIO calculator: it answers "if I average $X/day", not
 *     "here is what you earned". It reads no live account state.
 *   - The clean no-input version of this panel waits on CL-012 (a cross-lane
 *     5-line surface on GET /firms/:firm/:accountType). Until that lands, the
 *     cap/cadence context is reachable only through this scenario form.
 *
 * TRUTH RULES:
 *   - Nothing renders until a real response arrives. No placeholder numbers.
 *   - A failed request degrades visibly with the server's own error text.
 *   - Input bounds mirror the server's zod schema and are parity-tested
 *     (office-payout-panel-guards.test.ts) so they cannot silently drift.
 *     The server stays authoritative: its 400 detail is surfaced verbatim.
 *
 * No build step, no framework — plain script loaded by office.html. Activates
 * on the `office:unlocked` document event, sleeps on `office:locked`.
 */
(function () {
  var root = document.getElementById('of-payout');
  if (!root) return;

  // Bounds mirrored from payoutSchema in src/server/routes/prop-firm.ts.
  // Parity-guarded by test; server remains authoritative on rejection.
  var NUM_ACCOUNTS_MIN = 1, NUM_ACCOUNTS_MAX = 20;
  var MONTHS_MIN = 1, MONTHS_MAX = 36;

  var css = '' +
    '#of-payout { max-width: 1020px; margin: 18px auto 8px; padding: 0 16px; }' +
    '.ofp-card { position: relative; border-radius: 16px; padding: 18px 20px 14px;' +
    '  background: rgba(8, 10, 8, 0.55); backdrop-filter: blur(20px) saturate(1.15);' +
    '  -webkit-backdrop-filter: blur(20px) saturate(1.15);' +
    '  border: 1px solid rgba(255,255,255,0.10);' +
    '  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 60px rgba(0,0,0,0.55), 0 0 50px rgba(163,255,18,0.05); }' +
    '.ofp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 4px; }' +
    '.ofp-title { font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--dim, #8a938a); }' +
    '.ofp-scope { font-size: 11px; color: var(--mute, #6b746b); }' +
    '.ofp-lede { font-size: 12px; color: var(--dim, #8a938a); line-height: 1.5; margin: 6px 0 12px; }' +
    '.ofp-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 12px; }' +
    '.ofp-f { display: flex; flex-direction: column; gap: 4px; }' +
    '.ofp-l { font-size: 11px; letter-spacing: 0.10em; text-transform: uppercase; color: var(--mute, #6b746b); }' +
    '.ofp-in, .ofp-sel { padding: 8px 10px; border-radius: 10px; font-size: 14px;' +
    '  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10);' +
    '  color: var(--ink, #eef3ee); font-family: inherit; }' +
    '.ofp-check { display: flex; align-items: center; gap: 8px; padding-top: 18px; font-size: 13px; color: var(--ink, #eef3ee); }' +
    '.ofp-run { grid-column: 1 / -1; padding: 10px 16px; border-radius: 10px; cursor: pointer;' +
    '  font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;' +
    '  color: #0b0f0b; background: var(--lime, #a3ff12); border: none; }' +
    '.ofp-run:disabled { opacity: 0.5; cursor: default; }' +
    '.ofp-msg { display: none; margin: 8px 0; padding: 8px 12px; border-radius: 10px; font-size: 12px;' +
    '  color: #ffd9a0; background: rgba(120,80,0,0.25); border: 1px solid rgba(255,190,90,0.4); }' +
    '.ofp-msg.on { display: block; }' +
    '.ofp-out { display: none; }' +
    '.ofp-out.on { display: block; }' +
    '.ofp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 12px; }' +
    '.ofp-item { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.03);' +
    '  border: 1px solid rgba(255,255,255,0.06); }' +
    '.ofp-k { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mute, #6b746b); margin-bottom: 5px; }' +
    '.ofp-v { font-size: 15px; font-weight: 700; color: var(--ink, #eef3ee); line-height: 1.3; }' +
    '.ofp-v.good { color: var(--lime, #a3ff12); }' +
    '.ofp-v.warn { color: #f0b429; }' +
    '.ofp-sub { margin-top: 3px; font-size: 11px; color: var(--dim, #8a938a); line-height: 1.35; }' +
    '.ofp-sec { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--dim, #8a938a);' +
    '  margin: 14px 0 8px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.07); }' +
    '.ofp-tblwrap { overflow-x: auto; }' +
    '.ofp-tbl { width: 100%; border-collapse: collapse; font-size: 12px; }' +
    '.ofp-tbl th { text-align: right; padding: 6px 8px; font-size: 10px; letter-spacing: 0.10em;' +
    '  text-transform: uppercase; color: var(--mute, #6b746b); border-bottom: 1px solid rgba(255,255,255,0.10); white-space: nowrap; }' +
    '.ofp-tbl th:first-child, .ofp-tbl td:first-child { text-align: left; }' +
    '.ofp-tbl td { text-align: right; padding: 6px 8px; color: var(--ink, #eef3ee);' +
    '  font-family: var(--num-font, monospace); border-bottom: 1px solid rgba(255,255,255,0.04); white-space: nowrap; }' +
    '.ofp-tbl tr.capped td { color: #f0b429; }' +
    '.ofp-phase { font-family: inherit; color: var(--dim, #8a938a); }' +
    '.ofp-simp { margin: 0; padding: 10px 12px 10px 28px; border-radius: 12px;' +
    '  background: rgba(120,80,0,0.16); border: 1px solid rgba(255,190,90,0.30); }' +
    '.ofp-simp li { font-size: 12px; color: #ffd9a0; line-height: 1.5; margin: 3px 0; }' +
    '@media (max-width: 480px) { #of-payout { padding: 0 12px; margin-top: 10px; } .ofp-grid { grid-template-columns: 1fr 1fr; } }';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  root.innerHTML =
    '<div class="ofp-card">' +
      '<div class="ofp-head">' +
        '<span class="ofp-title">Payout Reality</span>' +
        '<span class="ofp-scope">50K accounts only</span>' +
      '</div>' +
      '<div class="ofp-lede">' +
        'What a funded run actually pays after the split, the fees and the withdrawal caps. ' +
        'This is a <strong>scenario</strong> — it asks &ldquo;if I average this per day&rdquo;, it does not read your live account.' +
      '</div>' +
      '<form class="ofp-form" id="ofp-form">' +
        '<div class="ofp-f"><label class="ofp-l" for="ofp-firm">Firm</label>' +
          '<select class="ofp-sel" id="ofp-firm" name="firm"></select></div>' +
        '<div class="ofp-f"><label class="ofp-l" for="ofp-pnl">Avg $/day</label>' +
          '<input class="ofp-in" id="ofp-pnl" name="avgDailyPnl" type="number" min="1" step="any" value="250" required></div>' +
        '<div class="ofp-f"><label class="ofp-l" for="ofp-accts">Accounts</label>' +
          '<input class="ofp-in" id="ofp-accts" name="numAccounts" type="number" step="1" value="1" required></div>' +
        '<div class="ofp-f"><label class="ofp-l" for="ofp-months">Months</label>' +
          '<input class="ofp-in" id="ofp-months" name="months" type="number" step="1" value="12" required></div>' +
        '<div class="ofp-f"><label class="ofp-l" for="ofp-stage">Stage</label>' +
          '<select class="ofp-sel" id="ofp-stage" name="accountStage">' +
            '<option value="xfa" selected>XFA</option><option value="lfa">LFA</option></select></div>' +
        '<div class="ofp-f"><label class="ofp-l" for="ofp-path">Path</label>' +
          '<select class="ofp-sel" id="ofp-path" name="payoutPath">' +
            '<option value="standard" selected>Standard</option><option value="consistency">Consistency</option></select></div>' +
        '<label class="ofp-check"><input type="checkbox" id="ofp-dll" name="dllOptedIn" checked> DLL opted in</label>' +
        '<button class="ofp-run" id="ofp-run" type="submit">Project payouts</button>' +
      '</form>' +
      '<div class="ofp-msg" id="ofp-msg"></div>' +
      '<div class="ofp-out" id="ofp-out"></div>' +
    '</div>';

  var formEl = document.getElementById('ofp-form');
  var firmEl = document.getElementById('ofp-firm');
  var acctsEl = document.getElementById('ofp-accts');
  var monthsEl = document.getElementById('ofp-months');
  var dllEl = document.getElementById('ofp-dll');
  var runEl = document.getElementById('ofp-run');
  var msgEl = document.getElementById('ofp-msg');
  var outEl = document.getElementById('ofp-out');

  acctsEl.min = String(NUM_ACCOUNTS_MIN); acctsEl.max = String(NUM_ACCOUNTS_MAX);
  monthsEl.min = String(MONTHS_MIN); monthsEl.max = String(MONTHS_MAX);

  var firmsLoaded = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function usd(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function note(text) {
    msgEl.textContent = text;
    msgEl.className = text ? 'ofp-msg on' : 'ofp-msg';
  }

  function loadFirms() {
    if (firmsLoaded) return;
    // Firms come from the server list — never a hardcoded roster here.
    fetch('/api/prop-firm/firms', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (list) {
        if (!Array.isArray(list) || !list.length) throw new Error('no firms returned');
        firmEl.innerHTML = list.map(function (f) {
          return '<option value="' + esc(f.name) + '">' + esc(f.displayName || f.name) + '</option>';
        }).join('');
        firmsLoaded = true;
        note('');
      })
      .catch(function (e) {
        note('Could not load the firm list from the tower (' + e.message + '). Try again once it is back.');
      });
  }

  /** Renders ONLY values present in the server response. No derived rules. */
  function render(d) {
    var cap = d.payout_cap_applied || {};
    var splitPct = d.payoutSplit == null ? null : Math.round(d.payoutSplit * 100);

    var head = '<div class="ofp-grid">' +
      // Only the server's own payoutSplit is shown. The firm's complementary
      // share is NOT derived here — stating another party's cut is a rule claim
      // this panel has no authority to make (grader finding 8).
      item('Your split', splitPct == null ? '—' : splitPct + '%',
           splitPct == null ? '' : 'your share of gross P&L', 'good') +
      item('Total payout', usd(d.totalPayout), 'over ' + String(d.monthlyProjection ? d.monthlyProjection.length : '—') + ' months') +
      item('Total costs', usd(d.totalCosts), 'fees for ' + String(d.numAccounts) + ' account(s)') +
      item('Net profit', usd(d.totalProfit), 'payout minus costs', d.totalProfit > 0 ? 'good' : 'warn') +
      item('Break-even', d.breakEvenMonth == null ? 'not in window' : 'month ' + String(d.breakEvenMonth),
           d.breakEvenMonth == null ? 'costs still ahead at the end' : 'first month in the black',
           d.breakEvenMonth == null ? 'warn' : '') +
      item('Before payouts', String(d.totalPrePayoutMonths) + ' mo',
           String(d.evalMonths) + ' eval + ' + String(d.bufferMonths) + ' buffer') +
    '</div>';

    var capUncapped = cap.cap_per_request == null;
    var capBlock = '<div class="ofp-sec">Withdrawal caps — what the firm lets you take out</div>' +
      '<div class="ofp-grid">' +
        item('Per request', capUncapped ? 'uncapped' : usd(cap.cap_per_request),
             capUncapped ? 'this tier has no per-request ceiling' : 'most you can withdraw at once', capUncapped ? 'good' : '') +
        item('Requests / month', String(cap.requests_per_month == null ? '—' : cap.requests_per_month), 'pinned cadence') +
        item('Monthly ceiling', cap.monthly_cap_per_account == null ? 'uncapped' : usd(cap.monthly_cap_per_account),
             'per account', cap.monthly_cap_per_account == null ? 'good' : '') +
        item('Assumed setup', String(cap.account_stage || '—').toUpperCase() + ' · ' + String(cap.payout_path || '—'),
             'DLL ' + (cap.dll_opted_in ? 'opted in' : 'not opted in')) +
      '</div>';

    var rows = (d.monthlyProjection || []).map(function (m) {
      return '<tr class="' + (m.payoutCapped ? 'capped' : '') + '">' +
        '<td class="ofp-phase">' + esc(String(m.month)) + ' · ' + esc(m.phase) + '</td>' +
        '<td>' + usd(m.grossPnl) + '</td>' +
        '<td>' + usd(m.netPayout) + (m.payoutCapped ? ' ⚑' : '') + '</td>' +
        '<td>' + usd(m.netPayoutUncapped) + '</td>' +
        '<td>' + usd(m.costs) + '</td>' +
        '<td>' + usd(m.cumulativeProfit) + '</td>' +
      '</tr>';
    }).join('');
    var anyCapped = (d.monthlyProjection || []).some(function (m) { return m.payoutCapped; });
    var tbl = '<div class="ofp-sec">Month by month' + (anyCapped ? ' — ⚑ marks a month the cap held money back' : '') + '</div>' +
      '<div class="ofp-tblwrap"><table class="ofp-tbl"><thead><tr>' +
        '<th>Month</th><th>Gross P&amp;L</th><th>Paid out</th><th>Uncapped</th><th>Costs</th><th>Cumulative</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';

    // ★ OR-149: the projection's own honest limits, always rendered when present.
    var simps = (cap.simplifications || []);
    // An EMPTY list is stated explicitly, never rendered as silence: a projection
    // shown with no honest-limits block at all is the OR-149 failure mode wearing
    // a different face (grader finding 7).
    var simpBlock = '<div class="ofp-sec">What this projection does NOT model</div>' +
      (simps.length
        ? '<ul class="ofp-simp">' + simps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>'
        : '<ul class="ofp-simp"><li>The tower declared no simplifications for this projection. ' +
          'That is unusual — treat these numbers as unqualified only if you can confirm why.</li></ul>');

    var bounds = '<div class="ofp-sec">Scope of this panel</div><ul class="ofp-simp">' +
      '<li>50K accounts only — every firm in the config is 50K; there is no other size to project.</li>' +
      '<li>A scenario, not your books: it assumes a flat average day and reads no live account state.</li>' +
      '<li>The no-input version of this panel is waiting on CL-012 (a cross-lane change); until then the cap and cadence numbers are reachable only through this form.</li>' +
    '</ul>';

    outEl.innerHTML = head + capBlock + tbl + simpBlock + bounds;
    outEl.className = 'ofp-out on';
  }

  /**
   * Single escaping choke point: k/v/sub are TEXT and are escaped here, never
   * by the caller. Deliberate — the previous shape took raw HTML for v/sub, so
   * safety depended on every call site remembering to escape. One forgetful
   * future edit would have been a silent XSS. Do not add a raw-HTML variant.
   */
  function item(k, v, sub, cls) {
    return '<div class="ofp-item"><div class="ofp-k">' + esc(k) + '</div>' +
      '<div class="ofp-v ' + esc(cls || '') + '">' + esc(v) + '</div>' +
      (sub ? '<div class="ofp-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function submit(ev) {
    ev.preventDefault();
    if (!firmEl.value) { note('No firm selected — the firm list has not loaded yet.'); return; }
    var body = {
      firm: firmEl.value,
      avgDailyPnl: Number(document.getElementById('ofp-pnl').value),
      numAccounts: Number(acctsEl.value),
      months: Number(monthsEl.value),
      accountStage: document.getElementById('ofp-stage').value,
      payoutPath: document.getElementById('ofp-path').value,
      dllOptedIn: !!dllEl.checked,
    };
    runEl.disabled = true;
    note('');
    fetch('/api/prop-firm/payout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          // Surface the server's own rejection text — it stays authoritative.
          // zod failures put the useful part in `details`, not `error` ("Invalid
          // request" alone tells the operator nothing) — so both are relayed
          // (grader finding 5: the docstring claimed this before the code did).
          if (!r.ok) {
            var why = (j && j.error) ? j.error : 'http ' + r.status;
            var det = (j && Array.isArray(j.details))
              ? j.details.map(function (d) {
                  var where = Array.isArray(d.path) ? d.path.join('.') : d.path;
                  return where ? where + ': ' + d.message : d.message;
                }).filter(Boolean).join('; ')
              : '';
            throw new Error(det ? why + ' — ' + det : why);
          }
          return j;
        });
      })
      .then(function (d) { render(d); })
      .catch(function (e) {
        outEl.className = 'ofp-out';
        note('The tower could not run this projection: ' + e.message);
      })
      .finally(function () { runEl.disabled = false; });
  }

  formEl.addEventListener('submit', submit);

  function start() { root.classList.remove('of-hide'); loadFirms(); }
  function stop() { root.classList.add('of-hide'); }

  document.addEventListener('office:unlocked', start);
  document.addEventListener('office:locked', stop);
})();
