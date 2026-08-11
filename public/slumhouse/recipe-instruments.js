(function (window, document) {
  "use strict";

  var LABELS = {
    "walk-forward": "Walk-forward fold wall",
    "jitter-dials": "Parameter jitter console",
    crash: "Crash chamber",
    regimes: "Market regime wheel",
    shuffle: "Luck shuffle table",
    paper: "One-week paper-trial ledger",
    drift: "Live-match scope",
    compliance: "Rule-control board",
    backtest: "Backtest replay deck"
  };

  function finite(value) {
    var number = Number(value);
    return value !== null && value !== undefined && Number.isFinite(number) ? number : null;
  }

  function panel(kind, evidence, body) {
    var root = document.createElement("section");
    root.className = "recipe-instrument recipe-instrument--" + kind;
    root.setAttribute("data-instrument", kind);
    root.setAttribute("aria-label", LABELS[kind] || "Recipe evidence instrument");
    root.setAttribute("tabindex", "-1");
    var values = evidence && typeof evidence === "object" ? Object.values(evidence) : [];
    var hasEvidence = values.some(function (value) {
      if (Array.isArray(value)) return value.some(function (item) { return finite(item) !== null; });
      if (value && typeof value === "object") return Object.values(value).some(function (item) { return finite(item) !== null; });
      return finite(value) !== null;
    });
    root.setAttribute("data-state", hasEvidence ? "measured" : "empty");
    root.innerHTML = hasEvidence ? body : '<div class="instrument-empty">Not run yet.</div>';
    return root;
  }

  function bars(values) {
    var real = (Array.isArray(values) ? values : []).map(finite).filter(function (value) { return value !== null; });
    if (!real.length) return "";
    var max = Math.max.apply(null, real.map(Math.abs).concat([1]));
    return '<div class="instrument-bars" data-series="persisted">' + real.map(function (value) {
      var height = Math.max(4, Math.min(100, Math.abs(value) / max * 100));
      return '<i style="--level:' + height.toFixed(1) + '%"><span>' + value + '</span></i>';
    }).join("") + "</div>";
  }

  function cards(evidence) {
    return '<div class="instrument-readouts">' + Object.keys(evidence || {}).filter(function (key) {
      return key !== "kind" && finite(evidence[key]) !== null;
    }).map(function (key) {
      return '<div><small>' + key.replace(/([A-Z])/g, " $1") + '</small><strong>' + finite(evidence[key]) + "</strong></div>";
    }).join("") + "</div>";
  }

  function renderBacktest(recipe) {
    var bt = recipe && recipe.backtest || {};
    return panel("backtest", { curve: bt.equityCurve }, '<div class="instrument-screen">' + bars(bt.equityCurve) + "</div>" + cards({ sharpe: bt.sharpeRatio, profitFactor: bt.profitFactor, drawdown: bt.maxDrawdownPct }));
  }

  function renderGate(recipe, name) {
    var metric = recipe && recipe.gateMetrics && recipe.gateMetrics[name] || {};
    var evidence = metric.instrument || {};
    var kind = evidence.kind || "compliance";
    var series = evidence.folds || (evidence.regimes && Object.values(evidence.regimes));
    var body = series ? bars(series) + cards(evidence) : cards(evidence);
    return panel(kind, evidence, '<div class="instrument-bezel"><div class="instrument-title">' + (LABELS[kind] || kind) + "</div>" + body + "</div>");
  }

  window.RecipeInstruments = { renderBacktest: renderBacktest, renderGate: renderGate };
})(window, document);
