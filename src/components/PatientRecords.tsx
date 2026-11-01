import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errMsg } from "@/lib/api";
import { hhmm } from "@/lib/dates";
import { avisoRealizada, marcarRealizada } from "@/lib/session";
import type { Atendimento, AppointmentStatus } from "@/lib/types";

interface SessionRecord {
  appointment_id: string;
  patient_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  atendimento: Atendimento;
  conteudo: string;
  anotacoes: string;
  updated_at: string | null;
}

const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
const resumo = (t: string) => (t.length > 140 ? `${t.slice(0, 140)}…` : t);

function Editor({ rec, onSaved }: { rec: SessionRecord; onSaved: () => void }) {
  const qc = useQueryClient();
  const [conteudo, setConteudo] = useState(rec.conteudo);
  const [anotacoes, setAnotacoes] = useState(rec.anotacoes);
  useEffect(() => {
    setConteudo(rec.conteudo);
    setAnotacoes(rec.anotacoes);
  }, [rec.appointment_id, rec.conteudo, rec.anotacoes]);

  const aberta = rec.status === "agendado" || rec.status === "confirmado";
  const save = useMutation({
    mutationFn: async (concluir: boolean) => {
      const body: { conteudo?: string; anotacoes: string } = { anotacoes };
      if (conteudo.trim()) body.conteudo = conteudo;
      else if (rec.conteudo) throw new Error("O prontuário não pode ficar em branco");
      else if (!anotacoes.trim() && !rec.anotacoes) throw new Error("Escreva o prontuário ou uma anotação privativa");
      await api(`/appointments/${rec.appointment_id}/record`, { method: "PUT", body });
      return concluir ? await marcarRealizada({ id: rec.appointment_id, patient_id: rec.patient_id, atendimento: rec.atendimento }) : null;
    },
    onSuccess: (cobranca) => {
      if (cobranca) avisoRealizada(cobranca);
      else toast.success("Registro salvo");
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      void qc.invalidateQueries({ queryKey: ["pending-records"] });
      void qc.invalidateQueries({ queryKey: ["charges"] });
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error && !("status" in e) ? e.message : errMsg(e)),
  });

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(false);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          Sessão de {dia(rec.starts_at)}, {hhmm(rec.starts_at)}–{hhmm(rec.ends_at)}
        </h3>
        <Badge variant={rec.status === "realizado" ? "default" : "secondary"} className="capitalize">
          {rec.status}
        </Badge>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pr-conteudo">Prontuário da sessão</Label>
        <p className="text-xs text-muted-foreground">
          Registro formal e sintético: demanda, intervenções, evolução e encaminhamentos. O paciente ou o responsável legal pode pedir cópia.
        </p>
        <Textarea id="pr-conteudo" rows={8} maxLength={20000} value={conteudo} onChange={(e) => setConteudo(e.target.value)} placeholder="Evolução da sessão, objetivos trabalhados, encaminhamentos." />
      </div>
      <div className="space-y-1 rounded-lg border border-dashed p-3">
        <Label htmlFor="pr-anot">Anotações privativas</Label>
        <p className="text-xs text-muted-foreground">
          Só você lê. Para hipóteses, impressões subjetivas, falas transcritas e manejo clínico que não vão para o prontuário oficial.
        </p>
        <Textarea id="pr-anot" rows={6} maxLength={20000} value={anotacoes} onChange={(e) => setAnotacoes(e.target.value)} placeholder="Registro documental pessoal." />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Salvando..." : "Salvar"}
        </Button>
        {aberta && (
          <Button type="button" variant="outline" disabled={save.isPending} onClick={() => save.mutate(true)}>
            Salvar e concluir atendimento
          </Button>
        )}
        {rec.status === "realizado" && (
          <Button asChild type="button" variant="ghost">
            <Link to={`/documentos/novo?paciente=${rec.patient_id}&tipo=declaracao&inicio=${encodeURIComponent(rec.starts_at)}&fim=${encodeURIComponent(rec.ends_at)}`}>Declaração de comparecimento</Link>
          </Button>
        )}
      </div>
    </form>
  );
}

/** Histórico clínico do paciente com este profissional: lê, escreve e revisa prontuário e anotações privativas por sessão. */
export function PatientRecords({ patientId }: { patientId: string }) {
  const [params, setParams] = useSearchParams();
  const sessao = params.get("sessao");
  // Dado clínico: não fica em cache depois que a tela fecha.
  const q = useQuery({
    queryKey: ["patient-records", patientId],
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => api<SessionRecord[]>(`/patients/${patientId}/records`),
  });
  const list = q.data ?? [];
  const current = list.find((r) => r.appointment_id === sessao) ?? list[0];
  const pick = (id: string) => setParams((p) => ({ ...Object.fromEntries(p), sessao: id }), { replace: true });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (q.isError) return <p className="text-sm text-destructive">{errMsg(q.error)}</p>;
  if (list.length === 0) return <p className="text-sm text-muted-foreground">Ainda não há sessões iniciadas com este paciente. O prontuário fica disponível a partir do horário da sessão.</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div>{current && <Editor key={current.appointment_id} rec={current} onSaved={() => void q.refetch()} />}</div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Histórico de sessões</h3>
        <ul className="divide-y rounded-xl border bg-card">
          {list.map((r) => (
            <li key={r.appointment_id}>
              <button
                type="button"
                onClick={() => pick(r.appointment_id)}
                aria-current={r.appointment_id === current?.appointment_id}
                className={`block w-full p-3 text-left text-sm hover:bg-muted/50 ${r.appointment_id === current?.appointment_id ? "bg-primary/5" : ""}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {dia(r.starts_at)} · {hhmm(r.starts_at)}
                  </span>
                  <Badge variant={r.conteudo ? "default" : "outline"} className={r.conteudo ? "" : "border-amber-500 text-amber-700 dark:text-amber-400"}>
                    {r.conteudo ? "Preenchido" : "Pendente"}
                  </Badge>
                </span>
                {r.conteudo && <span className="mt-1 block text-xs text-muted-foreground">{resumo(r.conteudo)}</span>}
                {r.anotacoes && <span className="mt-1 block text-xs italic text-muted-foreground">+ anotações privativas</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
