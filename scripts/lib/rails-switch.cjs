// scripts/lib/rails-switch.cjs — rails pause/skip switch. Mirrors soak readSwitch on the
// rails_* namespace so the operator can pause the rails independently of the soak.
"use strict";

async function readRailsSwitch(queryFn) {
  try {
    const rows = await queryFn(["rails_mode", "rails_skip_until"]);
    const m = {};
    for (const r of rows) m[r.param_name] = r.current_value;
    let mode = "armed"; // row absent → default-ON
    if (m.rails_mode !== undefined && Number(m.rails_mode) === 0) mode = "off";
    const skip = Number(m.rails_skip_until);
    return { mode, skipUntilMs: Number.isFinite(skip) ? skip : null };
  } catch {
    return { mode: null, skipUntilMs: null }; // fail-closed → guard SKIPs
  }
}

module.exports = { readRailsSwitch };
