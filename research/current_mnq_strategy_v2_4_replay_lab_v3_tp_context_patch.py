#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

PACK = Path("research/_mnq_v24_replay_lab_v3/pack")
HTML = PACK / "review_v3.html"
MARKER = "MNQ_TP_CONTEXT_GAP_READY_V4"

SCRIPT = r'''<script>
(function () {
  const PATCH_MARKER = 'MNQ_TP_CONTEXT_GAP_READY_V4';
  const NO_VISIBLE = 'NO_VISIBLE_MEANINGFUL_REACTION_IN_PRESENTED_CONTEXT';
  const NOT_CAPTURABLE = 'TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT';
  const freezeBtn = document.getElementById('freeze');
  if (!freezeBtn || window.MNQ_TP_CONTEXT_GAP_READY_V4) return;

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
  if (noLong && !noLong.dataset.v4Bound) {
    noLong.dataset.v4Bound = '1';
    noLong.addEventListener('click', () => setNoVisible('LONG'));
  }
  if (noShort && !noShort.dataset.v4Bound) {
    noShort.dataset.v4Bound = '1';
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
    if (['ENTER_LONG', 'ENTER_SHORT', 'NO_TRADE', 'WAIT'].includes(l.final_action)) return l.final_action;
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

  function preserveEndedWaitOnly(c, l, warnings) {
    if (['ENTER_LONG', 'ENTER_SHORT', 'NO_TRADE', 'WAIT'].includes(l.final_action)) return l.final_action;
    const timeline = Array.isArray(l.decision_timeline) ? l.decision_timeline : [];
    const waitEvents = timeline.filter(x => x && x.action === 'WAIT');
    if (!waitEvents.length || timeline.some(x => x && x.action && x.action !== 'WAIT')) return '';
    const replayLength = Array.isArray(c.replay_1m) ? c.replay_1m.length : 0;
    const revealCount = Number(l.reveal_count || 0);
    if (!replayLength || revealCount < replayLength) return '';
    l.final_action = 'WAIT';
    l.first_entry_time = null;
    l.entry_force = l.entry_force || 'NOT_APPLICABLE';
    l.finalization_recovery = {
      status: 'TRADER_ENDED_PRESENTED_REPLAY_STILL_WAITING',
      reveal_count: revealCount,
      replay_count: replayLength,
      reason: 'The trader chose WAIT and the presented replay window ended. WAIT is preserved and is not converted to NO_TRADE.'
    };
    warnings.push({case_id: c.case_id, warning: 'TRADER_ENDED_PRESENTED_REPLAY_STILL_WAITING'});
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
  freezeBtn.title = 'Preserves your exact decision. If the replay ends while you are still waiting, WAIT remains WAIT and is not changed to NO TRADE.';
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
      if (!action) action = preserveEndedWaitOnly(c, l, warnings);
      normalizeSavedCase(l, c.case_id, warnings);
      if (!['ENTER_LONG', 'ENTER_SHORT', 'NO_TRADE', 'WAIT'].includes(l.final_action)) {
        unresolvedActions.push(`${c.case_id}: replay not finished and final action missing`);
      }
    }

    if (unresolvedActions.length) {
      alert('These case(s) still have no recoverable decision:\n\n' + unresolvedActions.join('\n') + '\n\nOnly those unfinished case(s) need another decision. A full replay that ends while you are still WAITING is preserved as WAIT — never NO TRADE.');
      return;
    }

    save();
    renderLabels();
    const rows = pack.cases.map(c => labels[c.case_id]);
    const waitCount = rows.filter(r => r && r.final_action === 'WAIT').length;
    let body = {
      schema_version: 3,
      pack_id: pack.pack_id,
      frozen_at: new Date().toISOString(),
      status: waitCount ? 'FROZEN_WITH_TRADER_WAIT_AT_REPLAY_END' : (warnings.length ? 'FROZEN_WITH_PRESENTED_CONTEXT_CAPTURE_GAPS' : 'FROZEN_COMPLETE'),
      wait_at_replay_end_count: waitCount,
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
  window.MNQ_TP_CONTEXT_GAP_READY_V4 = true;
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
