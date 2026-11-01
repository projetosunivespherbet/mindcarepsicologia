import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { dateBR, brl, monthLabel } from "@/lib/money";
import type { Professional } from "@/lib/types";

interface ReceitaSaude {
  mes: string;
  profissional: { id: string; nome: string; crp: string | null; cpf_cadastrado: boolean };
  avisos: string[];
  resumo: { pagamentos: number; prontos: number; com_pendencia: number; total_centavos: number };
  linhas: { payment_id: string; data: string; valor_centavos: number; paciente: string; pagador: string; problemas: string[] }[];
  arquivos: { nome: string; linhas: number; csv: string }[];
}

function saveCsv(nome: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** Gera o arquivo de lote do Receita Saúde (recibos do Carnê-Leão) com os pagamentos do mês. O envio é feito pelo profissional no e-CAC. */
export function ReceitaSaudeCard({ ym }: { ym: string }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [pro, setPro] = useState("");
  const [requested, setRequested] = useState<string | null>(null);
  const key = `${ym}|${pro}`;

  const pros = useQuery({ queryKey: ["professionals"], queryFn: () => api<Professional[]>("/professionals"), enabled: isAdmin });
  const result = useQuery({
    queryKey: ["receita-saude", ym, pro],
    enabled: requested === key && (!isAdmin || !!pro),
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => api<ReceitaSaude>(`/finance/receita-saude?month=${ym}${isAdmin ? `&professional_id=${pro}` : ""}`),
  });
  const r = requested === key ? result.data : undefined;
  const pendentes = r?.linhas.filter((l) => l.problemas.length > 0) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Receita Saúde</CardTitle>
        <CardDescription>
          Gera o arquivo CSV de recibos do mês ({monthLabel(`${ym}-01`)}) para importar no e-CAC, em Carnê-Leão &gt; Escrituração &gt; Importar Escrituração. Entram só pagamentos de pessoa física recebidos pelo
          próprio psicólogo, fora de convênio e sem estorno. O envio à Receita é feito por você.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
            <NativeSelect aria-label="Psicólogo do Receita Saúde" className="w-auto" value={pro} onChange={(e) => setPro(e.target.value)}>
              <option value="">Escolha o psicólogo</option>
              {pros.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </NativeSelect>
          )}
          <Button variant="outline" disabled={(isAdmin && !pro) || result.isFetching} onClick={() => setRequested(key)}>
            {result.isFetching ? "Conferindo..." : "Conferir o mês"}
          </Button>
        </div>

        {requested === key && result.isError && <p className="text-sm text-destructive">{errMsg(result.error)}</p>}

        {r && (
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-medium">{r.profissional.nome}</span>: {r.resumo.pagamentos} {r.resumo.pagamentos === 1 ? "pagamento" : "pagamentos"} no mês, {r.resumo.prontos} pronto(s) para o arquivo
              ({brl(r.resumo.total_centavos)}) e {r.resumo.com_pendencia} com pendência.
            </p>
            {r.avisos.map((a) => (
              <p key={a} className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2">
                {a}. Nenhuma linha é gerada até corrigir.
              </p>
            ))}
            {pendentes.length > 0 && (
              <ul className="divide-y rounded-xl border">
                {pendentes.map((l) => (
                  <li key={l.payment_id} className="p-2">
                    {dateBR(l.data)} · {brl(l.valor_centavos)} · {l.paciente}: <span className="text-destructive">{l.problemas.join("; ")}</span>
                  </li>
                ))}
              </ul>
            )}
            {r.arquivos.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {r.arquivos.map((f) => (
                  <Button key={f.nome} onClick={() => saveCsv(f.nome, f.csv)}>
                    <Download className="w-4 h-4 mr-2" /> Baixar {f.nome} ({f.linhas} {f.linhas === 1 ? "linha" : "linhas"})
                  </Button>
                ))}
                <p className="text-xs text-muted-foreground w-full">No e-CAC use primeiro a análise do arquivo: ela mostra os erros antes de você clicar em Importar.</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
