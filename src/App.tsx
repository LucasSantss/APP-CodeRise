import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/auth/Login";
import DashboardLayout from "./components/layout/DashboardLayout";
import ProtectedRoute from "./components/layout/ProtectedRoute";

// Admin pages
import AdminDashboard from "./pages/admin/Dashboard";
import Clients from "./pages/admin/Clients";
import AdminIntegrations from "./pages/admin/Integrations";
import AdminSettings from "./pages/admin/Settings";

// User pages
import UserHome from "./pages/dashboard/Home";
import Chatbot from "./pages/dashboard/Chatbot";
import EcommerceConfig from "./pages/dashboard/EcommerceConfig";
import StoreMapping from "./pages/dashboard/StoreMapping";
import UserLogs from "./pages/dashboard/Logs";
import UserWebhooks from "./pages/dashboard/Webhooks";

import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            30_000,     // 30s sem refetch automático
      gcTime:               5 * 60_000, // 5min no cache após desmontagem
      retry:                1,          // 1 retry em falha (não 3)
      refetchOnWindowFocus: false,      // não refetch ao voltar à aba
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Navigate to="/login" replace />} />

          {/* Admin routes */}
          <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><DashboardLayout /></ProtectedRoute>}>
            <Route path="dashboard" element={<AdminDashboard />} />
            <Route path="clients" element={<Clients />} />
            <Route path="integrations" element={<AdminIntegrations />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>

          {/* User routes */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
            <Route index element={<UserHome />} />
            <Route path="chatbot" element={<Chatbot />} />
            <Route path="ecommerce-config" element={<EcommerceConfig />} />
            <Route path="store-mapping" element={<StoreMapping />} />
            <Route path="logs" element={<UserLogs />} />
            <Route path="webhooks" element={<UserWebhooks />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
