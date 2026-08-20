#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

PACK = Path("research/_mnq_v24_replay_lab_v3/pack")
HTML = PACK / "review_v3.html"
MARKER = "MNQ_TP_CONTEXT_GAP_READY_V3"

SCRIPT = r'''<script>
(function () {
  const PATCH_MARKER = 'MNQ_TP_CONTEXT_GAP_READY_V3';
  const NO_VISIBLE = 'NO_VISIBLE_MEANINGFUL_REACTION_IN_PRESENTED_CONTEXT';
  const NOT_CAPTURABLE = 'TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT';
  const freezeBtn = document.getElementById('freeze');
  if (!freezeBtn || window.MNQ_TP_CONTEXT_GAP_READY_V3) return;

  const tpCard = document.getElementById('drawTp') && document.getElementById('drawTp').closest('.card');
  if (tpCard && !document.getElementById('noTpLong')) {
    const helper = document.createElement('div');
    helper.className = 'small muted';
    helper.style.marginTop = '8px';
    helper.innerHTML = '<b>Important:</b> Do not invent a TP. If the chart has open space and no meaningful reaction/key level in one direction, use <b>NO VISIBLE REACTION / OPEN SPACE</b>. The opposite-direction TP is optional.';
    const row = document.createElement('div');
    row.className = 'choices';
    row.style.marginTop = '7px';
    row.innerHTML = '<button id="noTpLong" type="button">BULLISH — NO VISIBLE REACTION</button><button id="noTpShort" type="button">BEARISH — NO VISIBLE REACTION</button>';
    tpCard.appendChild(helper);
    tpCard.appendChild(row);
  }

  function setNoVisible(side) {
    const l = lab();
    const isLong = side === 'LONG';
    const tpField = isLong ? 'trader_tp_long' : 'trader_tp_short';
    const statusField = isLong ? 'trader_tp_long_status' : 'trader_tp_short_status';
    l[tpField] = null;
    l[statusField] = NO_VISIBLE;
    if (l.final_action === (isLong ? 'ENTER_LONG' : 'ENTER_SHORT')) {
      l.trader_tp_reaction_cluster = null;
      l.trader_tp_status = NO_VISIBLE;
    }
    save();
    renderLabels();
    if (typeof updateMainControlStatus === 'function') {
      updateMainControlStatus(`${side} TP = OPEN SPACE / NO VISIBLE REACTION`);
    }
  }

  const noLong = document.getElementById('noTpLong');
  const noShort = document.getElementById('noTpShort');
  if (noLong && !noLong.dataset.v3Bound) {
    noLong.dataset.v3Bound = '1';
    noLong.addEventListener('click', () => setNoVisible('LONG'));
  }
  if (noShort && !noShort.dataset.v3Bound) {
    noShort.dataset.v3Bound = '1';
    noShort.addEventListener('click', () => setNoVisible('SHORT'));
  }

  const statusText = (tp, status) => {
    if (tp) return tp.lo === tp.hi ? Number(tp.lo).toFixed(2) : `${Number(tp.lo).toFixed(2)}-${Number(tp.hi).toFixed(2)}`;
    if (status === NO_VISIBLE) return 'NO VISIBLE REACTION / OPEN SPACE';
    if (status === NOT_CAPTURABLE) return 'NOT CAPTURABLE FROM PRESENTED CHART';
    return 'not marked';
  };

  const previousRenderLabels = renderLabels;
  renderLabels = function () {
    previousRenderLabels();
    const l = lab();
    const tpStatusEl = document.getElementById('tpStatus');
    if (tpStatusEl) {
      tpStatusEl.innerHTML = `<b style="color:#70c18b">Bullish TP:</b> ${statusText(l.trader_tp_long, l.trader_tp_long_status)} &nbsp; · &nbsp; <b style="color:#df6b72">Bearish TP:</b> ${statusText(l.trader_tp_short, l.trader_tp_short_status)}`;
    }
  };

  function downloadJson(filename, body) {
    const blob = new Blob([JSON.stringify(body, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  if (!document.getElementById('saveDraft')) {
    const saveDraft = document.createElement('button');
    saveDraft.id = 'saveDraft';
    saveDraft.textContent = 'Save Draft';
    saveDraft.title = 'Download your current work without completeness validation.';
    freezeBtn.parentNode.insertBefore(saveDraft, freezeBtn);
    saveDraft.addEventListener('click', () => {
      downloadJson('mnq_replay_v3_labels_DRAFT.json', {
        schema_version: 3,
        pack_id: pack.pack_id,
        saved_at: new Date().toISOString(),
        status: 'DRAFT_NOT_FROZEN',
        labels: pack.cases.map(c => labels[c.case_id] || null),
      });
    });
  }

  function recoverFinalAction(l) {
    if (['ENTER_LONG', 'ENTER_SHORT', 'NO_TRADE'].includes(l.final_action)) return l.final_action;
    const timeline = Array.isArray(l.decision_timeline) ? l.decision_timeline : [];
    const decisions = timeline.filter(x => ['ENTER_LONG', 'ENTER_SHORT', 'NO_TRADE'].includes(x && x.action));
    if (!decisions.length) return '';
    const chosen = decisions[decisions.length - 1];
    l.final_action = chosen.action;
    if (chosen.action.startsWith('ENTER_')) {
      l.first_entry_time = l.first_entry_time || chosen.time || null;
      l.entry_force = l.entry_force || chosen.force || 'NOT_APPLICABLE';
    }
    return l.final_action;
  }

  function autoFinalizeEndedWaitOnly(c, l, warnings) {
    if (['ENTER_LONG', 'ENTER_SHORT', 'NO_TRADE'].includes(l.final_action)) return l.final_action;
    const timeline = Array.isArray(l.decision_timeline) ? l.decision_timeline : [];
    if (timeline.some(x => x && x.action && x.action !== 'WAIT')) return '';
    const replayLength = Array.isArray(c.replay_1m) ? c.replay_1m.length : 0;
    const revealCount = Number(l.reveal_count || 0);
    if (!replayLength || revealCount < replayLength) return '';
    l.final_action = 'NO_TRADE';
    l.entry_force = l.entry_force || 'NOT_APPLICABLE';
    l.finalization_recovery = {
      status: 'AUTO_NO_TRADE_FROM_REPLAY_END_WAIT_ONLY',
      reveal_count: revealCount,
      replay_count: replayLength,
      reason: 'Freeze was requested after the full replay ended and the saved case contained only WAIT decisions.'
    };
    warnings.push({case_id: c.case_id, warning: 'AUTO_NO_TRADE_FROM_REPLAY_END_WAIT_ONLY'});
    return l.final_action;
  }

  function normalizeSavedCase(l, caseId, warnings) {
    if (!l) return null;
    const action = recoverFinalAction(l);
    if (!action) return l;
    if (!action.startsWith('ENTER_')) return l;

    const timeline = Array.isArray(l.decision_timeline) ? l.decision_timeline : [];
    if (!l.first_entry_time) {
      const event = timeline.find(x => x && x.action === action && x.time);
      if (event) l.first_entry_time = event.time;
    }
    if (!l.first_entry_time) {
      l.entry_time_capture_status = 'ENTRY_TIME_NOT_RECOVERABLE_FROM_SAVED_REPLAY_STATE';
      warnings.push({case_id: caseId, warning: l.entry_time_capture_status});
    }

    if (!Array.isArray(l.trader_zones)) l.trader_zones = [];
    if (!l.trader_zones.length) {
      l.key_zone_capture_status = 'KEY_ZONE_NOT_CAPTURED_IN_SAVED_STATE';
      warnings.push({case_id: caseId, warning: l.key_zone_capture_status});
    }

    const isLong = action === 'ENTER_LONG';
    const tpField = isLong ? 'trader_tp_long' : 'trader_tp_short';
    const statusField = isLong ? 'trader_tp_long_status' : 'trader_tp_short_status';
    let chosenTp = l[tpField] || l.trader_tp_reaction_cluster || null;
    let chosenStatus = l[statusField] || l.trader_tp_status || '';

    if (chosenTp && !l[tpField]) l[tpField] = chosenTp;

    if (!chosenTp && chosenStatus !== NO_VISIBLE && chosenStatus !== NOT_CAPTURABLE) {
      chosenStatus = NOT_CAPTURABLE;
      l[statusField] = NOT_CAPTURABLE;
      warnings.push({case_id: caseId, warning: NOT_CAPTURABLE, entered_direction: isLong ? 'LONG' : 'SHORT'});
    }

    l.trader_tp_reaction_cluster = chosenTp;
    l.trader_tp_status = chosenTp ? 'MARKED' : chosenStatus;
    return l;
  }

  freezeBtn.textContent = 'Freeze & Export';
  freezeBtn.title = 'Preserves completed work. A full replay that ended with WAIT only is finalized as NO TRADE; missing numeric TP caused by presented-chart context is recorded instead of blocking export.';
  freezeBtn.onclick = async () => {
    const warnings = [];
    const unresolvedActions = [];
    for (const c of pack.cases) {
      const l = labels[c.case_id];
      if (!l) {
        unresolvedActions.push(`${c.case_id}: saved label missing`);
        continue;
      }
      let action = recoverFinalAction(l);
      if (!action) action = autoFinalizeEndedWaitOnly(c, l, warnings);
      normalizeSavedCase(l, c.case_id, warnings);
      if (!['ENTER_LONG', 'ENTER_SHORT', 'NO_TRADE'].includes(l.final_action)) {
        unresolvedActions.push(`${c.case_id}: replay not finished and final action missing`);
      }
    }

    if (unresolvedActions.length) {
      alert('These case(s) still have no recoverable final decision:\n\n' + unresolvedActions.join('\n') + '\n\nOnly those unfinished case(s) need ENTER LONG, ENTER SHORT, or END / NO TRADE. Full replays that ended with WAIT only are now automatically finalized as NO TRADE.');
      return;
    }

    save();
    renderLabels();
    const rows = pack.cases.map(c => labels[c.case_id]);
    let body = {
      schema_version: 3,
      pack_id: pack.pack_id,
      frozen_at: new Date().toISOString(),
      status: warnings.length ? 'FROZEN_WITH_PRESENTED_CONTEXT_CAPTURE_GAPS' : 'FROZEN_COMPLETE',
      capture_warnings: warnings,
      labels: rows,
    };
    const raw = JSON.stringify(body);
    if (window.crypto && crypto.subtle) {
      body.labels_sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))))
        .map(x => x.toString(16).padStart(2,'0')).join('');
    } else {
      body.labels_sha256 = 'BROWSER_CRYPTO_UNAVAILABLE';
    }
    downloadJson('mnq_replay_v3_labels_FROZEN.json', body);
  };

  renderLabels();
  window.MNQ_TP_CONTEXT_GAP_READY_V3 = true;
})();
</script>'''


def patch(path: Path = HTML) -> str:
    text = path.read_text(encoding="utf-8")
    if MARKER in text:
        return text
    if "</body>" not in text:
        raise RuntimeError("REPLAY_V3_BODY_CLOSE_MISSING_FOR_TP_CONTEXT_PATCH")
    text = text.replace("</body>", SCRIPT + "\n</body>", 1)
    if MARKER not in text:
        raise RuntimeError("REPLAY_V3_TP_CONTEXT_PATCH_NOT_BOUND")
    path.write_text(text, encoding="utf-8")
    return text


def main() -> None:
    text = patch()
    print(f"REPLAY_V3_TP_CONTEXT_PATCH_OK:{len(text)}")


if __name__ == "__main__":
    main()
