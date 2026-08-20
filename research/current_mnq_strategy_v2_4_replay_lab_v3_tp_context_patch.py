#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

PACK = Path("research/_mnq_v24_replay_lab_v3/pack")
HTML = PACK / "review_v3.html"
MARKER = "MNQ_TP_CONTEXT_GAP_READY"

SCRIPT = r'''<script>
(function () {
  const NO_VISIBLE = 'NO_VISIBLE_MEANINGFUL_REACTION_IN_PRESENTED_CONTEXT';
  const tpCard = document.getElementById('drawTp') && document.getElementById('drawTp').closest('.card');
  const freezeBtn = document.getElementById('freeze');
  if (!tpCard || !freezeBtn || document.getElementById('noTpLong')) return;

  const helper = document.createElement('div');
  helper.className = 'small muted';
  helper.style.marginTop = '8px';
  helper.innerHTML = '<b>Important:</b> You do NOT have to invent both TP levels. If the presented chart has open space and no meaningful reaction/key level in one direction, mark that direction as <b>NO VISIBLE REACTION / OPEN SPACE</b>.';

  const row = document.createElement('div');
  row.className = 'choices';
  row.style.marginTop = '7px';
  row.innerHTML = '<button id="noTpLong" type="button">BULLISH — NO VISIBLE REACTION</button><button id="noTpShort" type="button">BEARISH — NO VISIBLE REACTION</button>';
  tpCard.appendChild(helper);
  tpCard.appendChild(row);

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

  document.getElementById('noTpLong').addEventListener('click', () => setNoVisible('LONG'));
  document.getElementById('noTpShort').addEventListener('click', () => setNoVisible('SHORT'));

  const originalRenderLabels = renderLabels;
  renderLabels = function () {
    originalRenderLabels();
    const l = lab();
    const fmt = (tp, status) => {
      if (tp) return tp.lo === tp.hi ? tp.lo.toFixed(2) : `${tp.lo.toFixed(2)}-${tp.hi.toFixed(2)}`;
      if (status === NO_VISIBLE) return 'NO VISIBLE REACTION / OPEN SPACE';
      return 'not marked';
    };
    const tpStatusEl = document.getElementById('tpStatus');
    if (tpStatusEl) {
      tpStatusEl.innerHTML = `<b style="color:#70c18b">Bullish TP:</b> ${fmt(l.trader_tp_long, l.trader_tp_long_status)} &nbsp; · &nbsp; <b style="color:#df6b72">Bearish TP:</b> ${fmt(l.trader_tp_short, l.trader_tp_short_status)}`;
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

  const saveDraft = document.createElement('button');
  saveDraft.id = 'saveDraft';
  saveDraft.textContent = 'Save Draft';
  saveDraft.title = 'Download your current work without completeness validation.';
  freezeBtn.parentNode.insertBefore(saveDraft, freezeBtn);
  saveDraft.addEventListener('click', () => {
    const rows = pack.cases.map(c => labels[c.case_id] || null);
    downloadJson('mnq_replay_v3_labels_DRAFT.json', {
      schema_version: 3,
      pack_id: pack.pack_id,
      saved_at: new Date().toISOString(),
      status: 'DRAFT_NOT_FROZEN',
      labels: rows,
    });
  });

  freezeBtn.onclick = async () => {
    const missing = [];
    for (const c of pack.cases) {
      const l = labels[c.case_id];
      if (!l || !l.final_action) {
        missing.push(c.case_id);
        continue;
      }
      if (!l.final_action.startsWith('ENTER_')) continue;
      if (!l.first_entry_time || !Array.isArray(l.trader_zones) || !l.trader_zones.length) {
        missing.push(c.case_id);
        continue;
      }
      const isLong = l.final_action === 'ENTER_LONG';
      const chosenTp = (isLong ? l.trader_tp_long : l.trader_tp_short) || l.trader_tp_reaction_cluster || null;
      const chosenStatus = (isLong ? l.trader_tp_long_status : l.trader_tp_short_status) || l.trader_tp_status || '';
      if (!chosenTp && chosenStatus !== NO_VISIBLE) {
        missing.push(c.case_id);
        continue;
      }
      l.trader_tp_reaction_cluster = chosenTp;
      l.trader_tp_status = chosenTp ? 'MARKED' : NO_VISIBLE;
    }
    if (missing.length) {
      alert(`Finish all cases first. ${missing.length} incomplete. For an ENTER case, mark the entered-direction TP OR choose NO VISIBLE REACTION / OPEN SPACE. The opposite-direction TP is optional.`);
      return;
    }
    const rows = pack.cases.map(c => labels[c.case_id]);
    let body = {
      schema_version: 3,
      pack_id: pack.pack_id,
      frozen_at: new Date().toISOString(),
      labels: rows,
    };
    const raw = JSON.stringify(body);
    body.labels_sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))))
      .map(x => x.toString(16).padStart(2,'0')).join('');
    downloadJson('mnq_replay_v3_labels_FROZEN.json', body);
  };

  renderLabels();
  window.MNQ_TP_CONTEXT_GAP_READY = true;
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
