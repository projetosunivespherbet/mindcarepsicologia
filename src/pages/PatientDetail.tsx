import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { DocStatusBadge } from "@/components/DocStatusBadge";
import { PatientCharges } from "@/components/PatientCharges";
import { PatientPackages } from "@/components/PatientPackages";
import { PatientRecords } from "@/components/PatientRecords";
import { PatientTimeline } from "@/components/PatientTimeline";
import { Scales } from "@/components/Scales";
import { TherapyPlan } from "@/components/TherapyPlan";
import { AddressInput, montarEndereco, type Endereco } from "@/components/AddressInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import type { Anamnesis, DocListItem, PatientDetail as PatientDetailType } from "@/lib/types";
import { DOCUMENT_TYPES } from "@shared/documents";
import { ProfessionalSelect } from "./Patients";

const ANAMNESIS_FIELDS: { key: keyof Anamnesis; label: string }[] = [
  { key: "queixa_principal", label: "Queixa principal" },
  { key: "historico_familiar", label: "Histórico familiar" },
  { key: "medicamentos", label: "Medicamentos em uso" },
  { key: "tratamentos_anteriores", label: "Tratamentos anteriores" },
  { key: "expectativas", label: "Expectativas" },
];

/** Formulário completo do paciente: sem `patient`, cadastra um novo e abre a ficha; com `patient`, edita. */
export function DataForm({ patient }: { patient?: PatientDetailType }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState({
    nome: patient?.nome ?? "",
    cpf: patient?.cpf ?? "",
    cns: patient?.cns ?? "",
    observacoes: patient?.observacoes ?? "",
    end_cep: patient?.end_cep ?? "",
    end_logradouro: patient?.end_logradouro ?? "",
    end_numero: patient?.end_numero ?? "",
    end_complemento: patient?.end_complemento ?? "",
    end_bairro: patient?.end_bairro ?? "",
    end_cidade: patient?.end_cidade ?? "",
    end_uf: patient?.end_uf ?? "",
    responsavel_nome: patient?.responsavel_nome ?? "",
    responsavel_cpf: patient?.responsavel_cpf ?? "",
    responsavel_vinculo: patient?.responsavel_vinculo ?? "",
    responsavel_telefone: patient?.responsavel_telefone ?? "",
    data_nascimento: patient?.data_nascimento ?? "",
    telefone: patient?.telefone ?? "",
    email: patient?.email ?? "",
    genero: patient?.genero ?? "",
    estado_civil: patient?.estado_civil ?? "",
    profissao: patient?.profissao ?? "",
    professional_id: patient?.professional_id ?? "",
    ativo: patient?.ativo ?? true,
  });
  const partes: Endereco = {
    end_cep: f.end_cep, end_logradouro: f.end_logradouro, end_numero: f.end_numero, end_complemento: f.end_complemento,
    end_bairro: f.end_bairro, end_cidade: f.end_cidade, end_uf: f.end_uf,
  };
  const textoEndereco = montarEndereco(partes);
  // Endereço antigo (texto livre, sem partes): fica como está até alguém preencher os campos.
  const antigo = !textoEndereco && patient?.endereco ? patient.endereco : null;
  const enderecoBody = () =>
    antigo
      ? {}
      : {
          endereco: textoEndereco || null,
          ...Object.fromEntries(Object.entries(partes).map(([k, v]) => [k, v.trim() || null])),
        };
  const save = useMutation({
    mutationFn: () =>
      api<PatientDetailType>(patient ? `/patients/${patient.id}` : "/patients", {
        method: patient ? "PATCH" : "POST",
        body: {
          nome: f.nome,
          cpf: f.cpf.trim() || null,
          cns: f.cns.trim() || null,
          ...enderecoBody(),
          observacoes: f.observacoes.trim() || null,
          responsavel_nome: f.responsavel_nome.trim() || null,
          responsavel_cpf: f.responsavel_cpf.trim() || null,
          responsavel_vinculo: f.responsavel_vinculo.trim() || null,
          responsavel_telefone: f.responsavel_telefone.trim() || null,
          data_nascimento: f.data_nascimento || null,
          telefone: f.telefone || null,
          email: f.email || null,
          genero: f.genero || null,
          estado_civil: f.estado_civil || null,
          profissao: f.profissao || null,
          ...(patient ? { ativo: f.ativo } : {}),
          ...(user?.role === "psicologo" ? {} : { professional_id: f.professional_id || null }),
        },
      }),
    onSuccess: (salvo) => {
      void qc.invalidateQueries({ queryKey: ["patients"] });
      void qc.invalidateQueries({ queryKey: ["patients-all"] });
      if (!patient) {
        toast.success("Paciente cadastrado");
        navigate(`/pacientes/${salvo.id}`);
        return;
      }
      toast.success("Dados salvos");
      void qc.invalidateQueries({ queryKey: ["patient", patient.id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <h3 className="text-sm font-semibold text-muted-foreground sm:col-span-2">Identificação</h3>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="d-nome">Nome completo</Label>
        <Input id="d-nome" required value={f.nome} onChange={set("nome")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="d-cpf">CPF</Label>
        <Input id="d-cpf" inputMode="numeric" placeholder="000.000.000-00" value={f.cpf} onChange={set("cpf")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="d-cns">CNS (Cartão Nacional de Saúde)</Label>
        <Input id="d-cns" inputMode="numeric" placeholder="000 0000 0000 0000" value={f.cns} onChange={set("cns")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="d-nasc">Nascimento</Label>
        <Input id="d-nasc" type="date" value={f.data_nascimento} onChange={set("data_nascimento")} />
      </div>
      <h3 className="pt-2 text-sm font-semibold text-muted-foreground sm:col-span-2">Endereço e contato</h3>
      <div className="space-y-2 sm:col-span-2">
        {antigo && <p className="text-xs text-muted-foreground">Endereço cadastrado antes: {antigo}. Preencha os campos abaixo para atualizá-lo.</p>}
        <AddressInput id="d-end" value={partes} onChange={(v) => setF({ ...f, ...v })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="d-tel">Telefone</Label>
        <Input id="d-tel" value={f.telefone} onChange={set("telefone")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="d-email">E-mail</Label>
        <Input id="d-email" type="email" value={f.email} onChange={set("email")} />
      </div>
      <h3 className="pt-2 text-sm font-semibold text-muted-foreground sm:col-span-2">Dados complementares</h3>
      <div className="space-y-2">
        <Label htmlFor="d-gen">Gênero</Label>
        <Input id="d-gen" value={f.genero} onChange={set("genero")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="d-civil">Estado civil</Label>
        <Input id="d-civil" value={f.estado_civil} onChange={set("estado_civil")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="d-prof">Profissão</Label>
        <Input id="d-prof" value={f.profissao} onChange={set("profissao")} />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="d-obs">Observações sobre o paciente</Label>
        <Textarea id="d-obs" rows={3} maxLength={1000} placeholder="Recados abertos à equipe, inclusive à recepção. Conteúdo clínico vai no prontuário." value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
      </div>
      <fieldset className="grid gap-4 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium">Responsável legal (criança, adolescente ou pessoa sob curatela)</legend>
        <div className="space-y-2">
          <Label htmlFor="d-rl-nome">Nome do responsável</Label>
          <Input id="d-rl-nome" value={f.responsavel_nome} onChange={set("responsavel_nome")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-rl-vinc">Vínculo</Label>
          <Input id="d-rl-vinc" list="vinculos" placeholder="mãe, pai, tutor(a), curador(a)" value={f.responsavel_vinculo} onChange={set("responsavel_vinculo")} />
          <datalist id="vinculos">
            <option value="mãe" />
            <option value="pai" />
            <option value="tutor(a)" />
            <option value="curador(a)" />
            <option value="guardião(ã)" />
          </datalist>
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-rl-cpf">CPF do responsável</Label>
          <Input id="d-rl-cpf" inputMode="numeric" placeholder="000.000.000-00" value={f.responsavel_cpf} onChange={set("responsavel_cpf")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-rl-tel">Telefone do responsável</Label>
          <Input id="d-rl-tel" value={f.responsavel_telefone} onChange={set("responsavel_telefone")} />
        </div>
      </fieldset>
      {user?.role !== "psicologo" && (
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="d-resp">Psicólogo responsável</Label>
          <ProfessionalSelect id="d-resp" value={f.professional_id} onChange={(v) => setF({ ...f, professional_id: v })} />
        </div>
      )}
      {patient && (
        <div className="flex items-center gap-3 sm:col-span-2">
          <Switch id="d-ativo" checked={f.ativo} onCheckedChange={(v) => setF({ ...f, ativo: v })} />
          <Label htmlFor="d-ativo">Paciente ativo</Label>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Salvando..." : patient ? "Salvar dados" : "Cadastrar paciente"}
        </Button>
        {!patient && (
          <Button asChild type="button" variant="outline">
            <Link to="/pacientes">Cancelar</Link>
          </Button>
        )}
      </div>
    </form>
  );
}

function AnamnesisForm({ patient }: { patient: PatientDetailType }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Record<string, string>>(
    Object.fromEntries(ANAMNESIS_FIELDS.map(({ key }) => [key, patient.anamnesis?.[key] ?? ""])),
  );
  const save = useMutation({
    mutationFn: () => api(`/patients/${patient.id}/anamnesis`, { method: "PUT", body: f }),
    onSuccess: () => {
      toast.success("Anamnese salva");
      void qc.invalidateQueries({ queryKey: ["patient", patient.id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-4"
    >
      {ANAMNESIS_FIELDS.map(({ key, label }) => (
        <div key={key} className="space-y-2">
          <Label htmlFor={`a-${key}`}>{label}</Label>
          <Textarea id={`a-${key}`} rows={3} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
        </div>
      ))}
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? "Salvando..." : "Salvar anamnese"}
      </Button>
    </form>
  );
}

function PatientDocuments({ patientId }: { patientId: string }) {
  const docs = useQuery({ queryKey: ["documents", { patientId }], queryFn: () => api<DocListItem[]>(`/documents?patient_id=${patientId}`) });
  return (
    <div className="space-y-3">
      <Button asChild>
        <Link to={`/documentos/novo?paciente=${patientId}`}>
          <FilePlus2 className="w-4 h-4 mr-2" /> Novo documento
        </Link>
      </Button>
      <ul className="divide-y rounded-xl border bg-card">
        {docs.data?.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 p-3">
            <Link to={`/documentos/${d.id}`} className="min-w-0">
              <p className="font-medium text-primary hover:underline truncate">{d.titulo}</p>
              <p className="text-xs text-muted-foreground">
                {DOCUMENT_TYPES[d.tipo]?.label} · {d.numero ?? "sem número"} · {d.data_documento.split("-").reverse().join("/")}
              </p>
            </Link>
            <DocStatusBadge status={d.status} />
          </li>
        ))}
        {docs.data?.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nenhum documento para este paciente.</li>}
      </ul>
    </div>
  );
}

export default function PatientDetail() {
  const { id = "" } = useParams();
  const { user, canProduceDocuments } = useAuth();
  const q = useQuery({ queryKey: ["patient", id], queryFn: () => api<PatientDetailType>(`/patients/${id}`), retry: false });
  const p = q.data;

  const canClinical = !!user && !!p && ((user.role === "psicologo" && p.professional_id === user.id) || (user.role === "admin" && user.atende));

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link to="/pacientes">
          <ArrowLeft className="w-4 h-4 mr-1" /> Pacientes
        </Link>
      </Button>
      {q.isLoading && <p className="text-muted-foreground">Carregando...</p>}
      {q.isError && <p className="text-destructive">Paciente não encontrado ou sem permissão de acesso.</p>}
      {p && (
        <Card>
          <CardHeader>
            <CardTitle>{p.nome}</CardTitle>
            <CardDescription>{p.ativo ? "Paciente ativo" : "Paciente inativo"}</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="dados">
              <TabsList className="h-auto flex-wrap justify-start">
                <TabsTrigger value="dados">Dados</TabsTrigger>
                <TabsTrigger value="linha">Linha do tempo</TabsTrigger>
                {canClinical && <TabsTrigger value="prontuario">Prontuário</TabsTrigger>}
                {canClinical && <TabsTrigger value="plano">Plano terapêutico</TabsTrigger>}
                {canClinical && <TabsTrigger value="escalas">Escalas</TabsTrigger>}
                <TabsTrigger value="anamnese">Anamnese</TabsTrigger>
                {canProduceDocuments && <TabsTrigger value="documentos">Documentos</TabsTrigger>}
                <TabsTrigger value="cobrancas">Cobranças</TabsTrigger>
              </TabsList>
              <TabsContent value="dados" className="pt-4">
                <DataForm key={`${p.id}-${p.nome}`} patient={p} />
              </TabsContent>
              <TabsContent value="linha" className="pt-4">
                <PatientTimeline patientId={p.id} />
              </TabsContent>
              {canClinical && (
                <TabsContent value="plano" className="pt-4">
                  <TherapyPlan patientId={p.id} />
                </TabsContent>
              )}
              {canClinical && (
                <TabsContent value="escalas" className="pt-4">
                  <Scales patientId={p.id} />
                </TabsContent>
              )}
              {canClinical && (
                <TabsContent value="prontuario" className="pt-4">
                  <PatientRecords patientId={p.id} />
                </TabsContent>
              )}
              <TabsContent value="anamnese" className="pt-4">
                {canClinical ? (
                  <AnamnesisForm key={p.id} patient={p} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Os dados clínicos ficam restritos ao psicólogo responsável pelo paciente.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="cobrancas" className="space-y-6 pt-4">
                <PatientPackages patient={p} />
                <PatientCharges patient={p} />
              </TabsContent>
              {canProduceDocuments && (
                <TabsContent value="documentos" className="pt-4">
                  <PatientDocuments patientId={p.id} />
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
