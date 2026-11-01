import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CircleDollarSign, FileText, Gauge, Target, Undo2, Wallet } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { brl } from "@/lib/money";
import type { TimelineItem } from "@/lib/types";
import { ESCALAS, faixa, type EscalaKey } from "@shared/scales";

const SESSAO: Record<string, string> = { agendado: "Sessão agendada", confirmado: "Sessão confirmada", realizado: "Sessão realizada", faltou: "Falta", cancelado: "Sessão cancelada" };
const META: Record<string, string> = { ativa: "em andamento", alcancada: "alcançada", suspensa: "suspensa" };
const METODO: Record<string, string> = { pix: "Pix", dinheiro: "dinheiro", cartao: "cartão", transferencia: "transferência", boleto: "boleto", convenio: "convênio", outro: "outro" };

function descrever(it: TimelineItem): { icone: ReactNode; texto: string; tom?: "ruim" } {
  switch (it.tipo) {
    case "sessao":
      return { icone: <CalendarCheck className="h-4 w-4" />, texto: SESSAO[it.titulo ?? ""] ?? "Sessão", tom: it.titulo === "faltou" ? "ruim" : undefined };
    case "cobranca":
      return { icone: <CircleDollarSign className="h-4 w-4" />, texto: `Cobrança: ${it.titulo ?? ""} · ${brl(it.valor_centavos ?? 0)}${it.detalhe === "cancelada" ? " (cancelada)" : ""}` };
    case "pagamento":
      return { icone: <Wallet className="h-4 w-4" />, texto: `Pagamento de ${brl(it.valor_centavos ?? 0)} por ${METODO[it.titulo ?? ""] ?? it.titulo}` };
    case "estorno":
      return { icone: <Undo2 className="h-4 w-4" />, texto: `Estorno de ${brl(it.valor_centavos ?? 0)}`, tom: "ruim" };
    case "documento":
      return { icone: <FileText className="h-4 w-4" />, texto: `Documento emitido: ${it.titulo ?? ""}${it.detalhe ? ` nº ${it.detalhe}` : ""}` };
    case "meta":
      return { icone: <Target className="h-4 w-4" />, texto: `Meta: ${it.titulo ?? ""} (${META[it.detalhe ?? ""] ?? ""})` };
    case "escala": {
      const k = it.titulo as EscalaKey;
      return { icone: <Gauge className="h-4 w-4" />, texto: `${ESCALAS[k]?.nome ?? it.titulo}: ${it.valor_centavos} pontos (${faixa(k, it.valor_centavos ?? 0)})` };
    }
  }
}

/** Tudo o que aconteceu com o paciente, do mais recente ao mais antigo, agrupado por mês. */
export function PatientTimeline({ patientId }: { patientId: string }) {
  const q = useQuery({ queryKey: ["timeline", patientId], gcTime: 0, queryFn: () => api<TimelineItem[]>(`/patients/${patientId}/timeline`) });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (q.isError) return <p className="text-sm text-destructive">{errMsg(q.error)}</p>;
  const itens = q.data ?? [];
  if (itens.length === 0) return <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>;
  const meses = new Map<string, TimelineItem[]>();
  for (const it of itens) {
    const m = new Date(it.quando).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    meses.set(m, [...(meses.get(m) ?? []), it]);
  }
  const agora = Date.now();
  return (
    <div className="space-y-5">
      {[...meses.entries()].map(([mes, lista]) => (
        <section key={mes} aria-label={mes}>
          <h3 className="mb-2 text-sm font-semibold first-letter:uppercase">{mes}</h3>
          <ol className="relative space-y-3 border-l pl-5">
            {lista.map((it) => {
              const d = descrever(it);
              const futuro = new Date(it.quando).getTime() > agora;
              return (
                <li key={`${it.tipo}-${it.ref}-${it.quando}`} className="relative">
                  <span className={`absolute -left-[1.85rem] flex h-6 w-6 items-center justify-center rounded-full border bg-background ${d.tom === "ruim" ? "text-destructive" : "text-primary"}`}>{d.icone}</span>
                  <p className={`text-sm ${futuro ? "text-muted-foreground" : ""}`}>
                    {d.texto}
                    {futuro ? " (próxima)" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(it.quando).toLocaleDateString("pt-BR")} às {new Date(it.quando).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
