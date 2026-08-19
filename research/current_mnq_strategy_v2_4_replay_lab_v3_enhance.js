/* MNQ v2.4 Replay Lab V3 unified-main-chart enhancement.
 * Trader-requested layout: ONE large top structure chart for both key zones and
 * TP reaction clusters, plus ONE bottom 1m chart for live force / entry timing.
 * The top chart can switch between 5m and 15m context without losing drawings,
 * supports native pan/zoom plus explicit zoom controls, and records how a key
 * zone was recognized (visible rejection, zoomed-out higher/lower structure, or
 * move-away rejection origin). A scenario is still exactly one trade decision.
 */
(function () {
  // Lightweight Charts treats timestamps as UTC. Preserve the New York wall-clock
  // fields already encoded in each bar ISO timestamp. Example: 09:47-04:00 shows
  // as 09:47 rather than 13:47.
  ts = function (s) {
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return Math.floor(new Date(s).getTime() / 1000);
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
  };

  // Collapse the old split 15m/5m top row into one large main structure chart.
  // Keep the existing hidden charts alive so the core replay clock does not need
  // to be rewritten; the trader interacts only with `main` and the bottom 1m.
  const unifiedStyle = document.createElement('style');
  unifiedStyle.textContent = `
    .workspace{grid-template-columns:1fr!important;grid-template-rows:minmax(520px,62vh) minmax(300px,34vh)!important;gap:10px!important}
    .p15{display:none!important}
    .p5{grid-column:1!important;grid-row:1!important;min-height:520px}
    .p1{grid-column:1!important;grid-row:2!important;min-height:300px}
    #chart5{display:none!important}
    #chartMain{position:absolute;inset:0}
    .mainTools{position:absolute;z-index:9;top:42px;right:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;max-width:75%}
    .mainTools button{padding:6px 9px;background:#111922cc;backdrop-filter:blur(3px)}
    .mainTools button.active{outline:2px solid var(--accent);color:#fff}
    .mainHint{margin-top:8px;padding:7px 10px;border:1px solid #2f3b46;border-radius:8px;background:#10161c;color:#aeb8c2;font-size:12px}
    .zoneMethod{min-width:205px}
    @media(max-width:1100px){.workspace{grid-template-rows:470px 300px!important}.p5{min-height:470px}.p1{min-height:300px}.mainTools{max-width:88%;top:40px}}
  `;
  document.head.appendChild(unifiedStyle);

  const panel15 = document.getElementById('panel15');
  const panel5 = document.getElementById('panel5');
  const chart5 = document.getElementById('chart5');
  panel15.style.display = 'none';
  chart5.style.display = 'none';
  panel5.querySelector('h3').textContent = 'Main Structure / Key Zones + TP Reaction Cluster';

  const mainHost = document.createElement('div');
  mainHost.id = 'chartMain';
  panel5.insertBefore(mainHost, document.getElementById('ov5'));
  const main = mk('chartMain');
  main.chart.applyOptions({
    handleScroll: {mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true},
    handleScale: {axisPressedMouseMove: true, mouseWheel: true, pinch: true},
  });

  const DRAW_TICK = 0.25;
  let mainTf = '5m';
  const mainTools = document.createElement('div');
  mainTools.className = 'mainTools';
  mainTools.innerHTML = `
    <button id="main5m" class="active" title="Trade/setup detail on the same main chart">5m</button>
    <button id="main15m" title="Zoom out to broader structure without leaving the main chart">15m CONTEXT</button>
    <button id="mainZoomOut" title="Show more history / higher or lower structure">− ZOOM OUT</button>
    <button id="mainZoomIn" title="Inspect the reaction or cluster more closely">+ ZOOM IN</button>
    <button id="mainFit" title="Fit all available bars for this timeframe">FIT ALL</button>`;
  panel5.appendChild(mainTools);

  const warn = document.querySelector('.warn');
  warn.innerHTML = 'Use the <b>same big main chart</b> for key zones and TP. If the next level is off-screen, switch to <b>15m CONTEXT</b> and zoom/pan. If you only recognize a rejection after price moves away hard, <b>WAIT</b>, advance the replay, then mark the rejection origin. The bottom chart is only for 1m force and exact entry timing.';

  const hint = document.createElement('div');
  hint.className = 'mainHint';
  hint.innerHTML = '<b>Main chart drawing:</b> blue = key zone · orange = TP. <b>Click once</b> to place an exact TP level; <b>drag</b> to mark a TP reaction area. Drawings are price-anchored and reproject after zoom/pan or 5m ↔ 15m switching.';
  panel5.insertAdjacentElement('afterend', hint);

  // Capture WHY the trader recognized the zone. This is fidelity metadata only;
  // it does not create a new trading rule or change the strategy thresholds.
  const zoneRoleRow = document.getElementById('zoneRole').parentElement;
  const zoneMethod = document.createElement('select');
  zoneMethod.id = 'zoneMethod';
  zoneMethod.className = 'zoneMethod';
  zoneMethod.innerHTML = `
    <option value="VISIBLE_REJECTION">VISIBLE REJECTION</option>
    <option value="ZOOMED_OUT_HIGHER_LOWER">ZOOMED-OUT HIGHER / LOWER LEVEL</option>
    <option value="MOVE_AWAY_REJECTION_ORIGIN">MOVE-AWAY REJECTION ORIGIN</option>`;
  zoneRoleRow.insertBefore(zoneMethod, document.getElementById('drawZone'));

  const zoneHelp = document.createElement('div');
  zoneHelp.className = 'small muted';
  zoneHelp.textContent = 'Choose how you found the level, then draw it on the big main chart.';
  zoneRoleRow.parentElement.insertBefore(zoneHelp, document.getElementById('zones'));

  function snapToTick(price) {
    return Math.round(Number(price) / DRAW_TICK) * DRAW_TICK;
  }

  function paintBand(ctx, width, y1, y2, fill, stroke) {
    const top = Math.min(y1, y2);
    const height = Math.abs(y2 - y1);
    ctx.strokeStyle = stroke;
    if (height < 1.5) {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(top) + 0.5);
      ctx.lineTo(width, Math.round(top) + 0.5);
      ctx.stroke();
      ctx.lineWidth = 1;
      return;
    }
    ctx.fillStyle = fill;
    ctx.fillRect(0, top, width, height);
    ctx.strokeRect(0, top, width, height);
  }

  function paintLayer(canvas, chartObj, zones, tp) {
    const d = canvasSize(canvas);
    const ctx = d.x;
    ctx.clearRect(0, 0, d.w, d.h);
    (zones || []).forEach((z) => {
      const y1 = chartObj.series.priceToCoordinate(z.hi);
      const y2 = chartObj.series.priceToCoordinate(z.lo);
      if (y1 == null || y2 == null) return;
      paintBand(ctx, d.w, y1, y2, 'rgba(75,125,205,.13)', 'rgba(105,155,235,.86)');
    });
    if (tp) {
      const y1 = chartObj.series.priceToCoordinate(tp.hi);
      const y2 = chartObj.series.priceToCoordinate(tp.lo);
      if (y1 != null && y2 != null) {
        paintBand(ctx, d.w, y1, y2, 'rgba(229,161,92,.17)', 'rgba(229,161,92,.94)');
      }
    }
  }

  function mainRows() {
    const one = visibleOne();
    if (mainTf === '15m') {
      return mergedContext(cur().context_15m, aggregate(one, 15));
    }
    return mergedContext(cur().context_5m, aggregate(one, 5));
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
    focusRecent(main, mainTf === '15m' ? 112 : 96);
    focusRecent(c1, 60);
  }

  function refreshMain(fit) {
    main.series.setData(mainRows());
    if (fit) main.chart.timeScale().fitContent();
    drawOverlays();
  }

  function setMainTf(tf) {
    mainTf = tf;
    document.getElementById('main5m').classList.toggle('active', tf === '5m');
    document.getElementById('main15m').classList.toggle('active', tf === '15m');
    refreshMain(false);
    focusDecisionArea();
  }

  function zoomMain(multiplier) {
    const scale = main.chart.timeScale();
    const r = scale.getVisibleLogicalRange();
    if (!r) {
      scale.fitContent();
      return;
    }
    const mid = (r.from + r.to) / 2;
    const half = Math.max(4, (r.to - r.from) * multiplier / 2);
    scale.setVisibleLogicalRange({from: mid - half, to: mid + half});
  }

  document.getElementById('main5m').onclick = () => setMainTf('5m');
  document.getElementById('main15m').onclick = () => setMainTf('15m');
  document.getElementById('mainZoomOut').onclick = () => zoomMain(1.55);
  document.getElementById('mainZoomIn').onclick = () => zoomMain(0.68);
  document.getElementById('mainFit').onclick = () => { main.chart.timeScale().fitContent(); drawOverlays(); };

  drawOverlays = function () {
    const l = lab();
    paintLayer(ov5, main, l.trader_zones, l.trader_tp_reaction_cluster);
    paintLayer(ov1, c1, l.trader_zones, l.trader_tp_reaction_cluster);
  };

  // Canvas drawings store PRICE, not screen Y. Lightweight Charts can autoscale
  // its price axis after horizontal zoom/pan, so reproject every stored price onto
  // the new axis after the chart finishes its own layout pass. Two animation frames
  // make this deterministic instead of painting against the previous scale.
  let overlaySyncFrame = null;
  function scheduleOverlaySync() {
    if (overlaySyncFrame != null) cancelAnimationFrame(overlaySyncFrame);
    overlaySyncFrame = requestAnimationFrame(() => {
      overlaySyncFrame = requestAnimationFrame(() => {
        overlaySyncFrame = null;
        drawOverlays();
      });
    });
  }
  main.chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleOverlaySync);
  panel5.addEventListener('wheel', scheduleOverlaySync, {passive: true});
  panel5.addEventListener('pointermove', scheduleOverlaySync, {passive: true});
  panel5.addEventListener('pointerup', scheduleOverlaySync, {passive: true});

  // Wrap the core data refresh. The hidden legacy charts continue to receive data,
  // while the trader-visible top chart receives either 5m or 15m on demand.
  const coreSetData = setData;
  setData = function (fit) {
    coreSetData(false);
    refreshMain(Boolean(fit));
    renderClock();
  };

  // Draw BOTH zones and TP on the same main overlay. Use distinct draw modes so
  // the old split-chart pointer handler cannot accidentally double-record a draw.
  let mainDragY = null;
  drawZone.onclick = () => beginDraw('main-zone', ov5);
  drawTp.onclick = () => beginDraw('main-tp', ov5);

  function pointerY(e) {
    const r = ov5.getBoundingClientRect();
    return Math.max(0, Math.min(r.height, e.clientY - r.top));
  }

  ov5.addEventListener('pointerdown', (e) => {
    if (drawMode !== 'main-zone' && drawMode !== 'main-tp') return;
    mainDragY = pointerY(e);
    if (ov5.setPointerCapture) ov5.setPointerCapture(e.pointerId);
  });
  ov5.addEventListener('pointerup', (e) => {
    if ((drawMode !== 'main-zone' && drawMode !== 'main-tp') || mainDragY == null) return;
    const endY = pointerY(e);
    const dragPixels = Math.abs(endY - mainDragY);
    let a = main.series.coordinateToPrice(mainDragY);
    let b = main.series.coordinateToPrice(endY);
    if (a == null || b == null) return;
    a = snapToTick(a);
    b = snapToTick(b);
    let lo = Math.min(+a, +b);
    let hi = Math.max(+a, +b);
    if (drawMode === 'main-zone') {
      if (hi - lo < DRAW_TICK) hi = lo + DRAW_TICK;
      lab().trader_zones.push({
        lo, hi,
        role: zoneRole.value,
        source_method: zoneMethod.value,
        marked_time: replayTime(),
        marked_main_timeframe: mainTf,
      });
    } else if (dragPixels <= 4) {
      const price = snapToTick(b);
      lab().trader_tp_reaction_cluster = {
        lo: price,
        hi: price,
        source_method: 'TRADER_TP_LEVEL_CLICK',
        marked_time: replayTime(),
        marked_main_timeframe: mainTf,
      };
    } else {
      if (hi - lo < DRAW_TICK) hi = lo + DRAW_TICK;
      lab().trader_tp_reaction_cluster = {
        lo, hi,
        source_method: 'TRADER_REACTION_CLUSTER_DRAG',
        marked_time: replayTime(),
        marked_main_timeframe: mainTf,
      };
    }
    drawMode = null;
    mainDragY = null;
    if (ov5.releasePointerCapture && ov5.hasPointerCapture && ov5.hasPointerCapture(e.pointerId)) {
      ov5.releasePointerCapture(e.pointerId);
    }
    ov5.classList.remove('draw');
    save();
    renderLabels();
    scheduleOverlaySync();
  });

  // A scenario is ONE trade opportunity. WAIT is observational and may be updated
  // during the same minute; ENTER/NO_TRADE is accepted exactly once.
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

  // Explicit correction path for an accidental final click. Reset removes the one
  // final decision; it never creates a hidden second entry in the same scenario.
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

  function prettyMethod(v) {
    return String(v || 'VISIBLE_REJECTION').replaceAll('_', ' ');
  }

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
    zones.innerHTML = l.trader_zones.length ? l.trader_zones.map((z, i) =>
      `<div class="zoneRow"><b>${z.role}</b>${z.lo.toFixed(2)} – ${z.hi.toFixed(2)}<span class="muted">${prettyMethod(z.source_method)}</span><button onclick="removeZone(${i})">Remove</button></div>`
    ).join('') : '<span class="muted small">None marked</span>';
    if (l.trader_tp_reaction_cluster) {
      const tp = l.trader_tp_reaction_cluster;
      tpStatus.textContent = tp.lo === tp.hi
        ? `${tp.lo.toFixed(2)} · exact TP level`
        : `${tp.lo.toFixed(2)} – ${tp.hi.toFixed(2)} · reaction area`;
    }
    let progress = document.getElementById('replayProgress');
    if (!progress) {
      progress = document.createElement('span');
      progress.id = 'replayProgress';
      progress.className = 'muted';
      clock.insertAdjacentElement('afterend', progress);
    }
    progress.textContent = `Replay ${l.reveal_count}/${cur().replay_1m.length} min · Main ${mainTf}`;
    drawOverlays();
  };

  const coreRenderCase = renderCase;
  renderCase = function () {
    coreRenderCase();
    refreshMain(false);
    focusDecisionArea();
    renderLabels();
    drawOverlays();
    scheduleOverlaySync();
  };

  // Rebuild once with corrected New York wall-clock timestamps and the unified UI.
  document.title = 'MNQ Replay Lab — Unified Main + 1m Entry';
  setData(false);
  focusDecisionArea();
  renderLabels();
  scheduleOverlaySync();
  drawOverlays();
})();