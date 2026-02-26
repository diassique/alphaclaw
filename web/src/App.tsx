import { BrowserRouter, Routes, Route } from "react-router";
import { StatusProvider } from "./context/StatusContext.tsx";
import { TelegramProvider } from "./context/TelegramContext.tsx";
import { AppLayout } from "./components/layout/AppLayout.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { HuntPage } from "./pages/HuntPage.tsx";
import { AutopilotPage } from "./pages/AutopilotPage.tsx";
import { ReputationPage } from "./pages/ReputationPage.tsx";
import { MemoryPage } from "./pages/MemoryPage.tsx";
import { NetworkPage } from "./pages/NetworkPage.tsx";
import { ReportsPage } from "./pages/ReportsPage.tsx";
import { TelegramPage } from "./pages/TelegramPage.tsx";
import { LivePage } from "./pages/LivePage.tsx";

export function App() {
  return (
    <BrowserRouter>
      <StatusProvider>
        <TelegramProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="hunt" element={<HuntPage />} />
              <Route path="autopilot" element={<AutopilotPage />} />
              <Route path="reputation" element={<ReputationPage />} />
              <Route path="memory" element={<MemoryPage />} />
              <Route path="network" element={<NetworkPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="telegram" element={<TelegramPage />} />
              <Route path="live" element={<LivePage />} />
            </Route>
          </Routes>
        </TelegramProvider>
      </StatusProvider>
    </BrowserRouter>
  );
}
