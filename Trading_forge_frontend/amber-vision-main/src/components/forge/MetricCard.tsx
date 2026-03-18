import { motion } from "framer-motion";
import { TrendingUp, TrendingDown } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string;
  change?: string;
  changeType?: "profit" | "loss" | "neutral";
  glow?: boolean;
  children?: React.ReactNode;
  delay?: number;
}

export function MetricCard({
  label,
  value,
  change,
  changeType = "neutral",
  glow = false,
  children,
  delay = 0,
}: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={glow ? "forge-card-glow p-5" : "forge-card p-5"}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
          {label}
        </span>
        {change && (
          <div
            className={`flex items-center gap-1 text-xs font-mono font-medium px-2 py-0.5 rounded-full ${
              changeType === "profit"
                ? "text-profit bg-profit/10"
                : changeType === "loss"
                ? "text-loss bg-loss/10"
                : "text-text-secondary bg-surface-2"
            }`}
          >
            {changeType === "profit" ? (
              <TrendingUp className="w-3 h-3" />
            ) : changeType === "loss" ? (
              <TrendingDown className="w-3 h-3" />
            ) : null}
            {change}
          </div>
        )}
      </div>
      <div className="text-2xl font-mono font-bold text-foreground tracking-tight">
        {value}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </motion.div>
  );
}
