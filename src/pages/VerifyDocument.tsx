import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Brain, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DOCUMENT_TYPES, formatCodigo } from "@shared/documents";
import { api } from "@/lib/api";
import type { VerifyResult } from "@/lib/types";

const dt = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

export default function VerifyDocument() {
  const { codigo } = useParams();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const result = useQuery({
    queryKey: ["verify", codigo],
    queryFn: () => api<VerifyResult>(`/verify/${encodeURIComponent(codigo!)}`, { auth: false }),
    enabled: !!codigo,
    retry: false,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = typed.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (clean) navigate(`/verificar/${clean}`);
  };

  const r = result.data;
  return (
    <div className="min-h-screen flex items-center justify-center gradient-soft p-4">
      <div className="w-full max-w-lg animate-fade-in space-y-4">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl gradient-primary mb-3">
            <Brain className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Verificação de documento</h1>
          <p className="text-sm text-muted-foreground">Confirme a autenticidade de um documento emitido pelo MindCare.</p>
        </div>
        <Card className="shadow-elevated border-0">
          <CardHeader>
            <CardTitle className="text-base">Código de verificação</CardTitle>
            <CardDescription>Está no rodapé do documento ou no QR code ao lado da assinatura.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={submit} className="flex gap-2">
              <Input placeholder="XXXX-XXXX-XXXX" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Código de verificação" />
              <Button type="submit">Verificar</Button>
            </form>

            {codigo && result.isLoading && <p className="text-sm text-muted-foreground">Consultando...</p>}
            {codigo && result.isError && (
              <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <ShieldAlert className="w-5 h-5 text-destructive shrink-0" />
                <div>
                  <p className="font-medium">Documento não encontrado</p>
                  <p className="text-sm text-muted-foreground">Confira o código. Se estiver correto, desconfie do documento.</p>
                </div>
              </div>
            )}
            {r && (
              <div className="space-y-3">
                <div className={`flex gap-3 rounded-lg border p-4 ${r.status === "emitido" ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5"}`}>
                  {r.status === "emitido" ? <BadgeCheck className="w-5 h-5 text-primary shrink-0" /> : <ShieldAlert className="w-5 h-5 text-destructive shrink-0" />}
                  <div>
                    <p className="font-medium">{r.status === "emitido" ? "Documento autêntico e válido" : "Documento ANULADO pelo emissor"}</p>
                    <p className="text-sm text-muted-foreground">
                      {r.status === "anulado" && r.annulled_at ? `Anulado em ${dt(r.annulled_at)}.` : "Emitido pelo profissional abaixo."}
                    </p>
                  </div>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Documento</dt>
                  <dd>{DOCUMENT_TYPES[r.tipo]?.label ?? r.titulo} · nº {r.numero}</dd>
                  <dt className="text-muted-foreground">Emitido em</dt>
                  <dd>{dt(r.emitted_at)}</dd>
                  <dt className="text-muted-foreground">Profissional</dt>
                  <dd>{r.psicologo_nome} — CRP {r.psicologo_crp}</dd>
                  <dt className="text-muted-foreground">Clínica</dt>
                  <dd>{r.clinica_nome}</dd>
                  <dt className="text-muted-foreground">Código</dt>
                  <dd>{formatCodigo(codigo!.toUpperCase().replace(/-/g, ""))}</dd>
                  <dt className="text-muted-foreground">SHA-256</dt>
                  <dd className="break-all font-mono text-xs">{r.content_hash}</dd>
                </dl>
                <p className="text-xs text-muted-foreground">
                  Compare o SHA-256 acima com o impresso no rodapé do documento. Por sigilo, esta página não exibe dados da pessoa atendida.
                </p>
                <Badge variant="secondary">Verificação pública</Badge>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
