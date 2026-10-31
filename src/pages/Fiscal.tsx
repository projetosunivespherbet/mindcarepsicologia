import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { DOC_STATUS } from "@/lib/fiscal";
import { brl, dateBR, monthLabel } from "@/lib/money";
import type { FiscalDoc, Issuer, Regime } from "@/lib/types";

const REGIMES: { value: Regime; label: string }[] = [
  { value: "simples", label: "Simples Nacional" },
  { value: "mei", label: "MEI" },
  { value: "presumido", label: "Lucro presumido" },
  { value: "outro", label: "Outro" },
];

function IssuerForm({ issuer }: { issuer: Issuer | undefined }) {
  const qc = useQueryClient();
  const blank = {
    cnpj: "",
    razao_social: "",
    inscricao_municipal: "",
    municipio_ibge: "",
    regime: "simples" as Regime,
    codigo_tributacao_padrao: "",
    emissor_nacional_ok: false,
  };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (issuer) {
      setF({
        cnpj: issuer.cnpj,
        razao_social: issuer.razao_social,
        inscricao_municipal: issuer.inscricao_municipal ?? "",
        municipio_ibge: issuer.municipio_ibge,
        regime: issuer.regime,
        codigo_tributacao_padrao: issuer.codigo_tributacao_padrao ?? "",
        emissor_nacional_ok: issuer.emissor_nacional_ok,
      });
    }
  }, [issuer?.id, issuer?.updated_at]);

  const save = useMutation({
    mutationFn: () => {
      const common = {
        razao_social: f.razao_social.trim(),
        inscricao_municipal: f.inscricao_municipal.trim() || null,
        municipio_ibge: f.municipio_ibge.trim(),
        regime: f.regime,
        codigo_tributacao_padrao: f.codigo_tributacao_padrao.trim() || null,
        emissor_nacional_ok: f.emissor_nacional_ok,
      };
      return issuer ? api(`/fiscal/issuers/${issuer.id}`, { method: "PATCH", body: common }) : api("/fiscal/issuers", { body: { ...common, cnpj: f.cnpj.trim() } });
    },
    onSuccess: () => {
      toast.success("Emissor salvo");
      void qc.invalidateQueries({ queryKey: ["issuers"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="i-cnpj">CNPJ</Label>
        <Input id="i-cnpj" required disabled={!!issuer} value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="i-razao">Razão social</Label>
        <Input id="i-razao" required value={f.razao_social} onChange={(e) => setF({ ...f, razao_social: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="i-ibge">Código do município (IBGE, 7 dígitos)</Label>
        <Input id="i-ibge" required inputMode="numeric" maxLength={7} value={f.municipio_ibge} onChange={(e) => setF({ ...f, municipio_ibge: e.target.value.replace(/\D/g, "") })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="i-regime">Regime tributário</Label>
        <Select value={f.regime} onValueChange={(v) => setF({ ...f, regime: v as Regime })}>
          <SelectTrigger id="i-regime" aria-label="Regime tributário">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REGIMES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="i-im">Inscrição municipal (opcional)</Label>
        <Input id="i-im" value={f.inscricao_municipal} onChange={(e) => setF({ ...f, inscricao_municipal: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="i-cod">Código de tributação (opcional)</Label>
        <Input id="i-cod" value={f.codigo_tributacao_padrao} onChange={(e) => setF({ ...f, codigo_tributacao_padrao: e.target.value })} />
      </div>
      <div className="flex items-start gap-3 sm:col-span-2">
        <Switch id="i-ok" checked={f.emissor_nacional_ok} onCheckedChange={(v) => setF({ ...f, emissor_nacional_ok: v })} />
        <div>
          <Label htmlFor="i-ok">Já consigo emitir no Emissor Nacional</Label>
          <p className="text-xs text-muted-foreground">Entre no portal com o CNPJ e tente iniciar uma emissão; se abrir, marque aqui.</p>
        </div>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Salvando..." : issuer ? "Salvar emissor" : "Cadastrar emissor"}
        </Button>
      </div>
    </form>
  );
}

export default function Fiscal() {
  const { user } = useAuth();
  const issuers = useQuery({ queryKey: ["issuers"], queryFn: () => api<Issuer[]>("/fiscal/issuers") });
  const docs = useQuery({ queryKey: ["nfse"], queryFn: () => api<FiscalDoc[]>("/nfse") });
  const mine = issuers.data?.find((i) => i.professional_id === user?.id);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Nota fiscal</h1>
      <Card>
        <CardHeader>
          <CardTitle>Meu emissor</CardTitle>
          <CardDescription>
            A nota sai no CNPJ de quem presta o serviço. O sistema monta os dados; você emite no Emissor Nacional e registra o resultado aqui.
          </CardDescription>
        </CardHeader>
        <CardContent>{issuers.isLoading ? <p className="text-muted-foreground">Carregando...</p> : <IssuerForm issuer={mine} />}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Notas</CardTitle>
          <CardDescription>Para preparar uma nota, abra a cobrança do paciente e use "Nota fiscal".</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-xl border bg-card">
            {docs.data?.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {d.tomador.nome} · {brl(d.valor_centavos)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {monthLabel(d.competencia)} · {d.numero_nfse ? `nº ${d.numero_nfse} · ` : ""}
                    {dateBR(d.data_emissao)}
                  </p>
                </div>
                <Badge variant={DOC_STATUS[d.status].variant}>{DOC_STATUS[d.status].label}</Badge>
              </li>
            ))}
            {docs.data?.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nenhuma nota ainda.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
