import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, ChevronLeft, ChevronRight, ArrowLeft, Check, X, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AppointmentRow {
  id: string;
  patient_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: string;
}

interface PatientName {
  user_id: string;
  nome_completo: string | null;
}

const HOURS = Array.from({ length: 12 }, (_, i) => 8 + i); // 08:00 - 19:00
const DAYS_LABEL = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const startOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // start Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

const formatISODate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const formatRange = (start: Date) => {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  return `${start.toLocaleDateString("pt-BR", opts)} – ${end.toLocaleDateString("pt-BR", opts)} ${end.getFullYear()}`;
};

const statusVariant = (status: string) => {
  if (status === "confirmado") return "bg-primary text-primary-foreground border-primary";
  if (status === "recusado" || status === "cancelado") return "bg-destructive/10 text-destructive border-destructive/30 line-through";
  if (status === "indisponivel") return "bg-destructive text-destructive-foreground border-destructive";
  return "bg-accent text-accent-foreground border-accent-foreground/20";
};

const PsychologistAgenda = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [patients, setPatients] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const loadAppointments = async () => {
    if (!user) return;
    setLoading(true);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const { data, error } = await supabase
      .from("appointments")
      .select("id, patient_id, appointment_date, start_time, end_time, status")
      .eq("psychologist_id", user.id)
      .gte("appointment_date", formatISODate(weekStart))
      .lte("appointment_date", formatISODate(weekEnd))
      .order("appointment_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) {
      toast.error("Erro ao carregar agenda");
      setLoading(false);
      return;
    }

    const rows = (data || []) as AppointmentRow[];
    setAppointments(rows);

    const ids = Array.from(new Set(rows.map((r) => r.patient_id)));
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, nome_completo")
        .in("user_id", ids);
      const map: Record<string, string> = {};
      (profs || []).forEach((p: PatientName) => {
        map[p.user_id] = p.nome_completo || "Paciente";
      });
      setPatients(map);
    } else {
      setPatients({});
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAppointments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, weekStart]);

  const updateStatus = async (id: string, status: "confirmado" | "recusado") => {
    const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
    if (error) {
      if (String(error.message).includes("Conflito de agenda")) {
        toast.error("Conflito: já existe outro atendimento neste horário");
      } else {
        toast.error("Não foi possível atualizar");
      }
      return;
    }
    toast.success(status === "confirmado" ? "Consulta confirmada!" : "Consulta recusada");
    loadAppointments();
  };

  const toggleUnavailable = async (date: Date, hour: number) => {
    if (!user) return;
    const iso = formatISODate(date);
    const startTime = `${String(hour).padStart(2, "0")}:00:00`;
    const endTime = `${String(hour + 1).padStart(2, "0")}:00:00`;

    const existing = appointments.find(
      (a) => a.appointment_date === iso && a.start_time === startTime && a.status === "indisponivel"
    );

    if (existing) {
      const { error } = await supabase.from("appointments").delete().eq("id", existing.id);
      if (error) {
        toast.error("Não foi possível liberar o horário");
        return;
      }
      toast.success("Horário liberado");
      loadAppointments();
      return;
    }

    const { error } = await supabase.from("appointments").insert({
      psychologist_id: user.id,
      patient_id: user.id,
      appointment_date: iso,
      start_time: startTime,
      end_time: endTime,
      status: "indisponivel",
    });
    if (error) {
      if (String(error.message).includes("Conflito de agenda")) {
        toast.error("Você já tem um atendimento neste horário");
      } else {
        toast.error("Não foi possível bloquear o horário");
      }
      return;
    }
    toast.success("Horário marcado como indisponível");
    loadAppointments();
  };

  const apptsForCell = (date: Date, hour: number) => {
    const iso = formatISODate(date);
    return appointments.filter((a) => {
      if (a.appointment_date !== iso) return false;
      const startHour = parseInt(a.start_time.split(":")[0], 10);
      return startHour === hour;
    });
  };

  const goToday = () => setWeekStart(startOfWeek(new Date()));
  const goPrev = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };
  const goNext = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  const todayIso = formatISODate(new Date());

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto flex items-center justify-between py-4 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard/psicologo")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
              <Brain className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Agenda</h2>
              <p className="text-xs text-muted-foreground">Suas consultas da semana</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToday}>Hoje</Button>
            <Button variant="ghost" size="icon" onClick={goPrev}><ChevronLeft className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" onClick={goNext}><ChevronRight className="w-4 h-4" /></Button>
            <span className="text-sm font-medium text-foreground ml-2">{formatRange(weekStart)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <Badge variant="outline" className="bg-accent">Pendente</Badge>
            <Badge variant="outline" className="bg-primary text-primary-foreground border-primary">Confirmada</Badge>
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Recusada</Badge>
            <Badge variant="outline" className="bg-destructive text-destructive-foreground border-destructive">Indisponível</Badge>
          </div>
        </div>

        <Card className="shadow-card border-0 overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <div className="min-w-[900px]">
                {/* Header row */}
                <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b bg-muted/30">
                  <div className="p-2 text-xs text-muted-foreground border-r">Hora</div>
                  {weekDays.map((d, i) => {
                    const isToday = formatISODate(d) === todayIso;
                    return (
                      <div key={i} className={`p-2 text-center border-r last:border-r-0 ${isToday ? "bg-primary/10" : ""}`}>
                        <p className="text-xs text-muted-foreground">{DAYS_LABEL[i]}</p>
                        <p className={`text-sm font-semibold ${isToday ? "text-primary" : "text-foreground"}`}>
                          {String(d.getDate()).padStart(2, "0")}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Time grid */}
                {HOURS.map((hour) => (
                  <div key={hour} className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b last:border-b-0">
                    <div className="p-2 text-xs text-muted-foreground border-r flex items-start justify-end pr-3">
                      {String(hour).padStart(2, "0")}:00
                    </div>
                    {weekDays.map((d, i) => {
                      const cell = apptsForCell(d, hour);
                      const isToday = formatISODate(d) === todayIso;
                      const isEmpty = cell.length === 0;
                      const onlyUnavailable = cell.length > 0 && cell.every((c) => c.status === "indisponivel");
                      const cellClickable = isEmpty || onlyUnavailable;
                      return (
                        <div
                          key={i}
                          onClick={cellClickable ? () => toggleUnavailable(d, hour) : undefined}
                          className={`min-h-[64px] p-1 border-r last:border-r-0 space-y-1 ${isToday ? "bg-primary/5" : ""} ${cellClickable ? "cursor-pointer hover:bg-destructive/10 transition-colors" : ""}`}
                          title={cellClickable ? (onlyUnavailable ? "Clique para liberar" : "Clique para marcar como indisponível") : undefined}
                        >
                          {cell.map((a) => (
                            <div
                              key={a.id}
                              className={`rounded-md border px-2 py-1 text-xs ${statusVariant(a.status)}`}
                            >
                              {a.status === "indisponivel" ? (
                                <p className="font-medium text-center">Indisponível</p>
                              ) : (
                                <>
                                  <p className="font-medium truncate">{patients[a.patient_id] || "Paciente"}</p>
                                  <p className="opacity-80">
                                    {a.start_time.slice(0, 5)} – {a.end_time.slice(0, 5)}
                                  </p>
                                  {a.status !== "confirmado" && a.status !== "recusado" && a.status !== "cancelado" && (
                                    <div className="flex gap-1 mt-1">
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); updateStatus(a.id, "confirmado"); }}
                                        className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-primary text-primary-foreground hover:opacity-90 px-1 py-0.5"
                                        title="Confirmar"
                                      >
                                        <Check className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); updateStatus(a.id, "recusado"); }}
                                        className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 px-1 py-0.5"
                                        title="Recusar"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lista resumida */}
        <div className="mt-6">
          <h3 className="font-semibold text-foreground mb-3">Solicitações pendentes</h3>
          <Card className="shadow-card border-0">
            <CardContent className="p-4">
              {loading ? (
                <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
              ) : appointments.filter((a) => a.status === "agendado").length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <CalendarIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Nenhuma solicitação pendente nesta semana</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {appointments
                    .filter((a) => a.status === "agendado")
                    .map((a) => (
                      <div key={a.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {patients[a.patient_id] || "Paciente"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(a.appointment_date + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })} · {a.start_time.slice(0, 5)} – {a.end_time.slice(0, 5)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => updateStatus(a.id, "confirmado")}>
                            <Check className="w-4 h-4 mr-1" /> Confirmar
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => updateStatus(a.id, "recusado")}>
                            <X className="w-4 h-4 mr-1" /> Recusar
                          </Button>
                        </div>
                      </div>
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

export default PsychologistAgenda;
