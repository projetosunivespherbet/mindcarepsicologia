import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import type { Appointment } from "@/lib/types";

export type Cobranca = "criada" | "pro-bono" | "ja-existia" | "sem-valor";

/** Marca a sessão como realizada e gera a cobrança (se houver valor e não for pro bono). */
export async function marcarRealizada(a: Pick<Appointment, "id" | "patient_id" | "atendimento">): Promise<Cobranca> {
  await api(`/appointments/${a.id}`, { method: "PATCH", body: { status: "realizado" } });
  if (a.atendimento === "pro_bono") return "pro-bono";
  try {
    await api("/charges", { body: { patient_id: a.patient_id, appointment_id: a.id } });
    return "criada";
  } catch (e) {
    return e instanceof ApiError && e.status === 409 ? "ja-existia" : "sem-valor";
  }
}

export function avisoRealizada(c: Cobranca) {
  if (c === "criada") toast.success("Sessão realizada e cobrança criada");
  else if (c === "pro-bono") toast.success("Sessão pro bono registrada, sem cobrança");
  else if (c === "sem-valor") toast.warning("Sessão realizada, mas a cobrança não foi criada. Use Remarcar para informar o valor.");
  else toast.success("Sessão realizada");
}
