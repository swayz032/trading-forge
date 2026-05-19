import { motion } from "framer-motion";
import { TradingViewWidget } from "@/components/forge/TradingViewWidget";

interface Symbol {
  symbol: string;
  label: string;
  name: string;
}

const DEFAULT_SYMBOLS: Symbol[] = [
  { symbol: "FOREXCOM:SPXUSD", label: "ES", name: "S&P 500" },
  { symbol: "FOREXCOM:NSXUSD", label: "NQ", name: "Nasdaq" },
  { symbol: "TVC:USOIL", label: "CL", name: "Crude Oil" },
];

export function SymbolMiniChartRow({ symbols = DEFAULT_SYMBOLS }: { symbols?: Symbol[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {symbols.map((s, i) => (
        <motion.div
          key={s.symbol}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: i * 0.05 }}
          className="forge-card overflow-hidden p-0"
        >
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
            <div>
              <span className="text-xs font-mono font-bold text-emerald">{s.label}</span>
              <span className="text-[10px] text-text-muted ml-2">{s.name}</span>
            </div>
          </div>
          <div style={{ height: 120 }}>
            <TradingViewWidget type="mini-chart" symbol={s.symbol} height={120} />
          </div>
        </motion.div>
      ))}
    </div>
  );
}
