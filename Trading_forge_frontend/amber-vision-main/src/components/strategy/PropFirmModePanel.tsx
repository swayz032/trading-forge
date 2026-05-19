import { useState } from "react";
import { Info, Save } from "lucide-react";
import { toast } from "sonner";

interface PropFirmModePanelProps {
  strategyId: string;
  initialConfig?: Record<string, unknown>;
}

interface PropFirmConfig {
  enabled: boolean;
  profit_target_usd: number;
  max_drawdown_usd: number;
  daily_loss_limit_usd: number;
  consistency_rule_pct: number;
  contract_limit: number;
  drawdown_type: "EOD" | "INTRADAY";
}

const DEFAULTS: PropFirmConfig = {
  enabled: false,
  profit_target_usd: 3500,
  max_drawdown_usd: 2000,
  daily_loss_limit_usd: 800,
  consistency_rule_pct: 20,
  contract_limit: 3,
  drawdown_type: "EOD",
};

// Each firm's canonical defaults — based on docs/prop-firm-rules.md.
const FIRM_TEMPLATES: Record<string, Partial<PropFirmConfig>> = {
  topstep_50k: {
    profit_target_usd: 3000,
    max_drawdown_usd: 2000,
    daily_loss_limit_usd: 1000,
    consistency_rule_pct: 50,
    contract_limit: 5,
    drawdown_type: "EOD",
  },
  mffu_50k: {
    profit_target_usd: 3000,
    max_drawdown_usd: 2000,
    daily_loss_limit_usd: 1500,
    consistency_rule_pct: 30,
    contract_limit: 7,
    drawdown_type: "INTRADAY",
  },
  apex_50k: {
    profit_target_usd: 3000,
    max_drawdown_usd: 2500,
    daily_loss_limit_usd: 0,
    consistency_rule_pct: 30,
    contract_limit: 10,
    drawdown_type: "INTRADAY",
  },
  tpt_50k: {
    profit_target_usd: 3000,
    max_drawdown_usd: 2000,
    daily_loss_limit_usd: 1000,
    consistency_rule_pct: 50,
    contract_limit: 5,
    drawdown_type: "EOD",
  },
  ffn_50k: {
    profit_target_usd: 3000,
    max_drawdown_usd: 2500,
    daily_loss_limit_usd: 0,
    consistency_rule_pct: 15,
    contract_limit: 6,
    drawdown_type: "INTRADAY",
  },
  alpha_50k: {
    profit_target_usd: 3000,
    max_drawdown_usd: 2000,
    daily_loss_limit_usd: 0,
    consistency_rule_pct: 0,
    contract_limit: 5,
    drawdown_type: "INTRADAY",
  },
  tradeify_50k: {
    profit_target_usd: 3000,
    max_drawdown_usd: 2500,
    daily_loss_limit_usd: 1500,
    consistency_rule_pct: 0,
    contract_limit: 7,
    drawdown_type: "INTRADAY",
  },
};

const FIELD_TOOLTIPS: Record<keyof Omit<PropFirmConfig, "enabled">, string> = {
  profit_target_usd: "Dollar amount required to pass evaluation (e.g. Topstep 50K = $3,000)",
  max_drawdown_usd: "Maximum allowed drawdown — account violates if peak-to-trough exceeds this",
  daily_loss_limit_usd: "Single-day loss limit (0 = no per-day cap, just total drawdown)",
  consistency_rule_pct: "Max % of total profit one trading day can contribute (Topstep/TPT 50%, FFN 15%)",
  contract_limit: "Max contracts the firm allows per trade",
  drawdown_type: "EOD = drawdown measured at end-of-day. Intraday = peak-to-trough during the session.",
};

export function PropFirmModePanel({ strategyId, initialConfig }: PropFirmModePanelProps) {
  const [config, setConfig] = useState<PropFirmConfig>({
    ...DEFAULTS,
    ...((initialConfig as unknown as Partial<PropFirmConfig>) ?? {}),
  });
  const [selectedFirm, setSelectedFirm] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const applyTemplate = (firmKey: string) => {
    setSelectedFirm(firmKey);
    if (firmKey && FIRM_TEMPLATES[firmKey]) {
      setConfig((prev) => ({ ...prev, ...FIRM_TEMPLATES[firmKey], enabled: true }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/strategies/${strategyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { prop_firm_mode: config },
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success("Prop firm mode saved");
    } catch (err) {
      toast.error(`Failed to save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const numField = (
    key: keyof Pick<PropFirmConfig, "profit_target_usd" | "max_drawdown_usd" | "daily_loss_limit_usd" | "consistency_rule_pct" | "contract_limit">,
    label: string,
    suffix: string,
  ) => (
    <div className="flex items-center gap-3">
      <label className="text-xs text-text-secondary w-44 shrink-0 flex items-center gap-1.5">
        {label}
        <span className="text-text-muted/60" title={FIELD_TOOLTIPS[key]}>
          <Info className="w-3 h-3" />
        </span>
      </label>
      <div className="flex items-center gap-1.5 flex-1">
        <input
          type="number"
          value={config[key]}
          onChange={(e) => setConfig({ ...config, [key]: Number(e.target.value) })}
          disabled={!config.enabled}
          className="w-32 px-2 py-1.5 rounded-md bg-surface-2 border border-border/30 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
        <span className="text-[10px] text-text-muted">{suffix}</span>
      </div>
    </div>
  );

  return (
    <div className="forge-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
            Prop Firm Mode
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
              QuantVue parity
            </span>
          </h2>
          <p className="text-[11px] text-text-muted mt-1">
            Constrains backtest sizing + signals to a specific prop firm's rules.
            See <code className="text-[10px]">docs/prop-firm-rules.md</code>.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            className="w-4 h-4 rounded border-border/40 bg-surface-2 accent-primary"
          />
          Enable Prop Firm Mode
        </label>
      </div>

      {/* Firm template selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-text-secondary w-44 shrink-0">Apply firm template</label>
        <select
          value={selectedFirm}
          onChange={(e) => applyTemplate(e.target.value)}
          className="px-2 py-1.5 rounded-md bg-surface-2 border border-border/30 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Custom (no template)</option>
          <option value="topstep_50k">Topstep 50K</option>
          <option value="mffu_50k">MFFU 50K</option>
          <option value="apex_50k">Apex 50K</option>
          <option value="tpt_50k">TPT 50K</option>
          <option value="ffn_50k">FFN Express 50K</option>
          <option value="alpha_50k">Alpha Futures 50K</option>
          <option value="tradeify_50k">Tradeify 50K</option>
        </select>
      </div>

      {/* Field grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-2 border-t border-border/10">
        {numField("profit_target_usd", "Profit Target ($)", "USD")}
        {numField("max_drawdown_usd", "Max Drawdown ($)", "USD")}
        {numField("daily_loss_limit_usd", "Daily Loss Limit ($)", "USD")}
        {numField("consistency_rule_pct", "Consistency Rule (%)", "%")}
        {numField("contract_limit", "Contract Limit", "contracts")}
        <div className="flex items-center gap-3">
          <label className="text-xs text-text-secondary w-44 shrink-0 flex items-center gap-1.5">
            Drawdown Type
            <span className="text-text-muted/60" title={FIELD_TOOLTIPS.drawdown_type}>
              <Info className="w-3 h-3" />
            </span>
          </label>
          <select
            value={config.drawdown_type}
            onChange={(e) => setConfig({ ...config, drawdown_type: e.target.value as "EOD" | "INTRADAY" })}
            disabled={!config.enabled}
            className="w-32 px-2 py-1.5 rounded-md bg-surface-2 border border-border/30 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          >
            <option value="EOD">EOD</option>
            <option value="INTRADAY">Intraday</option>
          </select>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center justify-end pt-3 border-t border-border/10">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition flex items-center gap-1.5 disabled:opacity-50"
        >
          <Save className="w-3 h-3" />
          {saving ? "Saving…" : "Save Prop Firm Config"}
        </button>
      </div>
    </div>
  );
}
