import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Brain, Calendar, Users, LogOut, Settings } from "lucide-react";
import { EmailConfirmToast } from "@/components/EmailConfirmToast";
import { PsychologistProfileDialog } from "@/components/PsychologistProfileDialog";
import { RevenueCard } from "@/components/RevenueCard";
import { GestaoAtendimentoCard } from "@/components/GestaoAtendimentoCard";
import { supabase } from "@/integrations/supabase/client";

interface ActivePatientSummary {
  user_id: string;
  nome_completo: string | null;
  email: string | null;
  data_nascimento: string | null;
}

const displayName = (p: { nome_completo: string | null; email: string | null }) =>
  p.nome_completo?.trim() || p.email || "Nome não informado";

interface UpcomingAppointment {
  id: string;
  patient_id: string;
  patient_name: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
}

const formatBirthDate = (date: string | null) => {
  if (!date) return "Data não informada";
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${day}/${month}/${year}`;
};

const PsychologistDashboard = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [activePatients, setActivePatients] = useState<number>(0);
  const [activePatientList, setActivePatientList] = useState<ActivePatientSummary[]>([]);
  const [weekAppointments, setWeekAppointments] = useState<number>(0);
  const [upcomingAppointments, setUpcomingAppointments] = useState<UpcomingAppointment[]>([]);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem("pending_email_confirm");
    if (stored) {
      setPendingEmail(stored);
      sessionStorage.removeItem("pending_email_confirm");
    }
  }, []);

  const fetchCounts = useCallback(async () => {
      if (!user) return;

      const { data: patientLinks } = await supabase
        .from("psychologist_patients")
        .select("patient_id")
        .eq("psychologist_id", user.id);

      const patientIds = (patientLinks || []).map((link) => link.patient_id);
      setActivePatients(patientIds.length);

      if (patientIds.length > 0) {
        const [{ data: profiles }, { data: patientProfiles }] = await Promise.all([
          supabase
            .from("profiles")
            .select("user_id, nome_completo, email")
            .in("user_id", patientIds),
          supabase
            .from("patient_profiles")
            .select("user_id, data_nascimento")
            .in("user_id", patientIds),
        ]);

        const profileMap = new Map((profiles || []).map((item) => [item.user_id, item]));
        const birthDateMap = new Map((patientProfiles || []).map((item) => [item.user_id, item.data_nascimento]));

        setActivePatientList(
          patientIds.map((patientId) => ({
            user_id: patientId,
            nome_completo: profileMap.get(patientId)?.nome_completo || null,
            email: profileMap.get(patientId)?.email || null,
            data_nascimento: birthDateMap.get(patientId) || null,
          }))
        );
      } else {
        setActivePatientList([]);
      }


      // Consultas desta semana (segunda a domingo)
      const now = new Date();
      const day = now.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const start = new Date(now);
      start.setDate(now.getDate() + diff);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const { data: appts } = await supabase
        .from("appointments")
        .select("id")
        .eq("psychologist_id", user.id)
        .gte("appointment_date", iso(start))
        .lte("appointment_date", iso(end));
      setWeekAppointments(appts?.length || 0);

      // Próximas consultas confirmadas (a partir de hoje)
      const today = iso(new Date());
      const { data: confirmed } = await supabase
        .from("appointments")
        .select("id, patient_id, appointment_date, start_time, end_time")
        .eq("psychologist_id", user.id)
        .eq("status", "confirmado")
        .gte("appointment_date", today)
        .order("appointment_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(5);

      if (confirmed && confirmed.length > 0) {
        const ids = Array.from(new Set(confirmed.map((c) => c.patient_id)));
        const { data: confProfiles } = await supabase
          .from("profiles")
          .select("user_id, nome_completo, email")
          .in("user_id", ids);
        const nameMap = new Map(
          (confProfiles || []).map((p) => [p.user_id, displayName({ nome_completo: p.nome_completo, email: p.email })])
        );
        setUpcomingAppointments(
          confirmed.map((c) => ({
            id: c.id,
            patient_id: c.patient_id,
            patient_name: nameMap.get(c.patient_id) || "Paciente",
            appointment_date: c.appointment_date,
            start_time: c.start_time,
            end_time: c.end_time,
          }))
        );
      } else {
        setUpcomingAppointments([]);
      }
  }, [user]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts, location.key]);

  useEffect(() => {
    const onFocus = () => fetchCounts();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchCounts]);

  return (
    <div className="min-h-screen bg-background">
      {pendingEmail && (
        <EmailConfirmToast email={pendingEmail} onClose={() => setPendingEmail(null)} />
      )}
      <header className="border-b bg-card">
        <div className="container mx-auto flex items-center justify-between py-4 px-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
              <Brain className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">MindCare</h2>
              <p className="text-xs text-muted-foreground">Painel do Psicólogo</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">
              Olá, {profile?.nome_completo || "Profissional"}
            </span>
            <Button variant="ghost" size="icon" onClick={signOut}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 md:p-8">
        <div className="mb-8 animate-fade-in">
          <h1 className="text-3xl font-bold text-foreground">
            Bem-vindo(a), {profile?.nome_completo?.split(" ")[0] || "Profissional"}!
          </h1>
          <p className="text-muted-foreground mt-1">Aqui está o resumo do seu consultório</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8 animate-slide-up">
          <Card
            className="shadow-card border-0 cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all duration-200"
            onClick={() => navigate("/dashboard/psicologo/pacientes")}
          >
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
                  <Users className="w-5 h-5 text-accent-foreground" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{activePatients}</p>
              <p className="text-sm text-muted-foreground">Pacientes · Ativos</p>
              {activePatientList.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  {activePatientList.slice(0, 3).map((patient) => (
                    <div key={patient.user_id} className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {displayName(patient)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Nascimento: {formatBirthDate(patient.data_nascimento)}
                      </p>
                    </div>
                  ))}
                  {activePatientList.length > 3 && (
                    <p className="text-xs text-muted-foreground">+{activePatientList.length - 3} pacientes</p>
                  )}
                </div>
              )}
              <p className="text-xs text-primary mt-3">Clique para ver →</p>
            </CardContent>
          </Card>

          <Card
            className="shadow-card border-0 cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all duration-200"
            onClick={() => navigate("/dashboard/psicologo/agenda")}
          >
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-accent-foreground" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{weekAppointments}</p>
              <p className="text-sm text-muted-foreground">Consultas · Esta semana</p>
              <p className="text-xs text-primary mt-1">Clique para ver →</p>
            </CardContent>
          </Card>


          <Card
            className="shadow-card border-0 cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all duration-200"
            onClick={() => setProfileDialogOpen(true)}
          >
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
                  <Settings className="w-5 h-5 text-accent-foreground" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">100%</p>
              <p className="text-sm text-muted-foreground">Perfil · Completo</p>
              <p className="text-xs text-primary mt-1">Ver e editar →</p>
            </CardContent>
          </Card>
        </div>

        <PsychologistProfileDialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen} />

        {user && <GestaoAtendimentoCard psychologistId={user.id} />}
        {user && <RevenueCard psychologistId={user.id} />}

        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="shadow-card border-0">
            <CardContent className="p-6">
              <h3 className="font-semibold text-foreground mb-1">Próximas Consultas</h3>
              <p className="text-sm text-muted-foreground mb-4">Consultas confirmadas</p>
              {upcomingAppointments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>Nenhuma consulta agendada</p>
                  <p className="text-sm">Confirme consultas na agenda</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingAppointments.map((appt) => {
                    const dateLabel = new Date(appt.appointment_date + "T00:00:00").toLocaleDateString("pt-BR", {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                    });
                    return (
                      <button
                        key={appt.id}
                        type="button"
                        onClick={() => navigate("/dashboard/psicologo/agenda")}
                        className="w-full flex items-center gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Calendar className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{appt.patient_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {dateLabel} · {appt.start_time.slice(0, 5)} – {appt.end_time.slice(0, 5)}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-card border-0">
            <CardContent className="p-6">
              <h3 className="font-semibold text-foreground mb-1">Pacientes Recentes</h3>
              <p className="text-sm text-muted-foreground mb-4">Últimos atendimentos</p>
              {activePatientList.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>Nenhum paciente ainda</p>
                  <p className="text-sm">Seus pacientes aparecerão aqui</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activePatientList.slice(0, 5).map((patient) => (
                    <button
                      key={patient.user_id}
                      type="button"
                      onClick={() => navigate("/dashboard/psicologo/pacientes")}
                      className="w-full rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-accent"
                    >
                      <p className="truncate text-sm font-medium text-foreground">
                        {displayName(patient)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Nascimento: {formatBirthDate(patient.data_nascimento)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default PsychologistDashboard;
