import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { DetailDialog } from "@/components/PatientCharges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { brl, parseBRL } from "@/lib/money";
import type { PatientDetail, SessionPackage } from "@/lib/types";
import { ProfessionalSelect } from "@/pages/Patients";

const PAGAMENTO: Record<string, string> = { aberta: "A pagar", parcial: "Pago em parte", paga: "Pago", cancelada: "Cobrança cancelada" };

/** Pacotes de sessões do paciente: uma cobrança única; cada sessão realizada desconta do saldo. */
export function PatientPackages({ patient }: { patient: PatientDetail }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [verCobranca, setVerCobranca] = useState<string | null>(null);
  const [f, setF] = useState({ sessoes: "4", valor: "", vencimento: "", professional_id: patient.professional_id ?? "" });
  const q = useQuery({ queryKey: ["packages", patient.id], queryFn: () => api<SessionPackage[]>(`/packages?patient_id=${patient.id}`) });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["packages"] });
    void qc.invalidateQueries({ queryKey: ["charges"] });
  };
  const criar = useMutation({
    mutationFn: () => {
      const valor = parseBRL(f.valor);
      if (!valor) throw new Error("Informe o valor total do pacote");
      return api<SessionPackage>("/packages", {
        body: {
          patient_id: patient.id,
          sessoes: Number(f.sessoes),
          valor_centavos: valor,
          vencimento: f.vencimento || null,
          ...(user?.role === "psicologo" ? {} : { professional_id: f.professional_id || undefined }),
        },
      });
    },
    onSuccess: (p) => {
      refresh();
      setNovo(false);
      toast.success("Pacote criado com a cobrança");
      setVerCobranca(p.charge_id);
    },
    onError: (e) => toast.error(e instanceof Error && !("status" in e) ? e.message : errMsg(e)),
  });
  const encerrar = useMutation({
    mutationFn: (id: string) => api(`/packages/${id}`, { method: "PATCH", body: { status: "encerrado" } }),
    onSuccess: () => {
      refresh();
      toast.success("Pacote encerrado");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    criar.mutate();
  };
  const porSessao = parseBRL(f.valor) && Number(f.sessoes) > 0 ? brl(Math.round(parseBRL(f.valor)! / Number(f.sessoes))) : null;

  return (
    <section className="space-y-3" aria-label="Pacotes de sessões">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Pacotes de sessões</h3>
          <p className="text-xs text-muted-foreground">Pagamento único de várias sessões. Cada sessão realizada desconta do saldo; a falta só desconta se você escolher.</p>
        </div>
        <Button variant="outline" onClick={() => setNovo(true)}>
          <Package className="mr-2 h-4 w-4" /> Novo pacote
        </Button>
      </div>
      {(q.data ?? []).length > 0 && (
        <ul className="divide-y rounded-xl border bg-card">
          {q.data!.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div>
                <p className="font-medium">
                  {p.sessoes} sessões · {brl(p.valor_centavos)} · {p.usadas} usadas, {p.saldo} disponíveis
                </p>
                <p className="text-xs text-muted-foreground">Criado em {new Date(p.created_at).toLocaleDateString("pt-BR")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={p.status === "ativo" ? "default" : "secondary"}>{p.status === "ativo" ? "Ativo" : "Encerrado"}</Badge>
                <Badge variant={p.charge_status === "paga" ? "default" : "outline"}>{PAGAMENTO[p.charge_status]}</Badge>
                <Button size="sm" variant="ghost" onClick={() => setVerCobranca(p.charge_id)}>
                  Cobrança / Pix
                </Button>
                {p.status === "ativo" && (
                  <Button size="sm" variant="ghost" disabled={encerrar.isPending} onClick={() => encerrar.mutate(p.id)}>
                    Encerrar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={novo} onOpenChange={setNovo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo pacote de sessões</DialogTitle>
            <DialogDescription>Gera uma cobrança única com o valor total. As sessões realizadas vão sendo descontadas.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pk-n">Quantidade de sessões</Label>
                <Input id="pk-n" type="number" min={1} max={100} required value={f.sessoes} onChange={(e) => setF({ ...f, sessoes: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pk-valor">Valor total (R$)</Label>
                <Input id="pk-valor" inputMode="decimal" required placeholder="720,00" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} />
              </div>
            </div>
            {porSessao && <p className="text-xs text-muted-foreground">Equivale a {porSessao} por sessão.</p>}
            <div className="space-y-2">
              <Label htmlFor="pk-venc">Vencimento (opcional)</Label>
              <Input id="pk-venc" type="date" value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} />
            </div>
            {user?.role !== "psicologo" && (
              <div className="space-y-2">
                <Label htmlFor="pk-prof">Psicólogo</Label>
                <ProfessionalSelect id="pk-prof" value={f.professional_id} onChange={(v) => setF({ ...f, professional_id: v })} />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNovo(false)}>
                Voltar
              </Button>
              <Button type="submit" disabled={criar.isPending}>
                {criar.isPending ? "Criando..." : "Criar pacote"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <DetailDialog chargeId={verCobranca} onClose={() => setVerCobranca(null)} />
    </section>
  );
}
