import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Download, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { toast } from "@/hooks/use-toast";

interface AppointmentRow {
  patient_id: string;
  appointment_date: string;
  status: string;
  valor: number | null;
  payment_status: string;
}

interface RevenueCardProps {
  psychologistId: string;
}

const COUNTABLE_STATUSES = ["agendado", "confirmado", "realizado", "concluido", "concluído"];

const formatBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const MESES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

// Vertical Y-axis tick: each word stacked, characters vertical
const VerticalTick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) => {
  const text = String(payload?.value ?? "");
  const words = text.split(/\s+/).filter(Boolean);
  const colWidth = 12;
  const startX = (x ?? 0) - (words.length - 1) * colWidth;
  return (
    <g transform={`translate(${startX}, ${y})`}>
      {words.map((word, wi) => (
        <text
          key={wi}
          x={wi * colWidth}
          y={0}
          textAnchor="middle"
          fill="hsl(var(--muted-foreground))"
          fontSize={11}
        >
          {word.split("").map((ch, ci) => (
            <tspan key={ci} x={wi * colWidth} dy={ci === 0 ? 8 : 12}>
              {ch}
            </tspan>
          ))}
        </text>
      ))}
    </g>
  );
};

export const RevenueCard = ({ psychologistId }: RevenueCardProps) => {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [patientNames, setPatientNames] = useState<Record<string, string>>({});
  const [valorConsulta, setValorConsulta] = useState<number>(() => {
    const stored = localStorage.getItem(`mc_valor_consulta_${psychologistId}`);
    return stored ? Number(stored) : 150;
  });
  const [editingValor, setEditingValor] = useState(false);
  const [periodoPaciente, setPeriodoPaciente] = useState<string>("ano_atual");
  const [mesProf, setMesProf] = useState<string>("todos");
  const [anoProf, setAnoProf] = useState<string>(String(new Date().getFullYear()));
  const profRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(`mc_valor_consulta_${psychologistId}`, String(valorConsulta));
  }, [valorConsulta, psychologistId]);

  useEffect(() => {
    const load = async () => {
      const { data: appts } = await supabase
        .from("appointments")
        .select("patient_id, appointment_date, status, valor, payment_status")
        .eq("psychologist_id", psychologistId)
        .eq("payment_status", "pago");
      const list = (appts || []).filter((a) =>
        COUNTABLE_STATUSES.includes(a.status)
      ) as AppointmentRow[];
      setAppointments(list);

      const ids = Array.from(new Set(list.map((a) => a.patient_id)));
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, nome_completo, email")
          .in("user_id", ids);
        const map: Record<string, string> = {};
        (profs || []).forEach((p) => {
          map[p.user_id] = p.nome_completo?.trim() || p.email || "Paciente";
        });
        setPatientNames(map);
      }
    };
    if (psychologistId) {
      load();
      const handler = () => load();
      window.addEventListener("mc:appointments-updated", handler);
      return () => window.removeEventListener("mc:appointments-updated", handler);
    }
  }, [psychologistId]);

  const anosDisponiveis = useMemo(() => {
    const set = new Set<number>();
    appointments.forEach((a) => set.add(new Date(a.appointment_date + "T00:00:00").getFullYear()));
    set.add(new Date().getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [appointments]);

  // Filtro por período para visão Pacientes
  const filteredPaciente = useMemo(() => {
    const now = new Date();
    return appointments.filter((a) => {
      const d = new Date(a.appointment_date + "T00:00:00");
      switch (periodoPaciente) {
        case "mes_atual":
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        case "ultimos_3": {
          const ref = new Date(now);
          ref.setMonth(now.getMonth() - 3);
          return d >= ref;
        }
        case "ano_atual":
          return d.getFullYear() === now.getFullYear();
        default:
          return true;
      }
    });
  }, [appointments, periodoPaciente]);

  const dadosPaciente = useMemo(() => {
    const agg: Record<string, { total: number; qtd: number }> = {};
    filteredPaciente.forEach((a) => {
      const v = a.valor != null ? Number(a.valor) : valorConsulta;
      if (!agg[a.patient_id]) agg[a.patient_id] = { total: 0, qtd: 0 };
      agg[a.patient_id].total += v;
      agg[a.patient_id].qtd += 1;
    });
    return Object.entries(agg)
      .map(([id, { total, qtd }]) => ({
        nome: patientNames[id] || "Paciente",
        faturamento: total,
        consultas: qtd,
      }))
      .sort((a, b) => b.faturamento - a.faturamento);
  }, [filteredPaciente, patientNames, valorConsulta]);

  // Filtros do bloco Profissional
  const filteredProf = useMemo(() => {
    return appointments.filter((a) => {
      const d = new Date(a.appointment_date + "T00:00:00");
      if (anoProf !== "todos" && d.getFullYear() !== Number(anoProf)) return false;
      if (mesProf !== "todos" && d.getMonth() !== Number(mesProf)) return false;
      return true;
    });
  }, [appointments, anoProf, mesProf]);

  const dadosProf = useMemo(() => {
    if (mesProf !== "todos") {
      const agg: Record<string, { total: number; qtd: number }> = {};
      filteredProf.forEach((a) => {
        const dia = a.appointment_date.split("-")[2];
        const v = a.valor != null ? Number(a.valor) : valorConsulta;
        if (!agg[dia]) agg[dia] = { total: 0, qtd: 0 };
        agg[dia].total += v;
        agg[dia].qtd += 1;
      });
      return Object.entries(agg)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([dia, { total, qtd }]) => ({
          label: `Dia ${dia}`,
          faturamento: total,
          consultas: qtd,
        }));
    }
    const agg: Record<number, { total: number; qtd: number }> = {};
    filteredProf.forEach((a) => {
      const m = new Date(a.appointment_date + "T00:00:00").getMonth();
      const v = a.valor != null ? Number(a.valor) : valorConsulta;
      if (!agg[m]) agg[m] = { total: 0, qtd: 0 };
      agg[m].total += v;
      agg[m].qtd += 1;
    });
    return MESES.map((nome, i) => ({
      label: nome,
      faturamento: agg[i]?.total || 0,
      consultas: agg[i]?.qtd || 0,
    }));
  }, [filteredProf, mesProf, valorConsulta]);

  const totalProf = useMemo(
    () => dadosProf.reduce((acc, d) => acc + d.faturamento, 0),
    [dadosProf]
  );
  const totalConsultasProf = useMemo(
    () => dadosProf.reduce((acc, d) => acc + d.consultas, 0),
    [dadosProf]
  );

  const exportPDF = async () => {
    if (!profRef.current) return;
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(profRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
      });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
      const w = canvas.width * ratio;
      const h = canvas.height * ratio;
      pdf.addImage(img, "PNG", (pageW - w) / 2, (pageH - h) / 2, w, h);
      pdf.save(`faturamento_${anoProf}${mesProf !== "todos" ? `_${Number(mesProf) + 1}` : ""}.pdf`);
      toast({ title: "PDF exportado com sucesso" });
    } catch (e) {
      console.error(e);
      toast({ title: "Erro ao exportar PDF", variant: "destructive" });
    }
  };

  return (
    <Card className="shadow-card border-0 mb-6">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-accent-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Faturamento</h3>
              <p className="text-sm text-muted-foreground">
                Somente consultas marcadas como pagas em Gestão de Atendimento
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editingValor ? (
              <div className="flex items-center gap-2">
                <Label className="text-xs">R$/consulta</Label>
                <Input
                  type="number"
                  className="h-8 w-24"
                  value={valorConsulta}
                  onChange={(e) => setValorConsulta(Number(e.target.value) || 0)}
                />
                <Button size="sm" variant="outline" onClick={() => setEditingValor(false)}>
                  OK
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setEditingValor(true)}>
                <Settings2 className="w-4 h-4 mr-1" />
                Valor: {formatBRL(valorConsulta)}
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="pacientes">
          <TabsList>
            <TabsTrigger value="pacientes">Pacientes</TabsTrigger>
            <TabsTrigger value="profissional">Profissional</TabsTrigger>
          </TabsList>

          <TabsContent value="pacientes" className="mt-4">
            <div className="flex items-center gap-2 mb-4">
              <Label className="text-sm">Período:</Label>
              <Select value={periodoPaciente} onValueChange={setPeriodoPaciente}>
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mes_atual">Mês atual</SelectItem>
                  <SelectItem value="ultimos_3">Últimos 3 meses</SelectItem>
                  <SelectItem value="ano_atual">Ano atual</SelectItem>
                  <SelectItem value="todos">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {dadosPaciente.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Sem consultas no período selecionado.
              </p>
            ) : (
              <div className="w-full h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dadosPaciente} margin={{ top: 10, right: 20, left: 10, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="nome"
                      interval={0}
                      height={70}
                      angle={-30}
                      textAnchor="end"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={(v) => formatBRL(Number(v))}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(value: number, name) =>
                        name === "faturamento" ? [formatBRL(value), "Faturamento"] : [value, name]
                      }
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="faturamento" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </TabsContent>

          <TabsContent value="profissional" className="mt-4">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Label className="text-sm">Ano:</Label>
              <Select value={anoProf} onValueChange={setAnoProf}>
                <SelectTrigger className="w-[120px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {anosDisponiveis.map((a) => (
                    <SelectItem key={a} value={String(a)}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label className="text-sm ml-2">Mês:</Label>
              <Select value={mesProf} onValueChange={setMesProf}>
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {MESES.map((m, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="ml-auto" onClick={exportPDF}>
                <Download className="w-4 h-4 mr-1" />
                Exportar PDF
              </Button>
            </div>

            <div ref={profRef} className="bg-card p-4 rounded-md">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">Total arrecadado</p>
                  <p className="text-xl font-bold text-foreground">{formatBRL(totalProf)}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">Consultas no período</p>
                  <p className="text-xl font-bold text-foreground">{totalConsultasProf}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">Ticket médio</p>
                  <p className="text-xl font-bold text-foreground">{formatBRL(valorConsulta)}</p>
                </div>
              </div>

              <div className="w-full h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dadosProf} margin={{ top: 10, right: 20, left: 10, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="label"
                      interval={0}
                      height={60}
                      angle={-30}
                      textAnchor="end"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={(v) => formatBRL(Number(v))}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(value: number, name) =>
                        name === "faturamento" ? [formatBRL(value), "Faturamento"] : [value, name]
                      }
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="faturamento" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
