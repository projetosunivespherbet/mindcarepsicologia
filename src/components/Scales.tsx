import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { LineChart } from "@/components/LineChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";
import type { ScaleApplication } from "@/lib/types";
import { ESCALAS, OPCOES, alertaRisco, faixa, pontuar, type EscalaKey } from "@shared/scales";

const faixasDoGrafico = (k: EscalaKey) => {
  const f = ESCALAS[k].faixas;
  return f.map((x, i) => ({ de: i === 0 ? 0 : f[i - 1]!.ate, ate: x.ate, nome: x.nome }));
};

function Aplicar({ patientId, appointmentId, onDone }: { patientId: string; appointmentId?: string; onDone: () => void }) {
  const [escala, setEscala] = useState<EscalaKey | null>(null);
  const [resp, setResp] = useState<(number | null)[]>([]);
  const def = escala ? ESCALAS[escala] : null;
  const completas = !!def && resp.length === def.itens.length && resp.every((r) => r !== null);
  const total = pontuar(resp.map((r) => r ?? 0));
  const salvar = useMutation({
    mutationFn: () => api<ScaleApplication>(`/patients/${patientId}/scales`, { body: { escala, respostas: resp, appointment_id: appointmentId ?? null } }),
    onSuccess: (r) => {
      toast.success(`${ESCALAS[r.escala].nome}: ${r.pontuacao} pontos (${r.faixa})`);
      setEscala(null);
      onDone();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (!def) {
    return (
      <div className="flex flex-wrap gap-2">
        {(Object.keys(ESCALAS) as EscalaKey[]).map((k) => (
          <Button
            key={k}
            size="sm"
            variant="outline"
            onClick={() => {
              setEscala(k);
              setResp(Array(ESCALAS[k].itens.length).fill(null));
            }}
          >
            Aplicar {ESCALAS[k].nome}
          </Button>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div>
        <p className="font-medium">
          {def.nome} · {def.sobre}
        </p>
        <p className="text-sm text-muted-foreground">{def.pergunta}</p>
      </div>
      <ol className="space-y-3">
        {def.itens.map((item, i) => (
          <li key={i} className="space-y-1">
            <p className="text-sm">
              {i + 1}. {item}
            </p>
            <div role="radiogroup" aria-label={`Item ${i + 1}`} className="flex flex-wrap gap-1">
              {OPCOES.map((o, v) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={resp[i] === v}
                  onClick={() => setResp(resp.map((r, j) => (j === i ? v : r)))}
                  className={`rounded-md border px-2 py-1 text-xs ${resp[i] === v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {o} ({v})
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {escala && alertaRisco(escala, resp.map((r) => r ?? 0)) && (
        <p className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Item 9 positivo: avalie o risco de autolesão nesta sessão.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          Total: {total} de {def.max} · {faixa(def.key, total)}
        </span>
        <Button size="sm" disabled={!completas || salvar.isPending} onClick={() => salvar.mutate()}>
          Salvar escala
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEscala(null)}>
          Voltar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Instrumentos de rastreio de domínio público. Não substituem a avaliação clínica.</p>
    </div>
  );
}

/** Escalas de rastreio (PHQ-9, GAD-7): aplicação na sessão e o gráfico da pontuação ao longo do tempo. */
export function Scales({ patientId, appointmentId }: { patientId: string; appointmentId?: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["scales", patientId], gcTime: 0, queryFn: () => api<ScaleApplication[]>(`/patients/${patientId}/scales`) });
  const lista = q.data ?? [];
  return (
    <div className="space-y-4">
      <Aplicar patientId={patientId} appointmentId={appointmentId} onDone={() => void qc.invalidateQueries({ queryKey: ["scales", patientId] })} />
      {q.isError && <p className="text-sm text-destructive">{errMsg(q.error)}</p>}
      {(Object.keys(ESCALAS) as EscalaKey[]).map((k) => {
        const daEscala = lista.filter((s) => s.escala === k);
        if (daEscala.length === 0) return null;
        const ultima = daEscala.at(-1)!;
        return (
          <section key={k} className="space-y-2 rounded-xl border bg-card p-3" aria-label={ESCALAS[k].nome}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {ESCALAS[k].nome} · {ESCALAS[k].sobre}
              </p>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  Última: {ultima.pontuacao} · {ultima.faixa}
                </Badge>
                {ultima.alerta && <Badge variant="destructive">Item 9 positivo</Badge>}
              </div>
            </div>
            <LineChart rotulo={`Pontuação do ${ESCALAS[k].nome}`} max={ESCALAS[k].max} faixas={faixasDoGrafico(k)} pontos={daEscala.map((s) => ({ data: s.created_at, valor: s.pontuacao }))} />
          </section>
        );
      })}
    </div>
  );
}
