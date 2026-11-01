import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { LineChart } from "@/components/LineChart";
import { NativeSelect } from "@/components/NativeSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errMsg } from "@/lib/api";
import type { TherapyGoal } from "@/lib/types";

const SITUACAO: Record<TherapyGoal["status"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  ativa: { label: "Em andamento", variant: "outline" },
  alcancada: { label: "Alcançada", variant: "default" },
  suspensa: { label: "Suspensa", variant: "secondary" },
};

function Avanco({ goal, appointmentId, onDone }: { goal: TherapyGoal; appointmentId?: string; onDone: () => void }) {
  const [nota, setNota] = useState("5");
  const [comentario, setComentario] = useState("");
  const salvar = useMutation({
    mutationFn: () => api(`/goals/${goal.id}/progress`, { body: { nota: Number(nota), comentario: comentario.trim() || null, appointment_id: appointmentId ?? null } }),
    onSuccess: () => {
      toast.success("Avanço registrado");
      setComentario("");
      onDone();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-2">
      <div className="space-y-1">
        <Label htmlFor={`nota-${goal.id}`} className="text-xs">
          Avanço (0 a 10)
        </Label>
        <NativeSelect id={`nota-${goal.id}`} className="w-24" value={nota} onChange={(e) => setNota(e.target.value)}>
          {Array.from({ length: 11 }, (_, i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="min-w-[12rem] flex-1 space-y-1">
        <Label htmlFor={`com-${goal.id}`} className="text-xs">
          Comentário (opcional)
        </Label>
        <Input id={`com-${goal.id}`} maxLength={500} value={comentario} onChange={(e) => setComentario(e.target.value)} />
      </div>
      <Button size="sm" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
        Registrar avanço
      </Button>
    </div>
  );
}

/** Plano terapêutico: metas do trabalho e o avanço registrado a cada sessão, com o gráfico da evolução. */
export function TherapyPlan({ patientId, appointmentId }: { patientId: string; appointmentId?: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["goals", patientId], gcTime: 0, queryFn: () => api<TherapyGoal[]>(`/patients/${patientId}/goals`) });
  const [nova, setNova] = useState(false);
  const [f, setF] = useState({ titulo: "", descricao: "" });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["goals", patientId] });

  const criar = useMutation({
    mutationFn: () => api(`/patients/${patientId}/goals`, { body: { titulo: f.titulo, descricao: f.descricao.trim() || null } }),
    onSuccess: () => {
      toast.success("Meta criada");
      setF({ titulo: "", descricao: "" });
      setNova(false);
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const situacao = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TherapyGoal["status"] }) => api(`/goals/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: refresh,
    onError: (e) => toast.error(errMsg(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    criar.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Objetivos do trabalho com o paciente. A cada sessão, registre de 0 a 10 quanto cada meta avançou.</p>
        <Button size="sm" variant="outline" onClick={() => setNova(!nova)}>
          <Plus className="mr-1 h-4 w-4" /> Nova meta
        </Button>
      </div>
      {nova && (
        <form onSubmit={submit} className="space-y-2 rounded-xl border p-3">
          <div className="space-y-1">
            <Label htmlFor="meta-titulo">Meta</Label>
            <Input id="meta-titulo" required minLength={2} maxLength={200} placeholder="Ex.: reduzir crises de ansiedade" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="meta-desc">Como saber que foi alcançada (opcional)</Label>
            <Textarea id="meta-desc" rows={2} maxLength={2000} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
          </div>
          <Button type="submit" size="sm" disabled={criar.isPending}>
            Salvar meta
          </Button>
        </form>
      )}
      {q.isError && <p className="text-sm text-destructive">{errMsg(q.error)}</p>}
      {q.data?.length === 0 && !nova && <p className="text-sm text-muted-foreground">Nenhuma meta ainda.</p>}
      <ul className="space-y-3">
        {q.data?.map((g) => (
          <li key={g.id} className="space-y-2 rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{g.titulo}</p>
                {g.descricao && <p className="text-xs text-muted-foreground">{g.descricao}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={SITUACAO[g.status].variant}>{SITUACAO[g.status].label}</Badge>
                <NativeSelect aria-label={`Situação de ${g.titulo}`} className="h-8 w-auto text-xs" value={g.status} onChange={(e) => situacao.mutate({ id: g.id, status: e.target.value as TherapyGoal["status"] })}>
                  <option value="ativa">Em andamento</option>
                  <option value="alcancada">Alcançada</option>
                  <option value="suspensa">Suspensa</option>
                </NativeSelect>
              </div>
            </div>
            {g.avancos.length > 0 && <LineChart rotulo={`Evolução da meta ${g.titulo}`} max={10} pontos={g.avancos.map((a) => ({ data: a.created_at, valor: a.nota }))} />}
            {g.avancos.length > 0 && g.avancos.at(-1)!.comentario && <p className="text-xs text-muted-foreground">Último comentário: {g.avancos.at(-1)!.comentario}</p>}
            {g.status === "ativa" && <Avanco goal={g} appointmentId={appointmentId} onDone={refresh} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
