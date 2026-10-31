import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { DocStatusBadge } from "@/components/DocStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import type { DocFull, DocListItem, Patient } from "@/lib/types";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_KEYS, fillTemplate, type DocumentTypeKey } from "@shared/documents";

export function DocumentList() {
  const [status, setStatus] = useState("todos");
  const docs = useQuery({
    queryKey: ["documents", { status }],
    queryFn: () => api<DocListItem[]>(`/documents${status === "todos" ? "" : `?status=${status}`}`),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Documentos</h1>
          <p className="text-sm text-muted-foreground">Documentos psicológicos que você produziu.</p>
        </div>
        <div className="flex gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40" aria-label="Filtrar por situação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="rascunho">Rascunhos</SelectItem>
              <SelectItem value="emitido">Emitidos</SelectItem>
              <SelectItem value="anulado">Anulados</SelectItem>
            </SelectContent>
          </Select>
          <Button asChild>
            <Link to="/documentos/novo">
              <FilePlus2 className="w-4 h-4 mr-2" /> Novo documento
            </Link>
          </Button>
        </div>
      </div>
      <div className="rounded-xl border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Documento</TableHead>
              <TableHead>Paciente</TableHead>
              <TableHead>Nº</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.data?.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <Link to={`/documentos/${d.id}`} className="font-medium text-primary hover:underline">
                    {d.titulo}
                  </Link>
                  <p className="text-xs text-muted-foreground">{DOCUMENT_TYPES[d.tipo]?.label}</p>
                </TableCell>
                <TableCell>{d.paciente_nome}</TableCell>
                <TableCell>{d.numero ?? "—"}</TableCell>
                <TableCell>{d.data_documento.split("-").reverse().join("/")}</TableCell>
                <TableCell>
                  <DocStatusBadge status={d.status} />
                </TableCell>
              </TableRow>
            ))}
            {docs.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Nenhum documento.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function DocumentNew() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [patientId, setPatientId] = useState(params.get("paciente") ?? "");
  const [tipo, setTipo] = useState<DocumentTypeKey | "">("");
  const patients = useQuery({ queryKey: ["patients", ""], queryFn: () => api<Patient[]>("/patients") });

  const create = useMutation({
    mutationFn: () => {
      const def = DOCUMENT_TYPES[tipo as DocumentTypeKey];
      const patient = patients.data!.find((p) => p.id === patientId)!;
      const ctx = { paciente: patient.nome, psicologo: user!.nome, crp: user!.crp ?? "", clinica: user!.clinic_nome };
      const conteudo = Object.fromEntries(def.sections.filter((s) => s.template).map((s) => [s.key, fillTemplate(s.template!, ctx)]));
      return api<DocFull>("/documents", { body: { patient_id: patientId, tipo, conteudo } });
    },
    onSuccess: (d) => navigate(`/documentos/${d.id}`),
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Novo documento</h1>
        <p className="text-sm text-muted-foreground">Escolha a pessoa atendida e o tipo de documento.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pessoa atendida</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="n-pac">Paciente</Label>
          <Select value={patientId} onValueChange={setPatientId}>
            <SelectTrigger id="n-pac" aria-label="Paciente">
              <SelectValue placeholder="Selecione o paciente" />
            </SelectTrigger>
            <SelectContent>
              {patients.data?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tipo de documento</CardTitle>
          <CardDescription>Os seis primeiros seguem as modalidades da Resolução CFP nº 06/2019.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {DOCUMENT_TYPE_KEYS.map((k) => {
            const d = DOCUMENT_TYPES[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => setTipo(k)}
                aria-pressed={tipo === k}
                className={`text-left rounded-lg border p-3 transition-colors ${tipo === k ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{d.label}</span>
                  <Badge variant={d.cfp ? "default" : "secondary"} className="text-[10px]">
                    {d.cfp ? "CFP 06/2019" : "Clínica"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{d.descricao}</p>
              </button>
            );
          })}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Recibos de atendimento não são emitidos aqui: pessoa física usa o Receita Saúde e pessoa jurídica emite NFS-e.
      </p>
      <Button disabled={!patientId || !tipo || create.isPending} onClick={() => create.mutate()}>
        {create.isPending ? "Criando..." : "Criar rascunho"}
      </Button>
    </div>
  );
}
