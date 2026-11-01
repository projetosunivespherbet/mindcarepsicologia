import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { dayKey, dayLabel, hhmm } from "@/lib/dates";
import { downloadIcs, icsContent, reminderText, whatsappNumber, whatsappUrl } from "@/lib/reminder";
import type { Appointment, AppointmentStatus, Patient } from "@/lib/types";
import { formatCns, formatCpf } from "@shared/documents";

export const STATUS: Record<AppointmentStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  agendado: { label: "Agendado", variant: "secondary" },
  confirmado: { label: "Confirmado", variant: "outline" },
  realizado: { label: "Realizado", variant: "default" },
  faltou: { label: "Faltou", variant: "destructive" },
  cancelado: { label: "Cancelado", variant: "destructive" },
};

const quando = (iso: string) => `${new Date(iso).toLocaleDateString("pt-BR")} às ${hhmm(iso)}`;

function idade(nasc: string): string {
  const n = new Date(`${nasc}T12:00:00`);
  const hoje = new Date();
  let anos = hoje.getFullYear() - n.getFullYear();
  if (hoje.getMonth() < n.getMonth() || (hoje.getMonth() === n.getMonth() && hoje.getDate() < n.getDate())) anos--;
  return `${nasc.split("-").reverse().join("/")} (${anos} anos)`;
}

function Info({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <>
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="break-words">{valor || <span className="text-muted-foreground">não informado</span>}</dd>
    </>
  );
}

/** Card da sessão (como no PEC e-SUS): dados e contatos do paciente, quando foi agendada e as duas ações principais. */
export function SessionCard({
  appt,
  patient,
  patientName,
  proName,
  busy,
  onClose,
  onStatus,
  onReschedule,
  onHistory,
}: {
  appt: Appointment | null;
  patient?: Patient;
  patientName: string;
  proName?: string;
  busy: boolean;
  onClose: () => void;
  onStatus: (a: Appointment, status: AppointmentStatus) => void;
  onReschedule: (a: Appointment) => void;
  onHistory: (a: Appointment) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const a = appt;
  const author = !!a && a.prontuario !== null; // só o psicólogo da sessão enxerga o prontuário
  const open = !!a && (a.status === "agendado" || a.status === "confirmado");
  const started = !!a && new Date(a.starts_at).getTime() <= Date.now();
  const wait = started ? undefined : "Disponível a partir do horário de início da sessão";
  const phone = whatsappNumber(patient?.telefone);
  const atender = a ? `/pacientes/${a.patient_id}/atendimento/${a.id}` : "";

  return (
    <Dialog open={!!a} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {a && (
          <>
            <DialogHeader>
              <DialogTitle>{patientName}</DialogTitle>
              <DialogDescription>
                {dayLabel(dayKey(a.starts_at))} · {hhmm(a.starts_at)}–{hhmm(a.ends_at)}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS[a.status].variant}>{STATUS[a.status].label}</Badge>
              {a.atendimento !== "particular" && <Badge variant="outline">{a.atendimento === "pro_bono" ? "Pro bono" : "Convênio"}</Badge>}
              {a.status === "realizado" && a.valor ? <Badge variant={a.payment_status === "pago" ? "default" : "outline"}>{a.payment_status === "pago" ? "Pago" : "A receber"}</Badge> : null}
              {a.status === "realizado" && a.atendimento === "particular" && (
                <Badge variant={a.nota_status === "emitida" ? "default" : "secondary"}>
                  {a.nota_status === "emitida" ? "Nota emitida" : a.nota_status === "rascunho" ? "Nota em rascunho" : "Sem nota"}
                </Badge>
              )}
              {a.status === "realizado" && a.prontuario !== null && (
                <Badge variant={a.prontuario ? "default" : "outline"} className={a.prontuario ? "" : "border-amber-500 text-amber-700 dark:text-amber-400"}>
                  {a.prontuario ? "Prontuário preenchido" : "Prontuário pendente"}
                </Badge>
              )}
            </div>

            <section aria-label="Dados do paciente" className="rounded-lg border bg-muted/30 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Paciente</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <Info rotulo="Nascimento" valor={patient?.data_nascimento ? idade(patient.data_nascimento) : null} />
                <Info rotulo="Telefone" valor={patient?.telefone} />
                <Info rotulo="E-mail" valor={patient?.email} />
                <Info rotulo="CPF" valor={patient?.cpf ? formatCpf(patient.cpf) : null} />
                <Info rotulo="CNS" valor={patient?.cns ? formatCns(patient.cns) : null} />
              </dl>
            </section>

            <section aria-label="Agendamento" className="text-sm">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agendamento</h3>
              <p>
                Agendada em {quando(a.created_at)}
                {a.agendado_por ? ` por ${a.agendado_por}` : ""}
              </p>
              {proName && <p>Psicólogo: {proName}</p>}
            </section>

            <div className="flex flex-wrap gap-2 border-t pt-3">
              {author && (open || a.status === "realizado" || a.status === "faltou") && (
                <Button className="flex-1" variant={open ? "default" : a.prontuario ? "outline" : "default"} disabled={open && !started} title={open ? wait : undefined} onClick={() => navigate(atender)}>
                  {open ? "Atender" : a.prontuario ? "Abrir prontuário" : "Preencher prontuário"}
                </Button>
              )}
              {open && (
                <Button className="flex-1" variant="outline" disabled={busy} onClick={() => onStatus(a, "cancelado")}>
                  Cancelar consulta
                </Button>
              )}
            </div>
            {open && !started && author && <p className="-mt-1 text-xs text-muted-foreground">O atendimento pode ser iniciado a partir do horário da sessão.</p>}

            <div className="flex flex-wrap items-center gap-1 text-sm">
              {open && a.status === "agendado" && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus(a, "confirmado")}>
                  Confirmar
                </Button>
              )}
              {open && (
                <Button size="sm" variant="ghost" disabled={busy || !started} title={wait} onClick={() => onStatus(a, "faltou")}>
                  Faltou
                </Button>
              )}
              {open && !author && (
                <Button size="sm" variant="ghost" disabled={busy || !started} title={wait} onClick={() => onStatus(a, "realizado")}>
                  Marcar como realizada
                </Button>
              )}
              {a.status !== "cancelado" && (
                <Button size="sm" variant="ghost" onClick={() => onReschedule(a)}>
                  Remarcar
                </Button>
              )}
              {open && phone && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => window.open(whatsappUrl(phone, reminderText({ paciente: patientName, clinica: user?.clinic_nome ?? "", starts_at: a.starts_at, ends_at: a.ends_at })), "_blank", "noopener")}
                >
                  Lembrete (WhatsApp)
                </Button>
              )}
              {open && (
                <Button size="sm" variant="ghost" onClick={() => downloadIcs(`sessao-${dayKey(a.starts_at)}.ics`, icsContent({ id: a.id, clinica: user?.clinic_nome ?? "", starts_at: a.starts_at, ends_at: a.ends_at }))}>
                  Arquivo de agenda
                </Button>
              )}
              {author && a.status === "realizado" && (
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/documentos/novo?paciente=${a.patient_id}&tipo=declaracao&inicio=${encodeURIComponent(a.starts_at)}&fim=${encodeURIComponent(a.ends_at)}`}>Declaração de comparecimento</Link>
                </Button>
              )}
              <Button asChild size="sm" variant="ghost">
                <Link to={`/pacientes/${a.patient_id}`}>Ficha do paciente</Link>
              </Button>
              {user?.role === "admin" && (
                <Button size="sm" variant="ghost" onClick={() => onHistory(a)}>
                  Histórico
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
