import { Outlet, useNavigate } from "react-router-dom";
import { Brain, CalendarDays, FileText, Wallet, LogOut, Palette, Receipt, UserCog, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABEL } from "@/lib/types";

export function AppShell() {
  const { user, canProduceDocuments, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  const items = [
    { to: "/agenda", label: "Agenda", icon: CalendarDays, show: true },
    { to: "/pacientes", label: "Pacientes", icon: Users, show: true },
    { to: "/financeiro", label: "Financeiro", icon: Wallet, show: true },
    { to: "/documentos", label: "Documentos", icon: FileText, show: canProduceDocuments },
    { to: "/nota-fiscal", label: "Nota fiscal", icon: Receipt, show: canProduceDocuments },
    { to: "/papel-timbrado", label: "Papel timbrado", icon: Palette, show: user.role === "admin" },
    { to: "/usuarios", label: "Usuários", icon: UserCog, show: user.role === "admin" },
  ].filter((i) => i.show);

  return (
    <div className="min-h-screen gradient-soft">
      <header className="border-b bg-card/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold leading-none">MindCare</p>
              <p className="text-xs text-muted-foreground truncate">{user.clinic_nome}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium leading-none">{user.nome}</p>
              <Badge variant="secondary" className="mt-1 text-[10px]">
                {ROLE_LABEL[user.role]}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sair"
              onClick={() => {
                logout();
                navigate("/entrar");
              }}
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto" aria-label="Principal">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground border-b-2 border-transparent hover:text-foreground whitespace-nowrap"
              activeClassName="!text-primary !border-primary font-medium"
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
