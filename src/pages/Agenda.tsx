import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/NativeSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError, api, errMsg } from "@/lib/api";
import { addDays, addMinutes, dayKey, dayLabel, hhmm, localInstant, minutesBetween, timeInput, toDateStr, weekStart } from "@/lib/dates";
import { brl, centsToInput, parseBRL } from "@/lib/money";
import { ChangeHistory } from "@/components/ChangeHistory";
import type { Appointment, AppointmentStatus, Atendimento, Patient, Professional, TimeBlock } from "@/lib/types";

const STATUS: Record<AppointmentStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  agendado: { label: "Agendado", variant: "secondary" },
  confirmado: { label: "Confirmado", variant: "outline" },
  realizado: { label: "Realizado", variant: "default" },
  faltou: { label: "Faltou", variant: "destructive" },
  cancelado: { label: "Cancelado", variant: "destructive" },
};

const ATENDIMENTOS: { value: Atendimento; label: string }[] = [
  { value: "particular", label: "Particular" },
  { value: "convenio", label: "Convênio" },
  { value: "pro_bono", label: "Pro bono (gratuito, sem cobrança)" },
];

// ---------------------------------------------------------------- nova sessão / remarcar

function SessionDialog({
  appointment,
  open,
  onClose,
  patients,
  pros,
  defaultDate,
}: {
  appointment: Appointment | null; // null = nova sessão
  open: boolean;
  onClose: () => void;
  patients: Patient[];
  pros: Professional[];
  defaultDate: string;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isPsi = user?.role === "psicologo";
  const blank = () => ({ patient_id: "", professional_id: "", date: defaultDate, time: "09:00", duracao: "50", valor: "", atendimento: "particular" as Atendimento, repetir: "" });
  const [f, setF] = useState(blank);

  useEffect(() => {
    if (!open) return;
    if (appointment) {
      setF({
        patient_id: appointment.patient_id,
        professional_id: appointment.professional_id,
        date: dayKey(appointment.starts_at),
        time: timeInput(appointment.starts_at),
        duracao: String(minutesBetween(appointment.starts_at, appointment.ends_at)),
        valor: appointment.valor ? centsToInput(Math.round(appointment.valor * 100)) : "",
        atendimento: appointment.atendimento,
        repetir: "",
      });
    } else setF(blank());
  }, [open, appointment?.id]);

  const choosePatient = (id: string) => {
    const p = patients.find((x) => x.id === id);
    setF((cur) => ({ ...cur, patient_id: id, professional_id: !isPsi && p?.professional_id ? p.professional_id : cur.professional_id }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const dur = Number(f.duracao);
      if (!Number.isInteger(dur) || dur < 5 || dur > 480) throw new Error("A duração deve ficar entre 5 e 480 minutos");
      let valor: number | null = null;
      if (f.atendimento !== "pro_bono" && f.valor.trim()) {
        const cents = parseBRL(f.valor);
        if (!cents) throw new Error("Valor inválido, por exemplo 200 ou 200,00");
        valor = cents / 100;
      }
      const starts_at = localInstant(f.date, f.time);
      const ends_at = addMinutes(starts_at, dur);
      if (appointment) return api(`/appointments/${appointment.id}`, { method: "PATCH", body: { starts_at, ends_at, valor, atendimento: f.atendimento } });
      if (!f.patient_id) throw new Error("Escolha o paciente");
      if (!isPsi && !f.professional_id) throw new Error("Escolha o psicólogo");
      const n = f.repetir.trim() ? Number(f.repetir) : 1;
      if (!Number.isInteger(n) || n < 1 || n > 52) throw new Error("Repetições: informe de 2 a 52 semanas");
      return api("/appointments", {
        body: {
          patient_id: f.patient_id,
          ...(isPsi ? {} : { professional_id: f.professional_id }),
          starts_at,
          ends_at,
          valor,
          atendimento: f.atendimento,
          ...(n >= 2 ? { recorrencia: { frequencia: "semanal", ocorrencias: n } } : {}),
        },
      });
    },
    onSuccess: () => {
      toast.success(appointment ? "Sessão atualizada" : "Sessão agendada");
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error && !(e instanceof ApiError) ? e.message : errMsg(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{appointment ? "Remarcar sessão" : "Nova sessão"}</DialogTitle>
          <DialogDescription>{appointment ? "Altere data, horário, duração ou valor." : "A sessão pode se repetir toda semana."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {!appointment && (
            <div className="space-y-2">
              <Label htmlFor="s-pac">Paciente</Label>
              <NativeSelect id="s-pac" required value={f.patient_id} onChange={(e) => choosePatient(e.target.value)}>
                <option value="">Escolha o paciente</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {!appointment && !isPsi && (
            <div className="space-y-2">
              <Label htmlFor="s-pro">Psicólogo</Label>
              <NativeSelect id="s-pro" required value={f.professional_id} onChange={(e) => setF({ ...f, professional_id: e.target.value })}>
                <option value="">Escolha o psicólogo</option>
                {pros.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="s-data">Data</Label>
              <Input id="s-data" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-hora">Início</Label>
              <Input id="s-hora" type="time" required value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-dur">Duração (min)</Label>
              <Input id="s-dur" type="number" min={5} max={480} required value={f.duracao} onChange={(e) => setF({ ...f, duracao: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-atend">Tipo de atendimento</Label>
            <NativeSelect id="s-atend" value={f.atendimento} onChange={(e) => setF({ ...f, atendimento: e.target.value as Atendimento, valor: e.target.value === "pro_bono" ? "" : f.valor })}>
              {ATENDIMENTOS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="s-valor">Valor (R$)</Label>
              <Input id="s-valor" inputMode="decimal" placeholder={f.atendimento === "pro_bono" ? "sem valor" : "200,00"} disabled={f.atendimento === "pro_bono"} value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} />
            </div>
            {!appointment && (
              <div className="space-y-2">
                <Label htmlFor="s-rep">Repetir por quantas semanas (opcional)</Label>
                <Input id="s-rep" type="number" min={2} max={52} placeholder="ex.: 12" value={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.value })} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvando..." : appointment ? "Salvar" : "Agendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- bloquear horário

function BlockDialog({ open, onClose, pros, defaultDate }: { open: boolean; onClose: () => void; pros: Professional[]; defaultDate: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isPsi = user?.role === "psicologo";
  const blank = () => ({ professional_id: "", date: defaultDate, ini: "12:00", fim: "13:00", motivo: "" });
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank());
  }, [open]);
  const save = useMutation({
    mutationFn: () => {
      if (!isPsi && !f.professional_id) throw new Error("Escolha o psicólogo");
      return api("/blocks", {
        body: {
          ...(isPsi ? {} : { professional_id: f.professional_id }),
          starts_at: localInstant(f.date, f.ini),
          ends_at: localInstant(f.date, f.fim),
          ...(f.motivo.trim() ? { motivo: f.motivo.trim() } : {}),
        },
      });
    },
    onSuccess: () => {
      toast.success("Horário bloqueado");
      void qc.invalidateQueries({ queryKey: ["blocks"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error && !(e instanceof ApiError) ? e.message : errMsg(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bloquear horário</DialogTitle>
          <DialogDescription>Almoço, folga ou compromisso: o horário fica indisponível para novas sessões.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          {!isPsi && (
            <div className="space-y-2">
              <Label htmlFor="b-pro">Psicólogo</Label>
              <NativeSelect id="b-pro" required value={f.professional_id} onChange={(e) => setF({ ...f, professional_id: e.target.value })}>
                <option value="">Escolha o psicólogo</option>
                {pros.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="b-data">Data</Label>
              <Input id="b-data" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-ini">Das</Label>
              <Input id="b-ini" type="time" required value={f.ini} onChange={(e) => setF({ ...f, ini: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-fim">Até</Label>
              <Input id="b-fim" type="time" required value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-motivo">Motivo (opcional)</Label>
            <Input id="b-motivo" maxLength={200} value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvando..." : "Bloquear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- página

export default function Agenda() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isPsi = user?.role === "psicologo";
  const [anchor, setAnchor] = useState(() => weekStart(new Date()));
  const [pro, setPro] = useState("");
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [creating, setCreating] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [history, setHistory] = useState<string | null>(null);

  const from = anchor.toISOString();
  const to = addDays(anchor, 7).toISOString();
  const appts = useQuery({
    queryKey: ["appointments", toDateStr(anchor), pro],
    queryFn: () => api<Appointment[]>(`/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${pro ? `&professional_id=${pro}` : ""}`),
  });
  const blocks = useQuery({
    queryKey: ["blocks", toDateStr(anchor), pro],
    queryFn: () => api<TimeBlock[]>(`/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${pro ? `&professional_id=${pro}` : ""}`),
  });
  const removeBlock = useMutation({
    mutationFn: (id: string) => api(`/blocks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Bloqueio removido");
      void qc.invalidateQueries({ queryKey: ["blocks"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const patients = useQuery({ queryKey: ["patients-all"], queryFn: () => api<Patient[]>("/patients?ativo=true") });
  const pros = useQuery({ queryKey: ["professionals"], queryFn: () => api<Professional[]>("/professionals") });

  const patientName = useMemo(() => new Map((patients.data ?? []).map((p) => [p.id, p.nome])), [patients.data]);
  const proName = useMemo(() => new Map((pros.data ?? []).map((p) => [p.id, p.nome])), [pros.data]);

  const days = Array.from({ length: 7 }, (_, i) => toDateStr(addDays(anchor, i)));
  const byDay = new Map<string, Appointment[]>();
  const blocksByDay = new Map<string, TimeBlock[]>();
  for (const b of blocks.data ?? []) blocksByDay.set(dayKey(b.starts_at), [...(blocksByDay.get(dayKey(b.starts_at)) ?? []), b]);
  for (const a of appts.data ?? []) byDay.set(dayKey(a.starts_at), [...(byDay.get(dayKey(a.starts_at)) ?? []), a]);

  const setStatus = useMutation({
    mutationFn: async ({ a, status }: { a: Appointment; status: AppointmentStatus }) => {
      await api(`/appointments/${a.id}`, { method: "PATCH", body: { status } });
      if (status !== "realizado") return { cobranca: "nao-se-aplica" as const };
      if (a.atendimento === "pro_bono") return { cobranca: "pro-bono" as const };
      // sessão realizada gera a cobrança (se houver valor)
      try {
        await api("/charges", { body: { patient_id: a.patient_id, appointment_id: a.id } });
        return { cobranca: "criada" as const };
      } catch (e) {
        return { cobranca: e instanceof ApiError && e.status === 409 ? ("ja-existia" as const) : ("sem-valor" as const) };
      }
    },
    onSuccess: ({ cobranca }, { status }) => {
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      void qc.invalidateQueries({ queryKey: ["charges"] });
      if (status !== "realizado") toast.success(`Sessão marcada como ${STATUS[status].label.toLowerCase()}`);
      else if (cobranca === "criada") toast.success("Sessão realizada e cobrança criada");
      else if (cobranca === "pro-bono") toast.success("Sessão pro bono registrada, sem cobrança");
      else if (cobranca === "sem-valor") toast.warning("Sessão realizada, mas a cobrança não foi criada. Use Remarcar para informar o valor.");
      else toast.success("Sessão realizada");
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const rangeLabel = `${days[0]!.split("-").reverse().slice(0, 2).join("/")} a ${days[6]!.split("-").reverse().slice(0, 2).join("/")}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBlocking(true)}>
            Bloquear horário
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4 mr-2" /> Nova sessão
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Semana anterior" onClick={() => setAnchor(addDays(anchor, -7))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button variant="outline" onClick={() => setAnchor(weekStart(new Date()))}>
          Hoje
        </Button>
        <Button variant="outline" size="icon" aria-label="Próxima semana" onClick={() => setAnchor(addDays(anchor, 7))}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        <span className="text-sm font-medium" aria-live="polite">
          {rangeLabel}
        </span>
        {!isPsi && (
          <NativeSelect aria-label="Filtrar por psicólogo" className="w-auto ml-auto" value={pro} onChange={(e) => setPro(e.target.value)}>
            <option value="">Todos os psicólogos</option>
            {pros.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      {appts.isError && <p className="text-sm text-destructive">{errMsg(appts.error, "Não foi possível carregar a agenda.")}</p>}

      <div className="space-y-3">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const dayBlocks = blocksByDay.get(d) ?? [];
          return (
            <section key={d} aria-label={dayLabel(d)} className="rounded-xl border bg-card">
              <h2 className="px-3 py-2 text-sm font-semibold border-b bg-muted/40 rounded-t-xl">{dayLabel(d)}</h2>
              {dayBlocks.length > 0 && (
                <ul className="divide-y border-b bg-muted/20">
                  {dayBlocks.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                      <span>
                        <span className="font-medium">
                          Bloqueado {hhmm(b.starts_at)}–{hhmm(b.ends_at)}
                        </span>
                        {!isPsi && proName.get(b.professional_id) ? ` · ${proName.get(b.professional_id)}` : ""}
                        {b.motivo ? ` · ${b.motivo}` : ""}
                      </span>
                      <Button size="sm" variant="ghost" disabled={removeBlock.isPending} onClick={() => removeBlock.mutate(b.id)}>
                        Remover bloqueio
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {list.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">Sem sessões.</p>
              ) : (
                <ul className="divide-y">
                  {list.map((a) => {
                    const open = a.status === "agendado" || a.status === "confirmado";
                    return (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {hhmm(a.starts_at)}–{hhmm(a.ends_at)} ·{" "}
                            <Link to={`/pacientes/${a.patient_id}`} className="text-primary hover:underline">
                              {patientName.get(a.patient_id) ?? "Paciente"}
                            </Link>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {!isPsi && proName.get(a.professional_id) ? `${proName.get(a.professional_id)} · ` : ""}
                            {a.valor ? brl(Math.round(a.valor * 100)) : "sem valor"}
                            {a.series_id ? " · semanal" : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={STATUS[a.status].variant}>{STATUS[a.status].label}</Badge>
                          {a.atendimento !== "particular" && <Badge variant="outline">{a.atendimento === "pro_bono" ? "Pro bono" : "Convênio"}</Badge>}
                          {a.status === "realizado" && a.valor ? <Badge variant={a.payment_status === "pago" ? "default" : "outline"}>{a.payment_status === "pago" ? "Pago" : "A receber"}</Badge> : null}
                          {a.status === "realizado" && a.atendimento === "particular" && (
                            <Badge variant={a.nota_status === "emitida" ? "default" : "secondary"}>
                              {a.nota_status === "emitida" ? "Nota emitida" : a.nota_status === "rascunho" ? "Nota em rascunho" : "Sem nota"}
                            </Badge>
                          )}
                          {open && (
                            <>
                              {a.status === "agendado" && (
                                <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ a, status: "confirmado" })}>
                                  Confirmar
                                </Button>
                              )}
                              <Button size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ a, status: "realizado" })}>
                                Realizada
                              </Button>
                              <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ a, status: "faltou" })}>
                                Faltou
                              </Button>
                              <Button size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ a, status: "cancelado" })}>
                                Cancelar
                              </Button>
                            </>
                          )}
                          {a.status !== "cancelado" && (
                            <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                              Remarcar
                            </Button>
                          )}
                          {user?.role === "admin" && (
                            <Button size="sm" variant="ghost" onClick={() => setHistory(a.id)}>
                              Histórico
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <ChangeHistory table="appointments" rowId={history} open={!!history} onClose={() => setHistory(null)} title="Histórico da sessão" />
      <BlockDialog open={blocking} onClose={() => setBlocking(false)} pros={pros.data ?? []} defaultDate={toDateStr(new Date())} />
      <SessionDialog appointment={null} open={creating} onClose={() => setCreating(false)} patients={patients.data ?? []} pros={pros.data ?? []} defaultDate={toDateStr(new Date())} />
      <SessionDialog appointment={editing} open={!!editing} onClose={() => setEditing(null)} patients={patients.data ?? []} pros={pros.data ?? []} defaultDate={toDateStr(new Date())} />
    </div>
  );
}
