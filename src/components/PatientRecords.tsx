import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";
import { hhmm } from "@/lib/dates";
import { openPdfWindow } from "@/lib/pdfWindow";
import type { RecordExport } from "@/lib/recordPdf";
import type { SessionRecord } from "@/components/RecordEditor";

const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/** Histórico clínico do paciente com este profissional (dado sensível: sem cache depois de sair da tela). */
export function usePatientRecords(patientId: string) {
  return useQuery({
    queryKey: ["patient-records", patientId],
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => api<SessionRecord[]>(`/patients/${patientId}/records`),
  });
}

/** Leitura do histórico: cada sessão com prontuário e anotações privativas, para consulta durante o atendimento. */
export function RecordHistory({ list }: { list: SessionRecord[] }) {
  if (list.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma sessão anterior com este paciente.</p>;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {list.map((r) => (
        <li key={r.appointment_id}>
          <details className="group p-3">
            <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm">
              <span className="font-medium">
                {dia(r.starts_at)} · {hhmm(r.starts_at)}
              </span>
              <Badge variant={r.conteudo ? "default" : "outline"} className={r.conteudo ? "" : "border-amber-500 text-amber-700 dark:text-amber-400"}>
                {r.conteudo ? "Preenchido" : "Pendente"}
              </Badge>
            </summary>
            <div className="mt-2 space-y-2 text-sm">
              <p className="whitespace-pre-wrap">{r.conteudo || <span className="italic text-muted-foreground">Sem registro no prontuário.</span>}</p>
              {r.anotacoes && (
                <div className="rounded-lg border border-dashed p-2">
                  <p className="text-xs font-semibold text-muted-foreground">Anotações privativas</p>
                  <p className="whitespace-pre-wrap">{r.anotacoes}</p>
                </div>
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

/** Aba "Prontuário" da ficha: sessões com atalho para atender e a geração do documento do prontuário. */
export function PatientRecords({ patientId }: { patientId: string }) {
  const q = usePatientRecords(patientId);
  const list = q.data ?? [];
  const [incluir, setIncluir] = useState<Record<string, boolean>>({});
  const [privativas, setPrivativas] = useState<Record<string, boolean>>({});
  const escolhidas = list.filter((r) => incluir[r.appointment_id] ?? !!r.conteudo);

  const gerar = useMutation({
    mutationFn: async () => {
      const win = openPdfWindow(); // abre no clique; o PDF entra quando ficar pronto
      try {
        const dados = await api<RecordExport>(`/patients/${patientId}/records/export`, {
          body: { sessoes: escolhidas.map((r) => ({ id: r.appointment_id, anotacoes: !!privativas[r.appointment_id] && !!r.anotacoes })) },
        });
        const { renderRecordPdf } = await import("@/lib/recordPdf");
        const url = URL.createObjectURL(renderRecordPdf(dados).output("blob"));
        if (win) win.location.href = url;
        else window.open(url, "_blank");
      } catch (e) {
        win?.close();
        throw e;
      }
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (q.isError) return <p className="text-sm text-destructive">{errMsg(q.error)}</p>;
  if (list.length === 0) return <p className="text-sm text-muted-foreground">Ainda não há sessões iniciadas com este paciente. O prontuário fica disponível a partir do horário da sessão.</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Todo registro fica guardado, com a trilha de cada alteração. Para fornecer o prontuário, marque as sessões e, se quiser, quais anotações privativas acompanham o documento.
      </p>
      <ul className="divide-y rounded-xl border bg-card">
        {list.map((r) => (
          <li key={r.appointment_id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" aria-label={`Incluir a sessão de ${dia(r.starts_at)} no documento`} checked={incluir[r.appointment_id] ?? !!r.conteudo} disabled={!r.conteudo && !r.anotacoes} onChange={(e) => setIncluir({ ...incluir, [r.appointment_id]: e.target.checked })} />
              <span className="font-medium">
                {dia(r.starts_at)} · {hhmm(r.starts_at)}
              </span>
              <Badge variant={r.conteudo ? "default" : "outline"} className={r.conteudo ? "" : "border-amber-500 text-amber-700 dark:text-amber-400"}>
                {r.conteudo ? "Preenchido" : "Pendente"}
              </Badge>
            </label>
            <div className="flex items-center gap-3">
              {r.anotacoes && (
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" aria-label={`Incluir as anotações privativas de ${dia(r.starts_at)}`} checked={!!privativas[r.appointment_id]} onChange={(e) => setPrivativas({ ...privativas, [r.appointment_id]: e.target.checked })} />
                  incluir anotações privativas
                </label>
              )}
              <Button asChild size="sm" variant="outline">
                <Link to={`/pacientes/${patientId}/atendimento/${r.appointment_id}`}>Abrir</Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button disabled={escolhidas.length === 0 || gerar.isPending} onClick={() => gerar.mutate()}>
        {gerar.isPending ? "Gerando..." : "Gerar documento do prontuário"}
      </Button>
    </div>
  );
}
