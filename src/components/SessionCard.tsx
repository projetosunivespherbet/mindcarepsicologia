import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { dayKey, dayLabel, hhmm } from "@/lib/dates";
import { downloadIcs, icsContent, reminderText, whatsappNumber, whatsappUrl } from "@/lib/reminder";
import type { Appointment, AppointmentStatus, Patient } from "@/lib/types";

export const STATUS: Record<AppointmentStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  agendado: { label: "Agendado", variant: "secondary" },
  confirmado: { label: "Confirmado", variant: "outline" },
  realizado: { label: "Realizado", variant: "default" },
  faltou: { label: "Faltou", variant: "destructive" },
  cancelado: { label: "Cancelado", variant: "destructive" },
};

const quando = (iso: string) => `${new Date(iso).toLocaleDateString("pt-BR")} às ${hhmm(iso)}`;

function Group({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}

/** Card da sessão na agenda: quem é, contato, quando foi marcada e o que fazer — com uma ação principal. */
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
  const ficha = a ? `/pacientes/${a.patient_id}?sessao=${a.id}` : "";

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

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Telefone</dt>
              <dd>{patient?.telefone || "não informado"}</dd>
              <dt className="text-muted-foreground">E-mail</dt>
              <dd className="break-all">{patient?.email || "não informado"}</dd>
              {proName && (
                <>
                  <dt className="text-muted-foreground">Psicólogo</dt>
                  <dd>{proName}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Agendada em</dt>
              <dd>
                {quando(a.created_at)}
                {a.agendado_por ? ` por ${a.agendado_por}` : ""}
              </dd>
            </dl>

            {author && (a.status === "realizado" || a.status === "faltou" || open) && (
              <div className="border-t pt-3">
                {open ? (
                  <Button className="w-full" disabled={!started} title={wait} onClick={() => navigate(ficha)}>
                    Iniciar atendimento
                  </Button>
                ) : (
                  <Button className="w-full" variant={a.prontuario ? "outline" : "default"} onClick={() => navigate(ficha)}>
                    {a.prontuario ? "Abrir prontuário" : "Preencher prontuário"}
                  </Button>
                )}
                {open && !started && <p className="mt-1 text-xs text-muted-foreground">O atendimento pode ser iniciado a partir do horário da sessão.</p>}
              </div>
            )}

            {open && (
              <Group titulo="Situação da sessão">
                {a.status === "agendado" && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus(a, "confirmado")}>
                    Confirmar
                  </Button>
                )}
                {!author && (
                  <Button size="sm" disabled={busy || !started} title={wait} onClick={() => onStatus(a, "realizado")}>
                    Marcar como realizada
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={busy || !started} title={wait} onClick={() => onStatus(a, "faltou")}>
                  Faltou
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus(a, "cancelado")}>
                  Cancelar
                </Button>
              </Group>
            )}

            <Group titulo="Outras ações">
              {a.status !== "cancelado" && (
                <Button size="sm" variant="ghost" onClick={() => onReschedule(a)}>
                  Remarcar
                </Button>
              )}
              {open && phone && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    window.open(whatsappUrl(phone, reminderText({ paciente: patientName, clinica: user?.clinic_nome ?? "", starts_at: a.starts_at, ends_at: a.ends_at })), "_blank", "noopener")
                  }
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
            </Group>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
