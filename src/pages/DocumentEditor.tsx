import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, FileCheck2, Printer, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DocStatusBadge } from "@/components/DocStatusBadge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, errMsg } from "@/lib/api";
import { openPdfWindow } from "@/lib/pdfWindow";
import type { DocFull, LetterheadRow } from "@/lib/types";
import { DOCUMENT_TYPES, formatCodigo, type DocumentData, type LetterheadData } from "@shared/documents";

const pdf = () => import("@/lib/documentPdf");
const toLetterhead = (l?: LetterheadRow | null): LetterheadData | null => (l ? l : null);

function Editor({ doc, letterheads }: { doc: DocFull; letterheads: LetterheadRow[] }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const def = DOCUMENT_TYPES[doc.tipo];
  const isDraft = doc.status === "rascunho";
  const [f, setF] = useState({
    titulo: doc.titulo,
    solicitante: doc.solicitante ?? "",
    finalidade: doc.finalidade ?? "",
    local: doc.local ?? "",
    data_documento: doc.data_documento,
    conteudo: { ...doc.conteudo } as Record<string, string>,
  });
  const defaultLh = letterheads.find((l) => l.is_default)?.id ?? "none";
  const [lhId, setLhId] = useState(defaultLh);
  const [confirmEmit, setConfirmEmit] = useState(false);
  const [annulling, setAnnulling] = useState(false);
  const [motivo, setMotivo] = useState("");

  const current = (): DocumentData => ({
    ...doc,
    titulo: f.titulo,
    solicitante: f.solicitante || null,
    finalidade: f.finalidade || null,
    local: f.local || null,
    data_documento: f.data_documento,
    conteudo: f.conteudo,
  });
  const selectedLh = () => toLetterhead(letterheads.find((l) => l.id === lhId));
  const refresh = (d: DocFull) => {
    qc.setQueryData(["document", doc.id], d);
    void qc.invalidateQueries({ queryKey: ["documents"] });
  };

  const body = () => ({
    titulo: f.titulo,
    solicitante: f.solicitante || null,
    finalidade: f.finalidade || null,
    local: f.local || null,
    data_documento: f.data_documento,
    conteudo: f.conteudo,
  });

  const save = useMutation({
    mutationFn: () => api<DocFull>(`/documents/${doc.id}`, { method: "PATCH", body: body() }),
    onSuccess: (d) => {
      refresh(d);
      toast.success("Rascunho salvo");
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const emit = useMutation({
    mutationFn: async () => {
      await api(`/documents/${doc.id}`, { method: "PATCH", body: body() });
      return api<DocFull>(`/documents/${doc.id}/emit`, { body: { letterhead_id: lhId === "none" ? null : lhId } });
    },
    onSuccess: (d) => {
      refresh(d);
      setConfirmEmit(false);
      toast.success(`Documento ${d.numero} emitido`);
    },
    onError: (e) => {
      setConfirmEmit(false);
      toast.error(errMsg(e));
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/documents/${doc.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      navigate("/documentos");
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const annul = useMutation({
    mutationFn: () => api<DocFull>(`/documents/${doc.id}/annul`, { body: { motivo } }),
    onSuccess: (d) => {
      refresh(d);
      setAnnulling(false);
      toast.success("Documento anulado");
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const run = (fn: () => Promise<void>) => fn().catch((e) => toast.error(errMsg(e, "Não foi possível gerar o PDF")));
  const openPdf = (data: DocumentData, lh: LetterheadData | null) => {
    const win = openPdfWindow(); // precisa ser no clique, antes de qualquer await
    void run(async () => (await pdf()).openDocumentPdf(data, lh, {}, win));
  };
  const pdfData = isDraft ? current() : doc;
  const pdfLh = isDraft ? selectedLh() : doc.letterhead;

  return (
    <div className="space-y-4 max-w-3xl">
      <Button asChild variant="ghost" size="sm">
        <Link to="/documentos">
          <ArrowLeft className="w-4 h-4 mr-1" /> Documentos
        </Link>
      </Button>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{def.label}</h1>
          <p className="text-sm text-muted-foreground">
            {doc.identificacao.paciente_nome}
            {doc.numero ? ` · nº ${doc.numero}` : ""}
          </p>
        </div>
        <DocStatusBadge status={doc.status} />
      </div>

      {doc.status === "anulado" && (
        <Alert variant="destructive">
          <AlertDescription>Documento anulado. Motivo: {doc.annul_reason}</AlertDescription>
        </Alert>
      )}
      {def.aviso && isDraft && (
        <Alert>
          <AlertDescription>{def.aviso}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identificação</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="e-titulo">Título</Label>
            <Input id="e-titulo" disabled={!isDraft} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} />
          </div>
          {def.needsSolicitante && (
            <div className="space-y-2">
              <Label htmlFor="e-sol">Solicitante</Label>
              <Input id="e-sol" disabled={!isDraft} value={f.solicitante} onChange={(e) => setF({ ...f, solicitante: e.target.value })} />
            </div>
          )}
          {def.needsFinalidade && (
            <div className={`space-y-2 ${def.needsSolicitante ? "" : "sm:col-span-2"}`}>
              <Label htmlFor="e-fin">Finalidade</Label>
              <Input id="e-fin" disabled={!isDraft} value={f.finalidade} onChange={(e) => setF({ ...f, finalidade: e.target.value })} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="e-local">Local</Label>
            <Input id="e-local" disabled={!isDraft} placeholder="Cajamar/SP" value={f.local} onChange={(e) => setF({ ...f, local: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-data">Data do documento</Label>
            <Input id="e-data" type="date" disabled={!isDraft} value={f.data_documento} onChange={(e) => setF({ ...f, data_documento: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conteúdo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {def.sections.map((s) => (
            <div key={s.key} className="space-y-1.5">
              <Label htmlFor={`s-${s.key}`}>
                {s.label}
                {s.required && <span className="text-destructive"> *</span>}
              </Label>
              {s.hint && <p className="text-xs text-muted-foreground">{s.hint}</p>}
              <Textarea
                id={`s-${s.key}`}
                rows={6}
                disabled={!isDraft}
                value={f.conteudo[s.key] ?? ""}
                onChange={(e) => setF({ ...f, conteudo: { ...f.conteudo, [s.key]: e.target.value } })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {isDraft ? (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2 max-w-sm">
              <Label htmlFor="e-lh">Papel timbrado</Label>
              <Select value={lhId} onValueChange={setLhId}>
                <SelectTrigger id="e-lh" aria-label="Papel timbrado">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem papel timbrado</SelectItem>
                  {letterheads.filter((l) => l.ativo).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.nome}
                      {l.is_default ? " (padrão)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
                <Save className="w-4 h-4 mr-2" /> Salvar rascunho
              </Button>
              <Button variant="outline" onClick={() => openPdf(pdfData, pdfLh)}>
                <Printer className="w-4 h-4 mr-2" /> Pré-visualizar PDF
              </Button>
              <Button onClick={() => setConfirmEmit(true)}>
                <FileCheck2 className="w-4 h-4 mr-2" /> Emitir documento
              </Button>
              <Button variant="ghost" className="text-destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
                <Trash2 className="w-4 h-4 mr-2" /> Excluir rascunho
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-3">
            {doc.codigo && (
              <p className="text-sm text-muted-foreground">
                Código de verificação: <span className="font-mono text-foreground">{formatCodigo(doc.codigo)}</span>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => run(async () => (await pdf()).downloadDocumentPdf(doc, doc.letterhead))}>
                <Download className="w-4 h-4 mr-2" /> Baixar PDF
              </Button>
              <Button variant="outline" onClick={() => openPdf(doc, doc.letterhead)}>
                <Printer className="w-4 h-4 mr-2" /> Abrir para imprimir
              </Button>
              {doc.status === "emitido" && (
                <Button variant="ghost" className="text-destructive" onClick={() => setAnnulling(true)}>
                  Anular documento
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmEmit} onOpenChange={setConfirmEmit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Emitir este documento?</AlertDialogTitle>
            <AlertDialogDescription>
              Ele receberá número e código de verificação e <strong>não poderá mais ser alterado</strong>. Se houver erro, será preciso anulá-lo e emitir outro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                emit.mutate();
              }}
              disabled={emit.isPending}
            >
              {emit.isPending ? "Emitindo..." : "Emitir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={annulling} onOpenChange={setAnnulling}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anular documento</AlertDialogTitle>
            <AlertDialogDescription>O registro é mantido, marcado como anulado, e a verificação pública passa a exibir essa situação.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo da anulação</Label>
            <Textarea id="motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                annul.mutate();
              }}
              disabled={annul.isPending || motivo.trim().length < 5}
            >
              Anular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function DocumentEditor() {
  const { id = "" } = useParams();
  const doc = useQuery({ queryKey: ["document", id], queryFn: () => api<DocFull>(`/documents/${id}`), retry: false });
  const lhs = useQuery({ queryKey: ["letterheads"], queryFn: () => api<LetterheadRow[]>("/letterheads") });
  if (doc.isLoading || lhs.isLoading) return <p className="text-muted-foreground">Carregando...</p>;
  if (doc.isError || !doc.data) return <p className="text-destructive">Documento não encontrado.</p>;
  return <Editor key={`${doc.data.id}-${doc.data.status}`} doc={doc.data} letterheads={lhs.data ?? []} />;
}
