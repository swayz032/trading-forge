import {
  LayoutDashboard,
  Swords,
  FlaskConical,
  Dice5,
  Brain,
  Search,
  Database,
  Play,
  Building2,
  Settings,
  Flame,
  BookOpen,
  Shield,
  Activity,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

const navGroups = [
  {
    label: "Command Center",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
    ],
  },
  {
    label: "Strategy Lab",
    items: [
      { title: "Strategies", url: "/strategies", icon: Swords },
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

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <Sidebar collapsible="icon" className="border-r border-border/40">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Flame className="w-4.5 h-4.5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-widest text-foreground uppercase">
                FORGE
              </span>
              <span className="text-[10px] text-text-muted tracking-wider uppercase">
                Trading Lab
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            {!collapsed && (
              <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-text-muted font-medium mb-1 px-3">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(item.url);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          end={item.url === "/"}
                          className={`relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                            active
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-text-secondary hover:text-foreground hover:bg-surface-2/50"
                          }`}
                          activeClassName=""
                        >
                          {active && (
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-primary" />
                          )}
                          <item.icon className="w-4 h-4 shrink-0" />
                          {!collapsed && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-4">
        {!collapsed && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-1 border border-border/30">
            <div className="status-dot bg-profit" />
            <span className="text-xs text-text-secondary">All systems online</span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
