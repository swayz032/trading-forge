import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Bell,
  ChevronDown,
  Command,
  Flame,
  LayoutDashboard,
  Swords,
  FlaskConical,
  Dice5,
  Rocket,
  Brain,
  Search,
  Database,
  Play,
  Building2,
  Shield,
  BookOpen,
  Activity,
  Settings,
  Boxes,
  FileCode2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string;
  url?: string;
  items?: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Dashboard",
    url: "/",
  },
  {
    label: "Command Room",
    url: "/command-room",
  },
  {
    label: "Strategy Lab",
    items: [
      { title: "Strategies", url: "/strategies", icon: Swords },
      { title: "Library", url: "/library", icon: Boxes },
      { title: "Deploy Ready", url: "/strategies/deploy-ready", icon: Rocket },
      { title: "Backtests", url: "/backtests", icon: FlaskConical },
      { title: "Monte Carlo", url: "/monte-carlo", icon: Dice5 },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { title: "AI Agents", url: "/agents", icon: Brain },
      { title: "Strategy Scout", url: "/scout", icon: Search },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Data Pipeline", url: "/data", icon: Database },
      { title: "Paper Trading", url: "/paper", icon: Play },
      { title: "Prop Firm", url: "/prop-firm", icon: Building2 },
      { title: "Compliance", url: "/compliance", icon: Shield },
      { title: "Pine Distribution", url: "/pine-export", icon: FileCode2 },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Journal", url: "/journal", icon: BookOpen },
      { title: "Decay Monitor", url: "/decay", icon: Activity },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

function isGroupActive(group: NavGroup, pathname: string): boolean {
  if (group.url) {
    return group.url === "/" ? pathname === "/" : pathname.startsWith(group.url);
  }
  if (!group.items) return false;
  return group.items.some((item) =>
    item.url === "/" ? pathname === "/" : pathname.startsWith(item.url)
  );
}

function isItemActive(url: string, pathname: string): boolean {
  return url === "/" ? pathname === "/" : pathname.startsWith(url);
}

export function TopNav() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 w-full px-6 pt-3 pb-3 transition-all ${
        scrolled ? "backdrop-blur-md" : ""
      }`}
    >
      <div className="mx-auto max-w-[1600px] flex items-center justify-between gap-4">
        {/* Logo + brand */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-[0_0_24px_hsl(160_84%_39%/0.35)] group-hover:shadow-[0_0_32px_hsl(160_84%_39%/0.5)] transition-shadow">
            <Flame className="w-4 h-4 text-background" />
          </div>
          <div className="hidden sm:flex flex-col leading-tight">
            <span className="text-sm font-bold tracking-widest text-foreground uppercase">
              Forge
            </span>
            <span className="text-[9px] text-text-muted tracking-[0.2em] uppercase">
              Trading Lab
            </span>
          </div>
        </Link>

        {/* Pill nav */}
        <nav className="flex-1 flex justify-center">
          <div className="glass rounded-full border border-emerald-500/15 px-1.5 py-1 flex items-center gap-0.5 shadow-[inset_0_1px_0_hsl(160_84%_60%/0.06)]">
            {NAV_GROUPS.map((group) => {
              const active = isGroupActive(group, location.pathname);

              if (group.url) {
                return (
                  <Link
                    key={group.label}
                    to={group.url}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                      active
                        ? "bg-emerald-500/15 text-emerald shadow-[inset_0_0_0_1px_hsl(160_84%_39%/0.3)]"
                        : "text-text-secondary hover:text-foreground hover:bg-surface-2/60"
                    }`}
                  >
                    {group.label}
                  </Link>
                );
              }

              return (
                <DropdownMenu key={group.label}>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`group flex items-center gap-1 px-4 py-1.5 rounded-full text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
                        active
                          ? "bg-emerald-500/15 text-emerald shadow-[inset_0_0_0_1px_hsl(160_84%_39%/0.3)]"
                          : "text-text-secondary hover:text-foreground hover:bg-surface-2/60"
                      }`}
                    >
                      {group.label}
                      <ChevronDown className="w-3 h-3 opacity-60 group-data-[state=open]:rotate-180 transition-transform" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="center"
                    sideOffset={8}
                    className="min-w-[220px] p-1.5 forge-card border-emerald-500/20"
                  >
                    {group.items?.map((item) => {
                      const itemActive = isItemActive(item.url, location.pathname);
                      const Icon = item.icon;
                      return (
                        <DropdownMenuItem key={item.url} asChild>
                          <Link
                            to={item.url}
                            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs cursor-pointer outline-none ${
                              itemActive
                                ? "bg-emerald-500/15 text-emerald"
                                : "text-text-secondary hover:text-foreground hover:bg-surface-2/60 focus:bg-surface-2/60"
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <span>{item.title}</span>
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
          </div>
        </nav>

        {/* Right cluster: search + bell */}
        <div className="flex items-center gap-2 shrink-0">
          <button className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full glass border border-emerald-500/10 text-text-muted text-xs hover:border-emerald-500/30 hover:text-text-secondary transition-all">
            <Command className="w-3 h-3" />
            <span>Search</span>
            <kbd className="ml-2 px-1.5 py-0.5 rounded bg-surface-2 text-[10px] font-mono border border-border/30">
              ⌘K
            </kbd>
          </button>
          <button className="relative p-2 rounded-full text-text-secondary hover:text-foreground hover:bg-surface-2/60 transition-all">
            <Bell className="w-4 h-4" />
            <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 animate-glow-pulse shadow-[0_0_8px_hsl(160_84%_39%/0.6)]" />
          </button>
        </div>
      </div>
    </header>
  );
}
