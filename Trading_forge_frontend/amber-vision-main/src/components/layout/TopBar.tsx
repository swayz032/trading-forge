import { Bell, Command } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useLocation } from "react-router-dom";

const routeNames: Record<string, string> = {
  "/": "Dashboard",
  "/strategies": "Strategies",
  "/backtests": "Backtests",
  "/monte-carlo": "Monte Carlo",
  "/agents": "AI Agents",
  "/scout": "Strategy Scout",
  "/data": "Data Pipeline",
  "/paper": "Paper Trading",
  "/settings": "Settings",
};

export function TopBar() {
  const location = useLocation();
  const currentRoute = routeNames[location.pathname] || "Dashboard";

  return (
    <header className="h-14 flex items-center justify-between px-4 border-b border-border/30 glass sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-text-secondary hover:text-foreground transition-colors" />
        <div className="h-4 w-px bg-border/40" />
        <nav className="flex items-center gap-1.5 text-sm">
          <span className="text-text-muted">Forge</span>
          <span className="text-text-muted">/</span>
          <span className="text-foreground font-medium">{currentRoute}</span>
        </nav>
      </div>

      <div className="flex items-center gap-2">
        {/* Search trigger */}
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-1 border border-border/30 text-text-muted text-xs hover:border-border/60 hover:text-text-secondary transition-all duration-200">
          <Command className="w-3 h-3" />
          <span>Search...</span>
          <kbd className="ml-4 px-1.5 py-0.5 rounded bg-surface-2 text-[10px] font-mono border border-border/30">
            ⌘K
          </kbd>
        </button>

        {/* Notifications */}
        <button className="relative p-2 rounded-lg text-text-secondary hover:text-foreground hover:bg-surface-2/50 transition-all duration-200">
          <Bell className="w-4 h-4" />
          <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary animate-glow-pulse" />
        </button>
      </div>
    </header>
  );
}
