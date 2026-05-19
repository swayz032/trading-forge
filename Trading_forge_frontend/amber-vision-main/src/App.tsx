import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/forge/ErrorBoundary";
import Dashboard from "@/pages/Dashboard";
import Strategies from "@/pages/Strategies";
import StrategyDetail from "@/pages/StrategyDetail";
import Backtests from "@/pages/Backtests";
import BacktestDetail from "@/pages/BacktestDetail";
import Settings from "@/pages/Settings";
import Agents from "@/pages/Agents";
import Scout from "@/pages/Scout";
import DataPipeline from "@/pages/DataPipeline";
import PaperTrading from "@/pages/PaperTrading";
import MonteCarlo from "@/pages/MonteCarlo";
import PropFirmSimulator from "@/pages/PropFirmSimulator";
import Journal from "@/pages/Journal";
import Compliance from "@/pages/Compliance";
import DecayDashboard from "@/pages/DecayDashboard";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
              <Route path="/strategies" element={<ErrorBoundary><Strategies /></ErrorBoundary>} />
              <Route path="/strategies/:id" element={<ErrorBoundary><StrategyDetail /></ErrorBoundary>} />
              <Route path="/backtests" element={<ErrorBoundary><Backtests /></ErrorBoundary>} />
              <Route path="/backtests/:id" element={<ErrorBoundary><BacktestDetail /></ErrorBoundary>} />
              <Route path="/monte-carlo" element={<ErrorBoundary><MonteCarlo /></ErrorBoundary>} />
              <Route path="/agents" element={<ErrorBoundary><Agents /></ErrorBoundary>} />
              <Route path="/scout" element={<ErrorBoundary><Scout /></ErrorBoundary>} />
              <Route path="/data" element={<ErrorBoundary><DataPipeline /></ErrorBoundary>} />
              <Route path="/paper" element={<ErrorBoundary><PaperTrading /></ErrorBoundary>} />
              <Route path="/prop-firm" element={<ErrorBoundary><PropFirmSimulator /></ErrorBoundary>} />
              <Route path="/journal" element={<ErrorBoundary><Journal /></ErrorBoundary>} />
              <Route path="/compliance" element={<ErrorBoundary><Compliance /></ErrorBoundary>} />
              <Route path="/decay" element={<ErrorBoundary><DecayDashboard /></ErrorBoundary>} />
              <Route path="/settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
