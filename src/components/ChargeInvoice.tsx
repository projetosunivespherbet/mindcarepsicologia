import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { downloadAuthed } from "@/lib/download";
import { DOC_STATUS } from "@/lib/fiscal";
import { brl, dateBR, monthLabel } from "@/lib/money";
import type { ChargeDetail, DpsPack, FiscalDoc, Issuer } from "@/lib/types";

const digits = (s: string) => s.replace(/\D/g, "");

function packText(p: DpsPack) {
  return [
    `Emissor: ${p.emissor.razao_social} · CNPJ ${p.emissor.cnpj}`,
    `Tomador: ${p.tomador.nome}${p.tomador.cpf_cnpj ? ` · CPF/CNPJ ${p.tomador.cpf_cnpj}` : ""}${p.tomador.email ? ` · ${p.tomador.email}` : ""}`,
    `Serviço: ${p.servico.descricao}${p.servico.codigo_tributacao ? ` · código ${p.servico.codigo_tributacao}` : ""}`,
    `Valor: ${brl(p.valor_centavos)}`,
    `Competência: ${monthLabel(p.competencia)} · emissão ${dateBR(p.data_emissao)}`,
  ].join("\n");
}

function DraftPanel({ doc, invalidate }: { doc: FiscalDoc; invalidate: () => void }) {
  const { user } = useAuth();
  const isIssuer = doc.emissor_professional_id === user?.id;
  const pack = useQuery({ queryKey: ["dps-pack", doc.id, doc.tomador.cpf_cnpj], queryFn: () => api<DpsPack>(`/nfse/${doc.id}/dps-pack`) });
  const [cpf, setCpf] = useState("");
  const [reg, setReg] = useState({ chave: "", numero: "" });
  const [municipal, setMunicipal] = useState(false);
  const [xml, setXml] = useState<string | undefined>();

  const saveCpf = useMutation({
    mutationFn: () => api(`/nfse/${doc.id}`, { method: "PATCH", body: { tomador: { cpf_cnpj: cpf } } }),
    onSuccess: () => {
      toast.success("CPF do tomador salvo");
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const discard = useMutation({
    mutationFn: () => api(`/nfse/${doc.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Rascunho descartado");
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const register = useMutation({
    mutationFn: () => api<FiscalDoc>(`/nfse/${doc.id}/register`, { body: { ...(municipal ? { origem: "municipal" } : { chave_acesso: reg.chave }), numero_nfse: reg.numero.trim(), ...(xml ? { xml } : {}) } }),
    onSuccess: (r) => {
      toast.success("Nota registrada");
      (r.avisos ?? []).forEach((a) => toast.warning(a));
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="space-y-3">
      {doc.pendencias.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-destructive">
          {doc.pendencias.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {!doc.tomador.cpf_cnpj && (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="n-cpf">CPF ou CNPJ do tomador</Label>
            <Input id="n-cpf" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} />
          </div>
          <Button type="button" variant="outline" disabled={!cpf || saveCpf.isPending} onClick={() => saveCpf.mutate()}>
            Salvar
          </Button>
        </div>
      )}
      {pack.data && (
        <div className="rounded-xl border bg-muted/30 p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <pre className="whitespace-pre-wrap font-sans">{packText(pack.data)}</pre>
            <Button type="button" size="sm" variant="outline" aria-label="Copiar dados" onClick={() => void navigator.clipboard.writeText(packText(pack.data)).then(() => toast.success("Dados copiados"))}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{pack.data.servico.sugestao}</p>
        </div>
      )}
      {isIssuer ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            register.mutate();
          }}
          className="space-y-3 rounded-xl border p-3"
        >
          <p className="text-sm font-medium">Depois de emitir no Emissor Nacional, registre a nota</p>
          <div className="flex items-center gap-3">
            <Switch id="n-mun" checked={municipal} onCheckedChange={setMunicipal} />
            <Label htmlFor="n-mun">Emitida pelo sistema da prefeitura (sem chave de acesso)</Label>
          </div>
          {!municipal && (
            <div className="space-y-1">
              <Label htmlFor="n-chave">Chave de acesso (50 dígitos)</Label>
              <Input id="n-chave" required inputMode="numeric" maxLength={50} value={reg.chave} onChange={(e) => setReg({ ...reg, chave: digits(e.target.value) })} />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="n-num">Número da nota</Label>
              <Input id="n-num" required maxLength={20} value={reg.numero} onChange={(e) => setReg({ ...reg, numero: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="n-xml">Arquivo XML (recomendado)</Label>
              <Input id="n-xml" type="file" accept=".xml,text/xml,application/xml" onChange={(e) => void e.target.files?.[0]?.text().then(setXml)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={register.isPending || (!municipal && reg.chave.length !== 50)}>
              {register.isPending ? "Registrando..." : "Registrar nota"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => discard.mutate()}>
              Descartar rascunho
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">Só o profissional emissor registra a nota emitida.</p>
      )}
    </div>
  );
}

function IssuedPanel({ doc, invalidate }: { doc: FiscalDoc; invalidate: () => void }) {
  const { user } = useAuth();
  const isIssuer = doc.emissor_professional_id === user?.id;
  const [cancelling, setCancelling] = useState(false);
  const [motivo, setMotivo] = useState("");
  const cancel = useMutation({
    mutationFn: () => api(`/nfse/${doc.id}/cancel`, { body: { motivo } }),
    onSuccess: () => {
      toast.success("Cancelamento registrado");
      setCancelling(false);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="space-y-2 text-sm">
      <p>
        Nota nº <span className="font-medium">{doc.numero_nfse}</span> · {brl(doc.valor_centavos)}
      </p>
      {doc.chave_acesso && <p className="break-all text-xs text-muted-foreground">Chave: {doc.chave_acesso}</p>}
      <div className="flex flex-wrap gap-2">
        {doc.tem_xml && (
          <Button type="button" size="sm" variant="outline" onClick={() => void downloadAuthed(`/nfse/${doc.id}/xml`, `nfse-${doc.numero_nfse ?? doc.id}.xml`)}>
            Baixar XML
          </Button>
        )}
        {isIssuer && !cancelling && (
          <Button type="button" size="sm" variant="outline" onClick={() => setCancelling(true)}>
            Registrar cancelamento
          </Button>
        )}
      </div>
      {cancelling && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            cancel.mutate();
          }}
          className="space-y-2 rounded-xl border p-3"
        >
          <p className="text-xs text-muted-foreground">Cancele primeiro no Emissor Nacional e registre aqui.</p>
          <Label htmlFor="n-motivo">Motivo do cancelamento</Label>
          <Input id="n-motivo" required minLength={5} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={cancel.isPending}>
              Confirmar cancelamento
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCancelling(false)}>
              Voltar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Seção "Nota fiscal" dos detalhes da cobrança: preparar, copiar dados, registrar e cancelar. */
export function ChargeInvoice({ charge }: { charge: ChargeDetail }) {
  const qc = useQueryClient();
  const docs = useQuery({ queryKey: ["nfse"], queryFn: () => api<FiscalDoc[]>("/nfse") });
  const issuers = useQuery({ queryKey: ["issuers"], queryFn: () => api<Issuer[]>("/fiscal/issuers") });
  const doc = docs.data?.find((d) => d.charge_ids.includes(charge.id) && d.status !== "cancelada");
  const issuer = issuers.data?.find((i) => i.professional_id === charge.professional_id && i.ativo);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["nfse"] });
    void qc.invalidateQueries({ queryKey: ["dps-pack"] });
    void qc.invalidateQueries({ queryKey: ["charges"] });
    void qc.invalidateQueries({ queryKey: ["pending-invoices"] });
    void qc.invalidateQueries({ queryKey: ["appointments"] });
  };
  const prepare = useMutation({
    mutationFn: () => api("/nfse", { body: { issuer_id: issuer!.id, charge_ids: [charge.id] } }),
    onSuccess: () => {
      toast.success("Rascunho da nota criado");
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (charge.status === "cancelada" || docs.isLoading || issuers.isLoading) return null;
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Nota fiscal</p>
        {doc && <Badge variant={DOC_STATUS[doc.status].variant}>{DOC_STATUS[doc.status].label}</Badge>}
      </div>
      {!doc && !issuer && <p className="text-xs text-muted-foreground">O emissor deste profissional ainda não foi cadastrado (menu Nota fiscal).</p>}
      {!doc && issuer && (
        <Button type="button" size="sm" variant="outline" disabled={prepare.isPending} onClick={() => prepare.mutate()}>
          {prepare.isPending ? "Preparando..." : "Preparar nota fiscal"}
        </Button>
      )}
      {doc?.status === "rascunho" && <DraftPanel doc={doc} invalidate={invalidate} />}
      {doc?.status === "emitida" && <IssuedPanel doc={doc} invalidate={invalidate} />}
    </div>
  );
}
