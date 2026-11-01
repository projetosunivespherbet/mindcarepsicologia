import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DetailDialog } from "@/components/PatientCharges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { dayKey, dayLabel, hhmm } from "@/lib/dates";
import { downloadIcs, icsContent, reminderText, whatsappNumber, whatsappUrl } from "@/lib/reminder";
import type { Appointment, AppointmentStatus, Patient, SessionPackage } from "@/lib/types";

export type FaltaModo = "pacote" | "cobrar" | "nada";
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
  onStatus: (a: Appointment, status: AppointmentStatus, falta?: FaltaModo) => void;
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
  const qc = useQueryClient();
  const [perguntaFalta, setPerguntaFalta] = useState(false);
  const [verCobranca, setVerCobranca] = useState<string | null>(null);
  const [obs, setObs] = useState<string | null>(null); // null = só leitura
  useEffect(() => {
    setPerguntaFalta(false);
    setObs(null);
  }, [a?.id]);
  const salvarObs = useMutation({
    mutationFn: () => api(`/patients/${a!.patient_id}`, { method: "PATCH", body: { observacoes: obs?.trim() || null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["patients-all"] });
      void qc.invalidateQueries({ queryKey: ["patients"] });
      void qc.invalidateQueries({ queryKey: ["patient", a!.patient_id] });
      toast.success("Observação salva");
      setObs(null);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const pacotes = useQuery({
    queryKey: ["packages", a?.patient_id],
    enabled: !!a && open,
    queryFn: () => api<SessionPackage[]>(`/packages?patient_id=${a!.patient_id}`),
  });
  const pacote = (pacotes.data ?? []).find((p) => p.status === "ativo" && p.saldo > 0 && p.professional_id === a?.professional_id);
  const podeCobrar = !!a && a.status !== "cancelado" && !a.charge_id && !a.package_id && a.atendimento !== "pro_bono";
  const cobrar = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/charges", { body: { patient_id: a!.patient_id, appointment_id: a!.id, vencimento: new Date(a!.starts_at).toLocaleDateString("sv-SE") } }),
    onSuccess: (ch) => {
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      void qc.invalidateQueries({ queryKey: ["charges"] });
      toast.success("Cobrança criada. Envie o Pix ao paciente.");
      setVerCobranca(ch.id);
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const abrirCobranca = (id: string) => {
    setVerCobranca(id);
    onClose();
  };

  return (
    <>
    <DetailDialog chargeId={verCobranca} onClose={() => setVerCobranca(null)} />
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
              {a.charge_id ? <Badge variant={a.payment_status === "pago" ? "default" : "outline"}>{a.payment_status === "pago" ? "Pago" : "Cobrança em aberto"}</Badge> : null}
              {a.package_id && <Badge variant="outline">Pacote</Badge>}
              {open && !a.package_id && pacote && <Badge variant="outline">Pacote: {pacote.saldo} de {pacote.sessoes} disponíveis</Badge>}
              {a.status === "realizado" && a.nota_status && (
                <Badge variant={a.nota_status === "emitida" ? "default" : "secondary"}>{a.nota_status === "emitida" ? "Nota emitida" : "Nota em rascunho"}</Badge>
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
                {patient?.responsavel_nome && (
                  <Info
                    rotulo="Responsável legal"
                    valor={`${patient.responsavel_nome}${patient.responsavel_vinculo ? ` (${patient.responsavel_vinculo})` : ""}${patient.responsavel_telefone ? ` · ${patient.responsavel_telefone}` : ""}`}
                  />
                )}
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

            <section aria-label="Observações sobre o paciente" className="text-sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Observações sobre o paciente</h3>
                {obs === null && (
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setObs(patient?.observacoes ?? "")}>
                    {patient?.observacoes ? "Editar" : "Adicionar"}
                  </Button>
                )}
              </div>
              {obs === null ? (
                <p className={patient?.observacoes ? "whitespace-pre-wrap" : "text-muted-foreground"}>{patient?.observacoes || "Nenhuma observação."}</p>
              ) : (
                <div className="space-y-2">
                  <Textarea aria-label="Observações sobre o paciente" rows={3} maxLength={1000} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: prefere contato por WhatsApp; vem com a mãe. Conteúdo clínico vai no prontuário." />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={salvarObs.isPending} onClick={() => salvarObs.mutate()}>
                      Salvar observação
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setObs(null)}>
                      Voltar
                    </Button>
                  </div>
                </div>
              )}
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
              {podeCobrar && !pacote && (
                <Button className="flex-1" variant="outline" disabled={cobrar.isPending} onClick={() => cobrar.mutate()}>
                  {cobrar.isPending ? "Gerando..." : "Cobrar agora"}
                </Button>
              )}
              {a.charge_id && (
                <Button className="flex-1" variant="outline" onClick={() => abrirCobranca(a.charge_id!)}>
                  Ver cobrança / Pix
                </Button>
              )}
            </div>
            {perguntaFalta && (
              <div role="group" aria-label="Cobrança da falta" className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">O paciente faltou. Como fica a cobrança?</p>
                <div className="flex flex-wrap gap-2">
                  {pacote && !a.charge_id && (
                    <Button size="sm" disabled={busy} onClick={() => onStatus(a, "faltou", "pacote")}>
                      Descontar do pacote
                    </Button>
                  )}
                  {!a.charge_id && a.atendimento !== "pro_bono" && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus(a, "faltou", "cobrar")}>
                      Cobrar a falta
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus(a, "faltou", "nada")}>
                    {a.charge_id ? "Manter a cobrança já gerada" : "Não cobrar"}
                  </Button>
                </div>
              </div>
            )}
            {open && !started && author && <p className="-mt-1 text-xs text-muted-foreground">O atendimento pode ser iniciado a partir do horário da sessão.</p>}

            <div className="flex flex-wrap items-center gap-1 text-sm">
              {open && a.status === "agendado" && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus(a, "confirmado")}>
                  Confirmar
                </Button>
              )}
              {open && (
                <Button size="sm" variant="ghost" disabled={busy || !started} title={wait} onClick={() => setPerguntaFalta(true)}>
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
    </>
  );
}
