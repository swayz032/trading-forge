import { cn } from "@/lib/utils";

type BadgeVariant = "amber" | "profit" | "loss" | "info" | "regime" | "neutral";

interface StatusBadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  amber: "text-primary bg-primary/10 border-primary/20",
  profit: "text-profit bg-profit/10 border-profit/20",
  loss: "text-loss bg-loss/10 border-loss/20",
  info: "text-info bg-info/10 border-info/20",
  regime: "text-regime bg-regime/10 border-regime/20",
  neutral: "text-text-secondary bg-surface-2 border-border/30",
};

const dotStyles: Record<BadgeVariant, string> = {
  amber: "bg-primary",
  profit: "bg-profit",
  loss: "bg-loss",
  info: "bg-info",
  regime: "bg-regime",
  neutral: "bg-text-muted",
};

export function StatusBadge({
  variant = "neutral",
  children,
  dot = false,
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
        variantStyles[variant],
        className
      )}
    >
      {dot && <span className={cn("w-1.5 h-1.5 rounded-full", dotStyles[variant])} />}
      {children}
    </span>
  );
}
