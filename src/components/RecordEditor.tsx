import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errMsg } from "@/lib/api";
import { avisoRealizada, marcarRealizada } from "@/lib/session";
import type { AppointmentStatus, Atendimento } from "@/lib/types";

export interface SessionRecord {
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

/** Tela de atendimento: o prontuário ocupa a maior parte; as anotações privativas ficam ao lado, só do profissional. */
export function RecordEditor({ rec, onSaved }: { rec: SessionRecord; onSaved: () => void }) {
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
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(false);
      }}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-1">
          <Label htmlFor="pr-conteudo" className="text-base font-semibold">
            Prontuário da sessão
          </Label>
          <p className="text-xs text-muted-foreground">
            Registro formal e sintético: demanda, intervenções, evolução e encaminhamentos. O paciente ou o responsável legal pode pedir cópia.
          </p>
          <Textarea id="pr-conteudo" className="min-h-[26rem]" maxLength={20000} value={conteudo} onChange={(e) => setConteudo(e.target.value)} placeholder="Evolução da sessão, objetivos trabalhados, encaminhamentos." />
        </div>
        <div className="space-y-1 rounded-lg border border-dashed p-3 lg:self-start">
          <Label htmlFor="pr-anot" className="font-semibold">
            Anotações privativas
          </Label>
          <p className="text-xs text-muted-foreground">
            Só você lê. Hipóteses, impressões subjetivas, falas transcritas e manejo clínico. Só vão para o documento do prontuário se você escolher.
          </p>
          <Textarea id="pr-anot" className="min-h-[14rem]" maxLength={20000} value={anotacoes} onChange={(e) => setAnotacoes(e.target.value)} placeholder="Registro documental pessoal." />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={rec.status === "realizado" ? "default" : "secondary"} className="capitalize">
          {rec.status}
        </Badge>
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
