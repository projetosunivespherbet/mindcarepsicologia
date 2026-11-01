import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import type { Patient, Professional } from "@/lib/types";

export const formatBirth = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export function ProfessionalSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const pros = useQuery({ queryKey: ["professionals"], queryFn: () => api<Professional[]>("/professionals") });
  return (
    <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
      <SelectTrigger id={id} aria-label="Psicólogo responsável">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Sem responsável definido</SelectItem>
        {pros.data?.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.nome}
            {p.crp ? ` · CRP ${p.crp}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function Patients() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ nome: "", cpf: "", cns: "", data_nascimento: "", telefone: "", email: "", professional_id: "" });
  const list = useQuery({ queryKey: ["patients", q], queryFn: () => api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`) });

  const create = useMutation({
    mutationFn: () =>
      api<Patient>("/patients", {
        body: {
          nome: form.nome,
          cpf: form.cpf.trim() || null,
          cns: form.cns.trim() || null,
          data_nascimento: form.data_nascimento || null,
          telefone: form.telefone || null,
          email: form.email || null,
          professional_id: user?.role === "psicologo" ? undefined : form.professional_id || null,
        },
      }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ["patients"] });
      toast.success("Paciente cadastrado");
      navigate(`/pacientes/${p.id}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Pacientes</h1>
          <p className="text-sm text-muted-foreground">
            {user?.role === "psicologo" ? "Pacientes sob a sua responsabilidade." : "Pacientes da clínica."}
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4 mr-2" /> Novo paciente
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nome" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar paciente" />
      </div>

      <div className="rounded-xl border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Nascimento</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data?.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link to={`/pacientes/${p.id}`} className="font-medium text-primary hover:underline">
                    {p.nome}
                  </Link>
                </TableCell>
                <TableCell>{formatBirth(p.data_nascimento)}</TableCell>
                <TableCell>{p.telefone ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={p.ativo ? "default" : "secondary"}>{p.ativo ? "Ativo" : "Inativo"}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  Nenhum paciente encontrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo paciente</DialogTitle>
            <DialogDescription>A anamnese e os documentos são preenchidos depois, na ficha do paciente.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="p-nome">Nome completo</Label>
              <Input id="p-nome" required minLength={2} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="p-cpf">CPF</Label>
                <Input id="p-cpf" inputMode="numeric" placeholder="000.000.000-00" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-cns">CNS</Label>
                <Input id="p-cns" inputMode="numeric" placeholder="000 0000 0000 0000" value={form.cns} onChange={(e) => setForm({ ...form, cns: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="p-nasc">Nascimento</Label>
                <Input id="p-nasc" type="date" value={form.data_nascimento} onChange={(e) => setForm({ ...form, data_nascimento: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-tel">Telefone</Label>
                <Input id="p-tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-email">E-mail</Label>
              <Input id="p-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            {user?.role !== "psicologo" && (
              <div className="space-y-2">
                <Label htmlFor="p-resp">Psicólogo responsável</Label>
                <ProfessionalSelect id="p-resp" value={form.professional_id} onChange={(v) => setForm({ ...form, professional_id: v })} />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Salvando..." : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
