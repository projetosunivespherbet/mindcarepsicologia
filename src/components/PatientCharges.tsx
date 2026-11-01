import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { todayIn } from "@/lib/dates";
import { brl, centsToInput, dateBR, monthLabel, newIdempotencyKey, parseBRL } from "@/lib/money";
import type { Charge, ChargeDetail, ChargeStatus, Payer, PatientDetail, PaymentMethod, Professional } from "@/lib/types";
import { pixCopiaECola } from "@shared/pix";
import { NativeSelect } from "@/components/NativeSelect";
import { ProfessionalSelect } from "@/pages/Patients";
import { ChargeInvoice } from "@/components/ChargeInvoice";
import { ChangeHistory } from "@/components/ChangeHistory";
import { NoteBadge } from "@/components/NoteBadge";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "pix", label: "Pix" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "cartao", label: "Cartão" },
  { value: "transferencia", label: "Transferência" },
  { value: "boleto", label: "Boleto" },
  { value: "convenio", label: "Convênio" },
  { value: "outro", label: "Outro" },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label])) as Record<PaymentMethod, string>;

const STATUS: Record<ChargeStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  aberta: { label: "Em aberto", variant: "secondary" },
  parcial: { label: "Parcial", variant: "outline" },
  paga: { label: "Paga", variant: "default" },
  cancelada: { label: "Cancelada", variant: "destructive" },
};


function MethodSelect({ value, onChange, id }: { value: PaymentMethod; onChange: (v: PaymentMethod) => void; id?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PaymentMethod)}>
      <SelectTrigger id={id} aria-label="Forma de pagamento">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {METHODS.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------- nova cobrança

function NewChargeDialog({ patient, open, onClose }: { patient: PatientDetail; open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const needsProfessional = !patient.professional_id && user?.role !== "psicologo";
  const today = () => todayIn(user?.timezone); // dia no fuso da clínica, o mesmo que a API usa para validar
  const blank = () => ({ valor: "", mes: today().slice(0, 7), vencimento: "", pago: false, metodo: "pix" as PaymentMethod, pagoEm: today(), professional_id: "", payer_id: "", convenio: false, imposto: false });
  const payers = useQuery({ queryKey: ["payers"], queryFn: () => api<Payer[]>("/payers?ativo=true"), enabled: open });
  const [newPayer, setNewPayer] = useState<{ nome: string; doc: string } | null>(null);
  const [f, setF] = useState(blank);
  const key = useRef(newIdempotencyKey());
  useEffect(() => {
    if (open) {
      setF(blank());
      setNewPayer(null);
      key.current = newIdempotencyKey();
    }
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const cents = parseBRL(f.valor);
      if (!cents) throw new Error("Informe um valor válido, por exemplo 200 ou 200,00");
      if (needsProfessional && !f.professional_id) throw new Error("Escolha o psicólogo responsável");
      let payerId = f.payer_id;
      if (newPayer?.nome.trim()) {
        const created = await api<Payer>("/payers", { body: { nome: newPayer.nome.trim(), ...(newPayer.doc.trim() ? { cpf_cnpj: newPayer.doc.trim() } : {}) } });
        payerId = created.id;
        void qc.invalidateQueries({ queryKey: ["payers"] });
      }
      const charge = await api<Charge>("/charges", {
        body: {
          patient_id: patient.id,
          competencia: f.mes,
          valor_centavos: cents,
          convenio: f.convenio,
          imposto_recolhido: f.imposto,
          ...(payerId ? { payer_id: payerId } : {}),
          ...(f.vencimento ? { vencimento: f.vencimento } : {}),
          ...(needsProfessional ? { professional_id: f.professional_id } : {}),
        },
      });
      if (!f.pago) return { paymentFailed: null as string | null };
      try {
        await api(`/charges/${charge.id}/payments`, {
          headers: { "Idempotency-Key": key.current },
          body: { valor_centavos: cents, metodo: f.metodo, pago_em: f.pagoEm },
        });
        return { paymentFailed: null as string | null };
      } catch (e) {
        return { paymentFailed: errMsg(e, "erro inesperado") };
      }
    },
    onSuccess: ({ paymentFailed }) => {
      void qc.invalidateQueries({ queryKey: ["charges"] });
      if (paymentFailed) toast.error(`Cobrança registrada, mas o pagamento não foi: ${paymentFailed}. Use "Receber" na lista.`);
      else toast.success(f.pago ? "Cobrança e pagamento registrados" : "Cobrança registrada");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error && !("status" in e) ? e.message : errMsg(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova cobrança</DialogTitle>
          <DialogDescription>Para {patient.nome}. Se o pagamento já foi feito, registre tudo de uma vez.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-valor">Valor (R$)</Label>
              <Input id="c-valor" inputMode="decimal" required placeholder="200,00" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-mes">Mês de referência</Label>
              <Input id="c-mes" type="month" required value={f.mes} onChange={(e) => setF({ ...f, mes: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="c-venc">Vencimento (opcional)</Label>
              <Input id="c-venc" type="date" value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} />
            </div>
          </div>
          {needsProfessional && (
            <div className="space-y-2">
              <Label htmlFor="c-prof">Psicólogo responsável</Label>
              <ProfessionalSelect id="c-prof" value={f.professional_id} onChange={(v) => setF({ ...f, professional_id: v })} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="c-resp">Quem paga</Label>
            {newPayer ? (
              <div className="grid gap-2 sm:grid-cols-2 rounded-xl border p-3">
                <Input aria-label="Nome do responsável" placeholder="Nome do responsável" value={newPayer.nome} onChange={(e) => setNewPayer({ ...newPayer, nome: e.target.value })} />
                <Input aria-label="CPF ou CNPJ do responsável" placeholder="CPF ou CNPJ (opcional)" inputMode="numeric" value={newPayer.doc} onChange={(e) => setNewPayer({ ...newPayer, doc: e.target.value })} />
                <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setNewPayer(null)}>
                  Voltar
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <NativeSelect id="c-resp" value={f.payer_id} onChange={(e) => setF({ ...f, payer_id: e.target.value })}>
                  <option value="">O próprio paciente</option>
                  {payers.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                      {p.vinculo ? ` (${p.vinculo})` : ""}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="button" variant="outline" onClick={() => setNewPayer({ nome: "", doc: "" })}>
                  Novo
                </Button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-3">
              <Switch id="c-conv" checked={f.convenio} onCheckedChange={(v) => setF({ ...f, convenio: v })} />
              <Label htmlFor="c-conv">Convênio</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="c-imp" checked={f.imposto} onCheckedChange={(v) => setF({ ...f, imposto: v })} />
              <Label htmlFor="c-imp">Imposto recolhido</Label>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch id="c-pago" checked={f.pago} onCheckedChange={(v) => setF({ ...f, pago: v })} />
            <Label htmlFor="c-pago">Já foi pago</Label>
          </div>
          {f.pago && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="c-metodo">Forma de pagamento</Label>
                <MethodSelect id="c-metodo" value={f.metodo} onChange={(v) => setF({ ...f, metodo: v })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-pagoem">Data do pagamento</Label>
                <Input id="c-pagoem" type="date" required max={today()} value={f.pagoEm} onChange={(e) => setF({ ...f, pagoEm: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Salvando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- receber

export function ReceiveDialog({ charge, onClose }: { charge: Charge | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const today = () => todayIn(user?.timezone);
  const [f, setF] = useState({ valor: "", metodo: "pix" as PaymentMethod, pagoEm: today() });
  const key = useRef(newIdempotencyKey());
  useEffect(() => {
    if (charge) {
      setF({ valor: centsToInput(charge.saldo_centavos), metodo: "pix", pagoEm: today() });
      key.current = newIdempotencyKey();
    }
  }, [charge?.id]);

  const receive = useMutation({
    mutationFn: async () => {
      const cents = parseBRL(f.valor);
      if (!cents) throw new Error("Informe um valor válido");
      return api(`/charges/${charge!.id}/payments`, {
        headers: { "Idempotency-Key": key.current },
        body: { valor_centavos: cents, metodo: f.metodo, pago_em: f.pagoEm },
      });
    },
    onSuccess: () => {
      toast.success("Pagamento registrado");
      void qc.invalidateQueries({ queryKey: ["charges"] });
      void qc.invalidateQueries({ queryKey: ["charge", charge?.id] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error && !("status" in e) ? e.message : errMsg(e)),
  });

  return (
    <Dialog open={!!charge} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
          <DialogDescription>
            {charge ? `Referência ${monthLabel(charge.competencia)} · saldo ${brl(charge.saldo_centavos)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            receive.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="r-valor">Valor (R$)</Label>
              <Input id="r-valor" inputMode="decimal" required value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-metodo">Forma</Label>
              <MethodSelect id="r-metodo" value={f.metodo} onChange={(v) => setF({ ...f, metodo: v })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-data">Data</Label>
              <Input id="r-data" type="date" required max={today()} value={f.pagoEm} onChange={(e) => setF({ ...f, pagoEm: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={receive.isPending}>
              {receive.isPending ? "Salvando..." : "Registrar pagamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FlagToggles({ charge }: { charge: ChargeDetail }) {
  const qc = useQueryClient();
  const flip = useMutation({
    mutationFn: (body: { convenio?: boolean; imposto_recolhido?: boolean }) => api(`/charges/${charge.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["charge", charge.id] });
      void qc.invalidateQueries({ queryKey: ["charges"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <div className="flex items-center gap-2">
        <Switch id="d-conv" checked={charge.convenio} onCheckedChange={(v) => flip.mutate({ convenio: v })} />
        <Label htmlFor="d-conv">Convênio</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="d-imp" checked={charge.imposto_recolhido} onCheckedChange={(v) => flip.mutate({ imposto_recolhido: v })} />
        <Label htmlFor="d-imp">Imposto recolhido</Label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- detalhes (estorno e cancelamento)

type Action = { kind: "reverse"; paymentId: string } | { kind: "cancel" } | null;

/** Pix "copia e cola" do saldo da cobrança, com a chave Pix do psicólogo. O código é gerado aqui, no navegador. */
function PixBox({ charge }: { charge: ChargeDetail }) {
  const { user } = useAuth();
  const pros = useQuery({ queryKey: ["professionals"], queryFn: () => api<Professional[]>("/professionals") });
  const [open, setOpen] = useState(false);
  if (charge.status === "cancelada" || charge.saldo_centavos <= 0) return null;
  const chave = pros.data?.find((p) => p.id === charge.professional_id)?.pix_chave;
  if (!chave) {
    return (
      <p className="text-xs text-muted-foreground">
        {user?.role === "admin" ? "Para gerar o Pix copia e cola, cadastre a chave Pix do psicólogo em Usuários > Editar." : "Sem chave Pix cadastrada para este psicólogo. Peça à administração para cadastrar."}
      </p>
    );
  }
  const code = pixCopiaECola({ chave, valorCentavos: charge.saldo_centavos, nome: charge.profissional_nome ?? "Recebedor" });
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Pix copia e cola copiado");
    } catch {
      toast.error("Não foi possível copiar. Selecione o código e copie manualmente.");
    }
  };
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Pix de {brl(charge.saldo_centavos)}</p>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
          <QrCode className="w-4 h-4 mr-2" /> {open ? "Ocultar Pix" : "Pix copia e cola"}
        </Button>
      </div>
      {open && (
        <>
          <textarea readOnly rows={4} aria-label="Código Pix copia e cola" className="w-full rounded-md border bg-muted/40 p-2 font-mono text-xs" value={code} onFocus={(e) => e.currentTarget.select()} />
          <Button size="sm" onClick={() => void copiar()}>
            <Copy className="w-4 h-4 mr-2" /> Copiar código
          </Button>
          <p className="text-xs text-muted-foreground">Envie o código ao paciente. No app do banco: Pix &gt; Pix copia e cola. Depois do pagamento, registre-o em "Receber".</p>
        </>
      )}
    </div>
  );
}

export function DetailDialog({ chargeId, onClose }: { chargeId: string | null; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [action, setAction] = useState<Action>(null);
  const [motivo, setMotivo] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    setAction(null);
    setMotivo("");
  }, [chargeId]);

  const q = useQuery({ queryKey: ["charge", chargeId], queryFn: () => api<ChargeDetail>(`/charges/${chargeId}`), enabled: !!chargeId });
  const c = q.data;
  const canReverse = user?.role === "admin" || user?.role === "psicologo";

  const run = useMutation({
    mutationFn: () =>
      action?.kind === "reverse"
        ? api(`/payments/${action.paymentId}/reverse`, { body: { motivo } })
        : api(`/charges/${chargeId}/cancel`, { body: { motivo } }),
    onSuccess: () => {
      toast.success(action?.kind === "reverse" ? "Pagamento estornado" : "Cobrança cancelada");
      setAction(null);
      setMotivo("");
      void qc.invalidateQueries({ queryKey: ["charges"] });
      void qc.invalidateQueries({ queryKey: ["charge", chargeId] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <Dialog open={!!chargeId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{c ? `Cobrança ${monthLabel(c.competencia)}` : "Cobrança"}</DialogTitle>
          <DialogDescription>
            {c ? `${brl(c.liquido_centavos)} · pago ${brl(c.paid_centavos)} · saldo ${brl(c.saldo_centavos)}` : "Carregando..."}
          </DialogDescription>
        </DialogHeader>
        {c && (
          <div className="space-y-3">
            {c.status === "cancelada" && <p className="text-sm text-destructive">Cancelada: {c.cancel_reason}</p>}
            <ul className="divide-y rounded-xl border bg-card">
              {c.pagamentos.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <p className={p.estornado ? "line-through text-muted-foreground" : "font-medium"}>
                      {p.reverses_id ? "Estorno " : ""}
                      {brl(p.valor_centavos)} · {METHOD_LABEL[p.metodo]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dateBR(p.pago_em)}
                      {p.motivo_estorno ? ` · ${p.motivo_estorno}` : ""}
                      {p.estornado ? " · estornado" : ""}
                    </p>
                  </div>
                  {canReverse && !p.reverses_id && !p.estornado && c.status !== "cancelada" && (
                    <Button size="sm" variant="outline" onClick={() => setAction({ kind: "reverse", paymentId: p.id })}>
                      Estornar
                    </Button>
                  )}
                </li>
              ))}
              {c.pagamentos.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Nenhum pagamento registrado.</li>}
            </ul>
            <PixBox charge={c} />
            {c.status !== "cancelada" && <FlagToggles charge={c} />}
            <ChargeInvoice charge={c} />
            {action && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run.mutate();
                }}
                className="space-y-2 rounded-xl border p-3"
              >
                <Label htmlFor="d-motivo">{action.kind === "reverse" ? "Motivo do estorno" : "Motivo do cancelamento"}</Label>
                <Input id="d-motivo" required minLength={5} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" variant="destructive" disabled={run.isPending}>
                    {run.isPending ? "Salvando..." : action.kind === "reverse" ? "Confirmar estorno" : "Confirmar cancelamento"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAction(null)}>
                    Voltar
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            {c && c.status === "aberta" && c.paid_centavos === 0 && (
              <Button variant="outline" onClick={() => setAction({ kind: "cancel" })}>
                Cancelar cobrança
              </Button>
            )}
            {user?.role === "admin" && (
              <Button variant="ghost" onClick={() => setShowHistory(true)}>
                Histórico
              </Button>
            )}
          </div>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
      <ChangeHistory table="charges" rowId={chargeId} open={showHistory} onClose={() => setShowHistory(false)} title="Histórico da cobrança" />
    </Dialog>
  );
}

// ---------------------------------------------------------------- aba

export function PatientCharges({ patient }: { patient: PatientDetail }) {
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<Charge | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["charges", { patientId: patient.id }], queryFn: () => api<Charge[]>(`/charges?patient_id=${patient.id}`) });
  const emAberto = (q.data ?? []).filter((c) => c.status === "aberta" || c.status === "parcial").reduce((n, c) => n + c.saldo_centavos, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Em aberto: <span className="font-semibold text-foreground">{brl(emAberto)}</span>
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4 mr-2" /> Nova cobrança
        </Button>
      </div>
      {q.isError && <p className="text-sm text-destructive">{errMsg(q.error, "Não foi possível carregar as cobranças.")}</p>}
      <ul className="divide-y rounded-xl border bg-card">
        {q.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <button type="button" onClick={() => setDetailId(c.id)} className="min-w-0 text-left">
              <p className="font-medium text-primary hover:underline">
                {monthLabel(c.competencia)} · {brl(c.liquido_centavos)}
              </p>
              <p className="text-xs text-muted-foreground">
                Pago {brl(c.paid_centavos)} · saldo {brl(c.saldo_centavos)}
                {c.vencimento ? ` · vence ${dateBR(c.vencimento)}` : ""}
                {c.profissional_nome ? ` · ${c.profissional_nome}` : ""}
              </p>
            </button>
            <div className="flex items-center gap-2">
              {c.atrasada && <Badge variant="destructive">Atrasada</Badge>}
              <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>
              <NoteBadge charge={c} />
              {(c.status === "aberta" || c.status === "parcial") && (
                <Button size="sm" onClick={() => setReceiving(c)}>
                  Receber
                </Button>
              )}
            </div>
          </li>
        ))}
        {q.data?.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nenhuma cobrança para este paciente.</li>}
        {q.isLoading && <li className="p-6 text-center text-sm text-muted-foreground">Carregando...</li>}
      </ul>
      <NewChargeDialog patient={patient} open={creating} onClose={() => setCreating(false)} />
      <ReceiveDialog charge={receiving} onClose={() => setReceiving(null)} />
      <DetailDialog chargeId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
