import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Brain, Stethoscope } from "lucide-react";

const RoleSelect = () => {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  if (user && profile?.role === "psicologo") {
    return <Navigate to="/dashboard/psicologo" replace />;
  }

  const selectRole = async () => {
    if (!user) {
      navigate("/auth/psicologo");
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ role: "psicologo" })
      .eq("user_id", user.id);

    if (error) {
      toast.error("Erro ao selecionar perfil");
      return;
    }

    await refreshProfile();
    navigate("/onboarding/psicologo");
  };

  return (
    <div className="min-h-screen flex items-center justify-center gradient-soft p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl gradient-primary mb-4">
            <Brain className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">Bem-vindo(a) ao MindCare</h1>
          <p className="text-muted-foreground mt-2">Acesse sua conta profissional para continuar</p>
        </div>

        <Card
          className="cursor-pointer shadow-card border-2 border-transparent hover:border-primary hover:shadow-elevated transition-all duration-300 group"
          onClick={selectRole}
        >
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-20 h-20 rounded-2xl bg-accent flex items-center justify-center mb-3 group-hover:gradient-primary transition-all duration-300">
              <Stethoscope className="w-10 h-10 text-accent-foreground group-hover:text-primary-foreground transition-colors" />
            </div>
            <CardTitle className="text-xl">Sou Psicólogo(a)</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription className="text-center">
              Quero gerenciar minha clínica, agenda e atendimentos
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default RoleSelect;
