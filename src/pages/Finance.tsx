import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { NoteBadge } from "@/components/NoteBadge";
import { ReceitaSaudeCard } from "@/components/ReceitaSaudeCard";
import { DetailDialog, ReceiveDialog } from "@/components/PatientCharges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { addDays, localInstant, monthRange, todayIn, toDateStr } from "@/lib/dates";
import { downloadAuthed } from "@/lib/download";
import { brl, centsToInput, dateBR, monthLabel, parseBRL } from "@/lib/money";
import type { Charge, ChargeStatus, FinanceSummary, Receivables, Service } from "@/lib/types";

const STATUS: Record<ChargeStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  aberta: { label: "Em aberto", variant: "secondary" },
  parcial: { label: "Parcial", variant: "outline" },
  paga: { label: "Paga", variant: "default" },
  cancelada: { label: "Cancelada", variant: "destructive" },
};

const FAIXAS: { key: keyof Receivables["totais"]; label: string }[] = [
  { key: "a_vencer", label: "A vencer" },
  { key: "sem_vencimento", label: "Sem vencimento" },
  { key: "ate_30", label: "Até 30 dias" },
  { key: "de_31_a_60", label: "31 a 60 dias" },
  { key: "mais_de_60", label: "Mais de 60 dias" },
];

function Stat({ label, value, tone, hint }: { label: string; value: number; tone?: "bad"; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-semibold ${tone === "bad" && value > 0 ? "text-destructive" : ""}`}>{brl(value)}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function ServiceRow({ s }: { s: Service }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [valor, setValor] = useState(centsToInput(s.valor_centavos));
  const patch = useMutation({
    mutationFn: (body: { valor_centavos?: number; ativo?: boolean }) => api(`/services/${s.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      setEdit(false);
      void qc.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const save = () => {
    const cents = parseBRL(valor);
    if (!cents) return toast.error("Valor inválido");
    patch.mutate({ valor_centavos: cents });
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div>
        <p className={`font-medium ${s.ativo ? "" : "text-muted-foreground line-through"}`}>{s.nome}</p>
        {!edit && <p className="text-xs text-muted-foreground">{brl(s.valor_centavos)}</p>}
      </div>
      <div className="flex items-center gap-2">
        {edit ? (
          <>
            <Input aria-label={`Valor de ${s.nome}`} className="w-28" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
            <Button size="sm" onClick={save}>
              Salvar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>
              Voltar
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
              Alterar valor
            </Button>
            <Button size="sm" variant="ghost" onClick={() => patch.mutate({ ativo: !s.ativo })}>
              {s.ativo ? "Desativar" : "Reativar"}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function Services() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["services"], queryFn: () => api<Service[]>("/services") });
  const [f, setF] = useState({ nome: "", valor: "" });
  const create = useMutation({
    mutationFn: () => {
      const cents = parseBRL(f.valor);
      if (!cents) throw new Error("Informe um valor válido");
      return api("/services", { body: { nome: f.nome.trim(), valor_centavos: cents } });
    },
    onSuccess: () => {
      setF({ nome: "", valor: "" });
      void qc.invalidateQueries({ queryKey: ["services"] });
      toast.success("Serviço adicionado");
    },
    onError: (e) => toast.error(e instanceof Error && !("status" in e) ? e.message : errMsg(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Serviços e valores</CardTitle>
        <CardDescription>Quando uma sessão não tem valor, a cobrança usa o preço cadastrado aqui.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="sv-nome">Nome</Label>
            <Input id="sv-nome" required minLength={2} maxLength={80} placeholder="Sessão individual" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sv-valor">Valor (R$)</Label>
            <Input id="sv-valor" required className="w-32" inputMode="decimal" placeholder="200,00" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} />
          </div>
          <Button type="submit" disabled={create.isPending}>
            Adicionar
          </Button>
        </form>
        <ul className="divide-y rounded-xl border bg-card">
          {q.data?.map((s) => <ServiceRow key={s.id} s={s} />)}
          {q.data?.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Nenhum serviço cadastrado.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function Finance() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const role = user?.role;
  const canBulk = role === "admin" || role === "recepcao";
  const [ym, setYm] = useState(() => todayIn(user?.timezone).slice(0, 7));
  const [incluirFaltas, setIncluirFaltas] = useState(false);
  const [receiving, setReceiving] = useState<Charge | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const { from, to } = monthRange(ym);

  const summary = useQuery({ queryKey: ["finance-summary", from, to], queryFn: () => api<FinanceSummary>(`/finance/summary?from=${from}&to=${to}`) });
  const charges = useQuery({ queryKey: ["charges", { month: ym }], queryFn: () => api<Charge[]>(`/charges?from=${from}&to=${to}`) });
  const pending = useQuery({ queryKey: ["pending-invoices"], queryFn: () => api<{ total_centavos: number; itens: Charge[] }>("/finance/pending-invoices") });
  const receivables = useQuery({ queryKey: ["receivables"], queryFn: () => api<Receivables>("/finance/receivables"), enabled: canBulk });

  // Os três primeiros cartões olham as mesmas cobranças (as deste mês): cobrado = pago + falta receber.
  const ativas = (charges.data ?? []).filter((c) => c.status !== "cancelada");
  const doMes = {
    cobrado: ativas.reduce((t, c) => t + c.liquido_centavos, 0),
    pago: ativas.reduce((t, c) => t + Math.min(c.paid_centavos, c.liquido_centavos), 0),
    falta: ativas.reduce((t, c) => t + Math.max(c.saldo_centavos, 0), 0),
  };

  const generate = useMutation({
    mutationFn: () =>
      api<{ criadas: number; sem_valor: number }>("/charges/generate", {
        body: { from: localInstant(from, "00:00"), to: localInstant(toDateStr(addDays(new Date(`${to}T12:00:00`), 1)), "00:00"), incluir_faltas: incluirFaltas },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["charges"] });
      void qc.invalidateQueries({ queryKey: ["finance-summary"] });
      void qc.invalidateQueries({ queryKey: ["receivables"] });
      toast.success(`${r.criadas} cobrança(s) criada(s)`);
      if (r.sem_valor > 0) toast.warning(`${r.sem_valor} sessão(ões) sem valor e sem serviço cadastrado: defina o valor para gerar a cobrança.`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Financeiro</h1>
        <div className="space-y-1">
          <Label htmlFor="f-mes">Mês</Label>
          <Input id="f-mes" type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Cobrado no mês" hint="Cobranças deste mês" value={doMes.cobrado} />
        <Stat label="Pago" hint="Quanto dessas cobranças já foi pago" value={doMes.pago} />
        <Stat label="Falta receber" hint="Quanto dessas cobranças ainda não foi pago" value={doMes.falta} />
        <Stat label="Em atraso (todos os meses)" hint="Cobranças vencidas e não pagas, de qualquer mês" value={summary.data?.atrasado_centavos ?? 0} tone="bad" />
      </div>

      <Tabs defaultValue="cobrancas" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="cobrancas">Cobranças</TabsTrigger>
          {role !== "psicologo" && <TabsTrigger value="resumo">Resumo</TabsTrigger>}
          <TabsTrigger value="fiscal">Fiscal</TabsTrigger>
          {role !== "recepcao" && <TabsTrigger value="servicos">Serviços</TabsTrigger>}
        </TabsList>

        <TabsContent value="cobrancas" className="space-y-4">
          {canBulk && (
            <Card>
              <CardHeader>
                <CardTitle>Gerar cobranças do mês</CardTitle>
                <CardDescription>Cria as cobranças das sessões realizadas no mês que ainda não têm. Repetir não duplica.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch id="f-faltas" checked={incluirFaltas} onCheckedChange={setIncluirFaltas} />
                  <Label htmlFor="f-faltas">Incluir faltas</Label>
                </div>
                <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
                  {generate.isPending ? "Gerando..." : "Gerar cobranças do mês"}
                </Button>
                {role === "admin" && (
                  <Button variant="outline" onClick={() => void downloadAuthed(`/finance/export?from=${from}&to=${to}`, `financeiro-${from}_${to}.csv`)}>
                    <Download className="w-4 h-4 mr-2" /> Exportar CSV
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

      <Card>
        <CardHeader>
          <CardTitle>Cobranças de {monthLabel(`${from}`)}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-xl border bg-card">
            {charges.data?.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <button type="button" onClick={() => setDetailId(c.id)} className="text-left font-medium text-primary hover:underline">
                    {c.paciente_nome ?? "Paciente"} · {brl(c.liquido_centavos)}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Pago {brl(c.paid_centavos)} · saldo {brl(c.saldo_centavos)}
                    {c.vencimento ? ` · vence ${dateBR(c.vencimento)}` : ""}
                    {role !== "psicologo" && c.profissional_nome ? ` · ${c.profissional_nome}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {c.atrasada && <Badge variant="destructive">Atrasada</Badge>}
                  <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
                  <NoteBadge charge={c} />
                  {(c.status === "aberta" || c.status === "parcial") && (
                    <Button size="sm" onClick={() => setReceiving(c)}>
                      Receber
                    </Button>
                  )}
                  <Button asChild size="sm" variant="ghost">
                    <Link to={`/pacientes/${c.patient_id}`}>Paciente</Link>
                  </Button>
                </div>
              </li>
            ))}
            {charges.data?.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nenhuma cobrança neste mês.</li>}
          </ul>
        </CardContent>
      </Card>
        </TabsContent>

        {role !== "psicologo" && (
        <TabsContent value="resumo" className="space-y-4">
      {(summary.data?.por_profissional.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Por profissional</CardTitle>
            <CardDescription>"Entrou no caixa" soma os pagamentos recebidos no mês, inclusive de cobranças de meses anteriores. "A receber" e "Atrasado" são o saldo atual de todos os meses.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-xl border bg-card">
              {summary.data?.por_profissional.map((p) => (
                <li key={p.professional_id} className="grid gap-1 p-3 text-sm sm:grid-cols-5 sm:items-center">
                  <span className="font-medium sm:col-span-1">{p.nome}</span>
                  <span>Cobrado no mês {brl(p.faturado_centavos)}</span>
                  <span>Entrou no caixa {brl(p.recebido_centavos)}</span>
                  <span>A receber {brl(p.em_aberto_centavos)}</span>
                  <span className={p.atrasado_centavos > 0 ? "text-destructive" : ""}>Atrasado {brl(p.atrasado_centavos)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {canBulk && receivables.data && (
        <Card>
          <CardHeader>
            <CardTitle>Inadimplência</CardTitle>
            <CardDescription>Saldo em aberto por idade do vencimento.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 grid-cols-2 lg:grid-cols-5">
              {FAIXAS.map((f) => (
                <div key={f.key} className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-semibold">{brl(receivables.data.totais[f.key])}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
        </TabsContent>
        )}

        <TabsContent value="fiscal" className="space-y-4">
          {(role === "admin" || role === "psicologo") && <ReceitaSaudeCard ym={ym} />}
      {pending.data && pending.data.itens.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pendências de emissão</CardTitle>
            <CardDescription>
              {pending.data.itens.length} cobrança(s) sem nota fiscal, somando {brl(pending.data.total_centavos)}. Abra a cobrança para preparar a nota.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-xl border bg-card">
              {pending.data.itens.slice(0, 20).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {c.paciente_nome ?? "Paciente"} · {brl(c.liquido_centavos)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {monthLabel(c.competencia)} · {STATUS[c.status].label.toLowerCase()}
                      {role !== "psicologo" && c.profissional_nome ? ` · ${c.profissional_nome}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setDetailId(c.id)}>
                    Abrir
                  </Button>
                </li>
              ))}
            </ul>
            {pending.data.itens.length > 20 && <p className="mt-2 text-xs text-muted-foreground">Mostrando as 20 mais antigas.</p>}
          </CardContent>
        </Card>
      )}
        </TabsContent>

        {role !== "recepcao" && (
          <TabsContent value="servicos">
            <Services />
          </TabsContent>
        )}
      </Tabs>

      <ReceiveDialog charge={receiving} onClose={() => setReceiving(null)} />
      <DetailDialog chargeId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
