import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
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
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["patients", q], queryFn: () => api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Pacientes</h1>
          <p className="text-sm text-muted-foreground">
            {user?.role === "psicologo" ? "Pacientes sob a sua responsabilidade." : "Pacientes da clínica."}
          </p>
        </div>
        <Button onClick={() => navigate("/pacientes/novo")}>
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

    </div>
  );
}
