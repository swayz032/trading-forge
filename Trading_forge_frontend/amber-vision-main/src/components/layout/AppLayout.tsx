import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { KillSwitchBanner } from "@/components/KillSwitchBanner";
import { ServerStatusBanner } from "@/components/ServerStatusBanner";

export function AppLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-void">
        <AppSidebar />
        <div className="flex-1 flex flex-col relative z-10">
          <KillSwitchBanner />
          <ServerStatusBanner />
          <TopBar />
          <main className="flex-1 p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
