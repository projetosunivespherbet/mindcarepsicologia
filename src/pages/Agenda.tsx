import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, List, Plus } from "lucide-react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/NativeSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError, api, errMsg } from "@/lib/api";
import { addDays, addMinutes, dayKey, dayLabel, hhmm, localInstant, minutesBetween, timeInput, toDateStr, weekStart } from "@/lib/dates";
import { brl, centsToInput, parseBRL } from "@/lib/money";
import { MiniCalendar, monthGridRange } from "@/components/MiniCalendar";
import { SessionCard, STATUS } from "@/components/SessionCard";
import { avisoRealizada, cobrarAvulso, marcarRealizada } from "@/lib/session";
import type { FaltaModo } from "@/components/SessionCard";
import { ChangeHistory } from "@/components/ChangeHistory";
import type { Appointment, AppointmentStatus, Atendimento, Patient, Professional, TimeBlock } from "@/lib/types";

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
  defaultTime = "09:00",
  defaultProfessional = "",
}: {
  appointment: Appointment | null; // null = nova sessão
  open: boolean;
  onClose: () => void;
  patients: Patient[];
  pros: Professional[];
  defaultDate: string;
  defaultTime?: string;
  defaultProfessional?: string;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isPsi = user?.role === "psicologo";
  const blank = () => ({ patient_id: "", professional_id: defaultProfessional, date: defaultDate, time: defaultTime, duracao: "50", valor: "", atendimento: "particular" as Atendimento, repetir: "" });
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

// ---------------------------------------------------------------- prontuário pendente

type RecordTarget = Pick<Appointment, "id" | "patient_id" | "starts_at">;

// ---------------------------------------------------------------- grade semanal

const HOUR_PX = 48;
const WORK_START = 8 * 60; // janela usada para contar horários livres
const WORK_END = 18 * 60;

const minuteOfDay = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

interface GridItem {
  key: string;
  start: number;
  end: number;
  appt?: Appointment;
  block?: TimeBlock;
  col: number;
  cols: number;
}

/** Itens que se sobrepõem (sessões de grupo, vários psicólogos) ficam lado a lado. */
function layoutItems(items: Omit<GridItem, "col" | "cols">[]): GridItem[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: GridItem[] = [];
  let cluster: GridItem[] = [];
  let colEnds: number[] = [];
  let clusterEnd = 0;
  const flush = () => {
    for (const it of cluster) it.cols = colEnds.length;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const it of sorted) {
    if (cluster.length > 0 && it.start >= clusterEnd) flush();
    let col = colEnds.findIndex((e) => e <= it.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.end);
    } else colEnds[col] = it.end;
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

/** Minutos livres na janela de trabalho (8h–18h), descontando sessões e bloqueios. */
function freeMinutes(items: { start: number; end: number }[]): number {
  const iv = items
    .map((i) => [Math.max(i.start, WORK_START), Math.min(i.end, WORK_END)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let busy = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of iv) {
    if (!cur) cur = [a, b];
    else if (a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else {
      busy += cur[1] - cur[0];
      cur = [a, b];
    }
  }
  if (cur) busy += cur[1] - cur[0];
  return WORK_END - WORK_START - busy;
}

const fmtFree = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

const GRID_STATUS_CLASS: Record<AppointmentStatus, string> = {
  agendado: "bg-secondary text-secondary-foreground border-border",
  confirmado: "bg-primary/10 border-primary/40",
  realizado: "bg-primary/20 border-primary",
  faltou: "bg-destructive/10 border-destructive/50",
  cancelado: "",
};

function WeekGrid({
  selected,
  days,
  appts,
  blocks,
  patientName,
  showFree,
  onSelect,
  onPickSlot,
  detail,
}: {
  selected: string;
  days: string[];
  appts: Appointment[];
  blocks: TimeBlock[];
  patientName: Map<string, string>;
  showFree: boolean; // só faz sentido para um profissional (com vários, "livre" é ambíguo)
  onSelect: (a: Appointment) => void;
  onPickSlot: (date: string, time: string) => void;
  /** Visão diária: texto extra em cada sessão (telefone, psicólogo). */
  detail?: (a: Appointment) => string;
}) {
  const live = appts.filter((a) => a.status !== "cancelado");
  const perDay = days.map((d) => {
    const items: Omit<GridItem, "col" | "cols">[] = [
      ...live
        .filter((a) => dayKey(a.starts_at) === d)
        .map((a) => {
          const start = minuteOfDay(a.starts_at);
          return { key: a.id, start, end: Math.min(start + minutesBetween(a.starts_at, a.ends_at), 24 * 60), appt: a };
        }),
      ...blocks
        .filter((b) => dayKey(b.starts_at) === d)
        .map((b) => {
          const start = minuteOfDay(b.starts_at);
          return { key: b.id, start, end: Math.min(start + minutesBetween(b.starts_at, b.ends_at), 24 * 60), block: b };
        }),
    ];
    return { d, items };
  });

  const all = perDay.flatMap((x) => x.items);
  const startHour = Math.min(7, ...all.map((i) => Math.floor(i.start / 60)));
  const endHour = Math.min(24, Math.max(21, ...all.map((i) => Math.ceil(i.end / 60))));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const today = toDateStr(new Date());
  const single = days.length === 1;
  const cols = { gridTemplateColumns: `${single ? 52 : 44}px repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className={single ? "" : "min-w-[760px]"}>
        <div className="grid border-b bg-muted/40" style={cols}>
          <div />
          {perDay.map(({ d, items }) => (
            <div key={d} className={`border-l px-2 py-2 text-center ${d === selected ? "bg-primary/20 ring-1 ring-inset ring-primary" : d === today ? "bg-primary/10" : ""}`}>
              <p className="text-xs font-semibold">{dayLabel(d).split(",")[0]}</p>
              <p className="text-xs text-muted-foreground">{d.split("-").reverse().slice(0, 2).join("/")}</p>
              {showFree && <p className="text-[11px] text-emerald-700 dark:text-emerald-400">{fmtFree(freeMinutes(items))} livres</p>}
            </div>
          ))}
        </div>
        <div className="grid" style={cols}>
          <div>
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="pr-1 pt-0.5 text-right text-[11px] text-muted-foreground">
                {hh(h)}
              </div>
            ))}
          </div>
          {perDay.map(({ d, items }) => (
            <div key={d} className={`relative border-l ${d === today ? "bg-primary/5" : ""}`} style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-label={`Horário livre: nova sessão, ${dayLabel(d)}, ${hh(h)}`}
                  className="block w-full border-b border-dashed hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none"
                  style={{ height: HOUR_PX }}
                  onClick={() => onPickSlot(d, hh(h))}
                />
              ))}
              {layoutItems(items).map((it) => {
                const style = {
                  top: ((it.start - startHour * 60) / 60) * HOUR_PX,
                  height: Math.max(((it.end - it.start) / 60) * HOUR_PX, 22),
                  left: `${(it.col / it.cols) * 100}%`,
                  width: `${100 / it.cols}%`,
                };
                if (it.block) {
                  return (
                    <div key={it.key} className="absolute px-0.5 pb-px" style={style}>
                      <div className="h-full w-full overflow-hidden rounded border border-dashed bg-muted px-1 text-xs text-muted-foreground">
                        <p className="truncate">Bloqueado{it.block.motivo ? ` · ${it.block.motivo}` : ""}</p>
                      </div>
                    </div>
                  );
                }
                const a = it.appt!;
                return (
                  <div key={it.key} className="absolute px-0.5 pb-px" style={style}>
                    <button
                      type="button"
                      title={`${STATUS[a.status].label} · ${hhmm(a.starts_at)}–${hhmm(a.ends_at)}`}
                      aria-label={`Sessão ${hhmm(a.starts_at)}, ${patientName.get(a.patient_id) ?? "Paciente"}, ${STATUS[a.status].label}`}
                      className={`h-full w-full overflow-hidden rounded border px-1 text-left text-xs hover:brightness-95 ${GRID_STATUS_CLASS[a.status]}`}
                      onClick={() => onSelect(a)}
                    >
                      <p className="truncate font-medium">
                        {single ? `${hhmm(a.starts_at)}–${hhmm(a.ends_at)}` : hhmm(a.starts_at)} {patientName.get(a.patient_id) ?? "Paciente"}
                      </p>
                      {single && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {STATUS[a.status].label}
                          {a.atendimento !== "particular" ? ` · ${a.atendimento === "pro_bono" ? "Pro bono" : "Convênio"}` : ""}
                          {detail?.(a) ? ` · ${detail(a)}` : ""}
                        </p>
                      )}
                      {a.status === "realizado" && a.prontuario === false && <p className="truncate text-[10px] text-amber-700 dark:text-amber-400">Sem prontuário</p>}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- página

export default function Agenda() {
  const { user, canProduceDocuments: canRecord } = useAuth();
  const qc = useQueryClient();
  const isPsi = user?.role === "psicologo";
  const navigate = useNavigate();
  const [selected, setSelected] = useState(() => toDateStr(new Date()));
  const [month, setMonth] = useState(() => toDateStr(new Date()).slice(0, 7));
  const anchor = useMemo(() => weekStart(new Date(`${selected}T12:00:00`)), [selected]);
  const goTo = (d: string) => {
    setSelected(d);
    setMonth(d.slice(0, 7));
  };
  const shiftWeek = (n: number) => goTo(toDateStr(addDays(new Date(`${selected}T12:00:00`), 7 * n)));
  const [pro, setPro] = useState("");
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [creating, setCreating] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [history, setHistory] = useState<string | null>(null);
  const [view, setView] = useState<"dia" | "grade" | "lista">(() => {
    try {
      const v = localStorage.getItem("agenda-view");
      if (v === "dia" || v === "grade" || v === "lista") return v;
    } catch {
      /* sem armazenamento: usa a lista */
    }
    return "lista";
  });
  const [slot, setSlot] = useState<{ date: string; time: string } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const changeView = (v: "dia" | "grade" | "lista") => {
    setView(v);
    try {
      localStorage.setItem("agenda-view", v);
    } catch {
      /* ignora */
    }
  };

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
  const grid = monthGridRange(month);
  const monthAppts = useQuery({
    queryKey: ["appointments", "month", month, pro],
    queryFn: () => api<Appointment[]>(`/appointments?from=${encodeURIComponent(grid.first.toISOString())}&to=${encodeURIComponent(grid.last.toISOString())}${pro ? `&professional_id=${pro}` : ""}`),
  });
  const marked = useMemo(() => new Set((monthAppts.data ?? []).filter((a) => a.status !== "cancelado").map((a) => dayKey(a.starts_at))), [monthAppts.data]);
  const pending = useQuery({ queryKey: ["pending-records"], enabled: canRecord, queryFn: () => api<RecordTarget[]>("/appointments/pending-records") });
  const patients = useQuery({ queryKey: ["patients-all"], queryFn: () => api<Patient[]>("/patients?ativo=true") });
  const pros = useQuery({ queryKey: ["professionals"], queryFn: () => api<Professional[]>("/professionals") });

  const patientName = useMemo(() => new Map((patients.data ?? []).map((p) => [p.id, p.nome])), [patients.data]);
  const patientById = useMemo(() => new Map((patients.data ?? []).map((p) => [p.id, p])), [patients.data]);
  const proName = useMemo(() => new Map((pros.data ?? []).map((p) => [p.id, p.nome])), [pros.data]);

  const days = Array.from({ length: 7 }, (_, i) => toDateStr(addDays(anchor, i)));
  const byDay = new Map<string, Appointment[]>();
  const blocksByDay = new Map<string, TimeBlock[]>();
  for (const b of blocks.data ?? []) blocksByDay.set(dayKey(b.starts_at), [...(blocksByDay.get(dayKey(b.starts_at)) ?? []), b]);
  // A lista mostra só o que está de pé: sessões canceladas ficam no histórico da sessão e da ficha.
  for (const a of (appts.data ?? []).filter((x) => x.status !== "cancelado")) byDay.set(dayKey(a.starts_at), [...(byDay.get(dayKey(a.starts_at)) ?? []), a]);

  const setStatus = useMutation({
    mutationFn: async ({ a, status, falta }: { a: Appointment; status: AppointmentStatus; falta?: FaltaModo }) => {
      if (status === "realizado") return { cobranca: await marcarRealizada(a) };
      await api(`/appointments/${a.id}`, { method: "PATCH", body: { status } });
      // Falta: o profissional decide se desconta do pacote, se cobra avulso ou se não cobra.
      if (status === "faltou" && falta === "pacote") await api("/packages/use", { body: { appointment_id: a.id } });
      if (status === "faltou" && falta === "cobrar") return { cobranca: null, falta: await cobrarAvulso(a) };
      return { cobranca: null, falta: falta ?? null };
    },
    onSuccess: (r, { status }) => {
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      void qc.invalidateQueries({ queryKey: ["charges"] });
      void qc.invalidateQueries({ queryKey: ["packages"] });
      setDetail(null);
      if (r.cobranca) avisoRealizada(r.cobranca);
      else if (status === "faltou" && r.falta === "pacote") toast.success("Falta registrada e descontada do pacote");
      else if (status === "faltou" && r.falta === "criada") toast.success("Falta registrada e cobrança criada");
      else if (status === "faltou" && r.falta === "sem-valor") toast.warning("Falta registrada, mas a sessão não tem valor para cobrar");
      else toast.success(`Sessão marcada como ${STATUS[status].label.toLowerCase()}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const openEdit = (a: Appointment) => {
    setDetail(null);
    setEditing(a);
  };
  const openHistory = (id: string) => {
    setDetail(null);
    setHistory(id);
  };
  const pickSlot = (date: string, time: string) => {
    setSlot({ date, time });
    setCreating(true);
  };

  const badges = (a: Appointment) => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={STATUS[a.status].variant}>{STATUS[a.status].label}</Badge>
      {a.atendimento !== "particular" && <Badge variant="outline">{a.atendimento === "pro_bono" ? "Pro bono" : "Convênio"}</Badge>}
      {a.package_id && <Badge variant="outline">Pacote</Badge>}
      {a.status === "realizado" && a.prontuario !== null && (
        <Badge variant={a.prontuario ? "default" : "outline"} className={a.prontuario ? "" : "border-amber-500 text-amber-700 dark:text-amber-400"}>
          {a.prontuario ? "Prontuário preenchido" : "Prontuário pendente"}
        </Badge>
      )}
      <Button size="sm" variant="outline" onClick={() => setDetail(a.id)}>
        Abrir
      </Button>
    </div>
  );

  // "Nova sessão" e "Bloquear horário" começam no dia selecionado no calendário
  const baseDate = selected;
  const detailAppt = (appts.data ?? []).find((a) => a.id === detail) ?? null;

  const step = (n: number) => (view === "dia" ? goTo(toDateStr(addDays(new Date(`${selected}T12:00:00`), n))) : shiftWeek(n));
  const rangeLabel = view === "dia" ? dayLabel(selected) : `${days[0]!.split("-").reverse().slice(0, 2).join("/")} a ${days[6]!.split("-").reverse().slice(0, 2).join("/")}`;

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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <aside className="w-full shrink-0 space-y-2 lg:w-64">
        <MiniCalendar selected={selected} marked={marked} month={month} onMonth={setMonth} onSelect={goTo} />
        <p className="px-1 text-xs text-muted-foreground">Os pontos marcam os dias com sessões. Clique em um dia para abri-lo na agenda.</p>
      </aside>
      <div className="min-w-0 flex-1 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label={view === "dia" ? "Dia anterior" : "Semana anterior"} onClick={() => step(-1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button variant="outline" onClick={() => goTo(toDateStr(new Date()))}>
          Hoje
        </Button>
        <Button variant="outline" size="icon" aria-label={view === "dia" ? "Próximo dia" : "Próxima semana"} onClick={() => step(1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        <span className="text-sm font-medium" aria-live="polite">
          {rangeLabel}
        </span>
        <div className="flex gap-1 ml-auto" role="group" aria-label="Modo de visualização">
          <Button size="sm" variant={view === "dia" ? "default" : "outline"} aria-pressed={view === "dia"} onClick={() => changeView("dia")}>
            <CalendarDays className="w-4 h-4 mr-1" /> Dia
          </Button>
          <Button size="sm" variant={view === "grade" ? "default" : "outline"} aria-pressed={view === "grade"} onClick={() => changeView("grade")}>
            <CalendarRange className="w-4 h-4 mr-1" /> Semana
          </Button>
          <Button size="sm" variant={view === "lista" ? "default" : "outline"} aria-pressed={view === "lista"} onClick={() => changeView("lista")}>
            <List className="w-4 h-4 mr-1" /> Lista
          </Button>
        </div>
        {!isPsi && (
          <NativeSelect aria-label="Filtrar por psicólogo" className="w-auto" value={pro} onChange={(e) => setPro(e.target.value)}>
            <option value="">Todos os psicólogos</option>
            {pros.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      {canRecord && (pending.data?.length ?? 0) > 0 && (
        <div role="status" className="space-y-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">
            Você tem {pending.data!.length} {pending.data!.length === 1 ? "sessão realizada sem prontuário" : "sessões realizadas sem prontuário"}.
          </p>
          <ul className="divide-y">
            {pending.data!.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-1.5">
                <span>
                  {new Date(p.starts_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} {hhmm(p.starts_at)} · {patientName.get(p.patient_id) ?? "Paciente"}
                </span>
                <Button size="sm" variant="outline" onClick={() => navigate(`/pacientes/${p.patient_id}/atendimento/${p.id}`)}>
                  Preencher
                </Button>
              </li>
            ))}
          </ul>
          {pending.data!.length > 5 && <p className="text-xs text-muted-foreground">E mais {pending.data!.length - 5}. Preencha estas para ver as demais.</p>}
        </div>
      )}
      {appts.isError && <p className="text-sm text-destructive">{errMsg(appts.error, "Não foi possível carregar a agenda.")}</p>}

      {view === "dia" ? (
        <WeekGrid
          selected={selected}
          days={[selected]}
          appts={appts.data ?? []}
          blocks={blocks.data ?? []}
          patientName={patientName}
          showFree={isPsi || !!pro}
          onSelect={(a) => setDetail(a.id)}
          onPickSlot={pickSlot}
          detail={(a) => [patientById.get(a.patient_id)?.telefone, !isPsi ? proName.get(a.professional_id) : null].filter(Boolean).join(" · ")}
        />
      ) : view === "grade" ? (
        <>
          {!isPsi && !pro && <p className="text-xs text-muted-foreground">Escolha um psicólogo no filtro para ver os horários livres de cada dia (8h às 18h). Clique em um horário vazio para marcar uma sessão.</p>}
          <WeekGrid selected={selected} days={days} appts={appts.data ?? []} blocks={blocks.data ?? []} patientName={patientName} showFree={isPsi || !!pro} onSelect={(a) => setDetail(a.id)} onPickSlot={pickSlot} />
        </>
      ) : (
      <div className="space-y-3">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const dayBlocks = blocksByDay.get(d) ?? [];
          return (
            <section key={d} aria-label={dayLabel(d)} className={`rounded-xl border bg-card ${d === selected ? "ring-2 ring-primary" : ""}`}>
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
                    return (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {hhmm(a.starts_at)}–{hhmm(a.ends_at)} ·{" "}
                            <Link to={`/pacientes/${a.patient_id}`} className="text-primary hover:underline">
                              {patientName.get(a.patient_id) ?? "Paciente"}
                            </Link>
                          </p>
                          {patientById.get(a.patient_id)?.observacoes && <p className="text-xs italic text-amber-700 dark:text-amber-400">Obs.: {patientById.get(a.patient_id)!.observacoes}</p>}
                          <p className="text-xs text-muted-foreground">
                            {!isPsi && proName.get(a.professional_id) ? `${proName.get(a.professional_id)} · ` : ""}
                            {a.valor ? brl(Math.round(a.valor * 100)) : "sem valor"}
                            {a.series_id ? " · semanal" : ""}
                          </p>
                        </div>
                        {badges(a)}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      )}

      </div>
      </div>

      <ChangeHistory table="appointments" rowId={history} open={!!history} onClose={() => setHistory(null)} title="Histórico da sessão" />
      <BlockDialog open={blocking} onClose={() => setBlocking(false)} pros={pros.data ?? []} defaultDate={baseDate} />
      <SessionDialog
        appointment={null}
        open={creating}
        onClose={() => {
          setCreating(false);
          setSlot(null);
        }}
        patients={patients.data ?? []}
        pros={pros.data ?? []}
        defaultDate={slot?.date ?? baseDate}
        defaultTime={slot?.time}
        defaultProfessional={pro}
      />
      <SessionDialog appointment={editing} open={!!editing} onClose={() => setEditing(null)} patients={patients.data ?? []} pros={pros.data ?? []} defaultDate={toDateStr(new Date())} />
      <SessionCard
        appt={detailAppt}
        patient={detailAppt ? patientById.get(detailAppt.patient_id) : undefined}
        patientName={detailAppt ? (patientName.get(detailAppt.patient_id) ?? "Paciente") : ""}
        proName={!isPsi && detailAppt ? proName.get(detailAppt.professional_id) : undefined}
        busy={setStatus.isPending}
        onClose={() => setDetail(null)}
        onStatus={(a, status, falta) => setStatus.mutate({ a, status, falta })}
        onReschedule={openEdit}
        onHistory={(a) => openHistory(a.id)}
      />
    </div>
  );
}
