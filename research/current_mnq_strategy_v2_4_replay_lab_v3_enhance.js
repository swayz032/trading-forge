/* MNQ v2.4 Replay Lab V3 desktop enhancement.
 * Loaded after the core generated page. Keeps trader-drawn key zones visible on
 * 15m/5m/1m, the TP reaction cluster visible on 5m/1m, focuses each first view
 * near the decision area, corrects the New York wall-clock display, and makes
 * each scenario behave like one trade: WAIT may continue, but only one final
 * ENTER/NO_TRADE decision can exist unless the trader explicitly resets it.
 */
(function () {
  // Lightweight Charts treats timestamps as UTC and has no native timezone
  // support. The source ISO strings already contain the correct New York wall
  // clock and DST offset, so preserve the wall-clock fields and present them as
  // UTC to the chart. Example: 09:47-04:00 is displayed as 09:47, not 13:47.
  ts = function (s) {
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return Math.floor(new Date(s).getTime() / 1000);
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
  };

  function paintLayer(canvas, chartObj, zones, tp) {
    const d = canvasSize(canvas);
    const ctx = d.x;
    ctx.clearRect(0, 0, d.w, d.h);

    (zones || []).forEach((z) => {
      const y1 = chartObj.series.priceToCoordinate(z.hi);
      const y2 = chartObj.series.priceToCoordinate(z.lo);
      if (y1 == null || y2 == null) return;
      const top = Math.min(y1, y2);
      const height = Math.abs(y2 - y1);
      ctx.fillStyle = 'rgba(75,125,205,.13)';
      ctx.strokeStyle = 'rgba(105,155,235,.82)';
      ctx.fillRect(0, top, d.w, height);
      ctx.strokeRect(0, top, d.w, height);
    });

    if (tp) {
      const y1 = chartObj.series.priceToCoordinate(tp.hi);
      const y2 = chartObj.series.priceToCoordinate(tp.lo);
      if (y1 != null && y2 != null) {
        const top = Math.min(y1, y2);
        const height = Math.abs(y2 - y1);
        ctx.fillStyle = 'rgba(229,161,92,.17)';
        ctx.strokeStyle = 'rgba(229,161,92,.92)';
        ctx.fillRect(0, top, d.w, height);
        ctx.strokeRect(0, top, d.w, height);
      }
    }
  }

  function focusRecent(chartObj, barsBack) {
    const data = chartObj.series.data();
    const n = data ? data.length : 0;
    if (!n) return;
    chartObj.chart.timeScale().setVisibleLogicalRange({
      from: Math.max(-0.5, n - barsBack),
      to: n + 4,
    });
  }

  function focusDecisionArea() {
    focusRecent(c15, 72);  // about 3 RTH days of 15m context
    focusRecent(c5, 84);   // about 7 hours of 5m context
    focusRecent(c1, 60);   // recent live tug-of-war path
  }

  drawOverlays = function () {
    const l = lab();
    paintLayer(ov15, c15, l.trader_zones, null);
    paintLayer(ov5, c5, l.trader_zones, l.trader_tp_reaction_cluster);
    paintLayer(ov1, c1, l.trader_zones, l.trader_tp_reaction_cluster);
  };

  // A scenario represents ONE trade opportunity. WAIT is observational and may
  // be updated as the same minute's force judgment changes. ENTER/NO_TRADE is a
  // final decision and is accepted exactly once. This fixes duplicate ENTER rows.
  recordAction = function (action) {
    const l = lab();
    const now = replayTime();
    if (l.final_action) return;

    if (action === 'WAIT') {
      let sameMinuteWait = null;
      for (let i = l.decision_timeline.length - 1; i >= 0; i -= 1) {
        const x = l.decision_timeline[i];
        if (x.time === now && x.action === 'WAIT') {
          sameMinuteWait = x;
          break;
        }
      }
      if (sameMinuteWait) {
        sameMinuteWait.force = currentForce;
      } else {
        l.decision_timeline.push({time: now, action: 'WAIT', force: currentForce});
      }
      save();
      renderLabels();
      return;
    }

    if (action === 'NO_TRADE') {
      l.final_action = 'NO_TRADE';
      l.entry_force = currentForce;
      l.decision_timeline.push({time: now, action: 'NO_TRADE', force: currentForce});
    } else {
      l.final_action = action;
      l.first_entry_time = now;
      l.entry_force = currentForce;
      l.decision_timeline.push({time: now, action: action, force: currentForce});
    }
    pause();
    save();
    renderLabels();
  };

  // Give the trader an explicit way to correct an accidental final click without
  // allowing a second hidden entry to accumulate in the same scenario.
  const decisionChoices = document.querySelector('.bottom .card .choices');
  const resetDecision = document.createElement('button');
  resetDecision.id = 'resetDecision';
  resetDecision.textContent = 'RESET DECISION';
  resetDecision.title = 'Clear this case final decision and continue the same replay.';
  resetDecision.style.display = 'none';
  decisionChoices.appendChild(resetDecision);
  resetDecision.onclick = function () {
    const l = lab();
    l.final_action = '';
    l.first_entry_time = null;
    l.entry_force = 'NOT_APPLICABLE';
    l.decision_timeline = [];
    currentForce = 'NOT_APPLICABLE';
    save();
    renderLabels();
  };

  const coreRenderLabels = renderLabels;
  renderLabels = function () {
    coreRenderLabels();
    const l = lab();
    const locked = Boolean(l.final_action);
    document.querySelectorAll('[data-action],[data-force]').forEach((b) => {
      b.disabled = locked;
    });
    play.disabled = locked;
    step1.disabled = locked;
    step5.disabled = locked;
    resetDecision.style.display = locked ? '' : 'none';
    if (locked) {
      actionStatus.textContent = `LOCKED — ${l.final_action}${l.first_entry_time ? ' @ ' + new Date(l.first_entry_time).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}) : ''}`;
    }
    let progress = document.getElementById('replayProgress');
    if (!progress) {
      progress = document.createElement('span');
      progress.id = 'replayProgress';
      progress.className = 'muted';
      clock.insertAdjacentElement('afterend', progress);
    }
    progress.textContent = `Replay ${l.reveal_count}/${cur().replay_1m.length} min`;
  };

  const coreRenderCase = renderCase;
  renderCase = function () {
    coreRenderCase();
    focusDecisionArea();
    renderLabels();
    drawOverlays();
  };

  // Rebuild the initially rendered case once with corrected New York wall-clock
  // chart timestamps, then focus it near current structure.
  setData(false);
  focusDecisionArea();
  renderLabels();
  drawOverlays();
})();
