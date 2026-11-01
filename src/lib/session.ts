import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import type { Appointment } from "@/lib/types";

export type Cobranca = "criada" | "pro-bono" | "ja-existia" | "sem-valor" | "pacote";

type Sessao = Pick<Appointment, "id" | "patient_id" | "atendimento" | "starts_at">;

/**
 * Lança a sessão no financeiro: desconta do pacote ativo (se houver saldo) ou gera a cobrança avulsa.
 * Se já tinha cobrança (cobrada antes) ou já estava no pacote, não duplica.
 */
export async function lancarSessao(a: Sessao): Promise<Cobranca> {
  if (a.atendimento === "pro_bono") return "pro-bono";
  try {
    await api("/packages/use", { body: { appointment_id: a.id } });
    return "pacote";
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return "ja-existia";
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  return cobrarAvulso(a);
}

/** Cobrança avulsa da sessão (antes ou depois de acontecer); vence no dia da sessão. */
export async function cobrarAvulso(a: Sessao): Promise<Cobranca> {
  try {
    await api("/charges", { body: { patient_id: a.patient_id, appointment_id: a.id, vencimento: new Date(a.starts_at).toLocaleDateString("sv-SE") } });
    return "criada";
  } catch (e) {
    return e instanceof ApiError && e.status === 409 ? "ja-existia" : "sem-valor";
  }
}

/** Marca a sessão como realizada e a lança no financeiro (pacote ou cobrança). */
export async function marcarRealizada(a: Sessao): Promise<Cobranca> {
  await api(`/appointments/${a.id}`, { method: "PATCH", body: { status: "realizado" } });
  return lancarSessao(a);
}

export function avisoRealizada(c: Cobranca) {
  if (c === "criada") toast.success("Sessão realizada e cobrança criada");
  else if (c === "pacote") toast.success("Sessão realizada e descontada do pacote");
  else if (c === "pro-bono") toast.success("Sessão pro bono registrada, sem cobrança");
  else if (c === "sem-valor") toast.warning("Sessão realizada, mas a cobrança não foi criada. Use Remarcar para informar o valor.");
  else toast.success("Sessão realizada");
}
