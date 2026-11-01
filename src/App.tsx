import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/AppShell";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Agenda from "./pages/Agenda";
import ClinicPage from "./pages/Clinic";
import DocumentEditor from "./pages/DocumentEditor";
import { DocumentList, DocumentNew } from "./pages/Documents";
import Invite from "./pages/Invite";
import Letterheads from "./pages/Letterheads";
import Finance from "./pages/Finance";
import Fiscal from "./pages/Fiscal";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import PatientDetail from "./pages/PatientDetail";
import Atendimento from "./pages/Atendimento";
import Patients from "./pages/Patients";
import Users from "./pages/Users";
import VerifyDocument from "./pages/VerifyDocument";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

const Loading = () => (
  <div className="min-h-screen flex items-center justify-center gradient-soft">
    <div className="animate-pulse text-muted-foreground">Carregando...</div>
  </div>
);

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/entrar" replace />;
  return <>{children}</>;
}

function Guard({ allow, children }: { allow: (a: ReturnType<typeof useAuth>) => boolean; children: ReactNode }) {
  const auth = useAuth();
  return allow(auth) ? <>{children}</> : <Navigate to="/pacientes" replace />;
}

const isAdmin = (a: ReturnType<typeof useAuth>) => a.user?.role === "admin";
const canDocs = (a: ReturnType<typeof useAuth>) => a.canProduceDocuments;

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return (
    <Routes>
      <Route path="/entrar" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/convite/:token" element={<Invite />} />
      <Route path="/verificar" element={<VerifyDocument />} />
      <Route path="/verificar/:codigo" element={<VerifyDocument />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/pacientes" replace />} />
        <Route path="/pacientes" element={<Patients />} />
        <Route path="/pacientes/:id" element={<PatientDetail />} />
        <Route path="/pacientes/:id/atendimento/:sessao" element={<Atendimento />} />
        <Route path="/documentos" element={<Guard allow={canDocs}><DocumentList /></Guard>} />
        <Route path="/documentos/novo" element={<Guard allow={canDocs}><DocumentNew /></Guard>} />
        <Route path="/documentos/:id" element={<Guard allow={canDocs}><DocumentEditor /></Guard>} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/financeiro" element={<Finance />} />
        <Route path="/nota-fiscal" element={<Guard allow={canDocs}><Fiscal /></Guard>} />
        <Route path="/papel-timbrado" element={<Guard allow={isAdmin}><Letterheads /></Guard>} />
        <Route path="/clinica" element={<Guard allow={isAdmin}><ClinicPage /></Guard>} />
        <Route path="/usuarios" element={<Guard allow={isAdmin}><Users /></Guard>} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-center" />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
