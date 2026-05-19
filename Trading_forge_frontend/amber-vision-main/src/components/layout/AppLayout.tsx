import { Outlet } from "react-router-dom";
import { TopNav } from "@/components/layout/TopNav";
import { KillSwitchBanner } from "@/components/KillSwitchBanner";
import { ServerStatusBanner } from "@/components/ServerStatusBanner";

export function AppLayout() {
  return (
    <div className="min-h-screen w-full bg-void flex flex-col relative z-10">
      <KillSwitchBanner />
      <ServerStatusBanner />
      <TopNav />
      <main className="flex-1 px-6 pb-10 pt-2 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
