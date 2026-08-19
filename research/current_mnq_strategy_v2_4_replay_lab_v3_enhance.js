/* MNQ v2.4 Replay Lab V3 desktop overlay enhancement.
 * Loaded after the core generated page. Keeps trader-drawn key zones visible on
 * 15m/5m/1m and the TP reaction cluster visible on 5m/1m without exposing bot data.
 * It also starts each chart near the current decision area instead of shrinking
 * ten days of context into a tiny first view; the trader can still pan left.
 */
(function () {
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

  const coreRenderCase = renderCase;
  renderCase = function () {
    coreRenderCase();
    focusDecisionArea();
    drawOverlays();
  };

  focusDecisionArea();
  drawOverlays();
})();
