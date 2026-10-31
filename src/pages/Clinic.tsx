import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import type { Clinic } from "@/lib/types";

const TIMEZONES: [string, string][] = [
  ["America/Sao_Paulo", "Brasília (São Paulo, Rio, Sul, Sudeste, Goiás, DF)"],
  ["America/Bahia", "Bahia"],
  ["America/Fortaleza", "Fortaleza (Ceará, Maranhão, Piauí, Rio Grande do Norte)"],
  ["America/Recife", "Recife (Pernambuco, Paraíba, Alagoas, Sergipe)"],
  ["America/Belem", "Belém (Pará, Amapá, Tocantins)"],
  ["America/Cuiaba", "Cuiabá (Mato Grosso)"],
  ["America/Campo_Grande", "Campo Grande (Mato Grosso do Sul)"],
  ["America/Manaus", "Manaus (Amazonas)"],
  ["America/Porto_Velho", "Porto Velho (Rondônia)"],
  ["America/Boa_Vista", "Boa Vista (Roraima)"],
  ["America/Rio_Branco", "Rio Branco (Acre)"],
  ["America/Noronha", "Fernando de Noronha"],
];

const NONE = "nenhum";

/** Só para exibir: CPF e CNPJ numérico ganham máscara; o CNPJ alfanumérico aparece como foi guardado. */
function maskDoc(tipo: string, d: string) {
  if (tipo === "cpf" && /^\d{11}$/.test(d)) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (tipo === "cnpj" && /^\d{14}$/.test(d)) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d;
}

const emptyForm = { nome: "", timezone: "America/Sao_Paulo", tipo: NONE, documento: "", razao_social: "", telefone: "", email: "", endereco: "" };

export default function ClinicPage() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const clinic = useQuery({ queryKey: ["clinic"], queryFn: () => api<Clinic>("/clinic") });
  const [form, setForm] = useState(emptyForm);

  const load = (c: Clinic) =>
    setForm({
      nome: c.nome,
      timezone: c.timezone,
      tipo: c.documento_tipo ?? NONE,
      documento: c.documento ? maskDoc(c.documento_tipo ?? "", c.documento) : "",
      razao_social: c.razao_social ?? "",
      telefone: c.telefone ?? "",
      email: c.email ?? "",
      endereco: c.endereco ?? "",
    });

  useEffect(() => {
    if (clinic.data) load(clinic.data);
  }, [clinic.data]);

  const save = useMutation({
    mutationFn: () =>
      api<Clinic>("/clinic", {
        method: "PATCH",
        body: {
          nome: form.nome.trim(),
          timezone: form.timezone,
          documento_tipo: form.tipo === NONE ? null : form.tipo,
          documento: form.tipo === NONE ? null : form.documento.trim(),
          razao_social: form.razao_social.trim(),
          telefone: form.telefone.trim(),
          email: form.email.trim(),
          endereco: form.endereco.trim(),
        },
      }),
    onSuccess: async (c) => {
      qc.setQueryData(["clinic"], c);
      load(c);
      await refresh(); // o nome no topo da página acompanha a alteração
      toast.success("Dados da clínica salvos");
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  const zones = TIMEZONES.some(([z]) => z === form.timezone) ? TIMEZONES : [...TIMEZONES, [form.timezone, form.timezone] as [string, string]];
  const set = (k: keyof typeof emptyForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Clínica</h1>
        <p className="text-sm text-muted-foreground">Dados cadastrais usados nos documentos e na nota fiscal.</p>
      </div>

      {clinic.isError && <p className="text-sm text-destructive">{errMsg(clinic.error)}</p>}

      <form onSubmit={submit} className="rounded-xl border bg-card p-5 space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="c-nome">Nome da clínica</Label>
            <Input id="c-nome" required minLength={2} maxLength={160} value={form.nome} onChange={set("nome")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-razao">Razão social (opcional)</Label>
            <Input id="c-razao" maxLength={160} value={form.razao_social} onChange={set("razao_social")} />
          </div>
        </div>

        <div className="grid sm:grid-cols-[180px_1fr] gap-4">
          <div className="space-y-2">
            <Label>Documento</Label>
            <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v, documento: v === NONE ? "" : form.documento })}>
              <SelectTrigger aria-label="Tipo de documento">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Não informado</SelectItem>
                <SelectItem value="cnpj">CNPJ</SelectItem>
                <SelectItem value="cpf">CPF</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-doc">{form.tipo === "cpf" ? "CPF" : form.tipo === "cnpj" ? "CNPJ" : "Número"}</Label>
            <Input
              id="c-doc"
              disabled={form.tipo === NONE}
              required={form.tipo !== NONE}
              inputMode="text"
              maxLength={30}
              placeholder={form.tipo === "cpf" ? "000.000.000-00" : form.tipo === "cnpj" ? "00.000.000/0000-00" : "Escolha CNPJ ou CPF"}
              value={form.documento}
              onChange={set("documento")}
            />
            {form.tipo !== NONE && <p className="text-xs text-muted-foreground">Os dígitos verificadores são conferidos ao salvar.</p>}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="c-tel">Telefone (opcional)</Label>
            <Input id="c-tel" maxLength={30} value={form.telefone} onChange={set("telefone")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-email">E-mail (opcional)</Label>
            <Input id="c-email" type="email" maxLength={160} value={form.email} onChange={set("email")} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="c-end">Endereço (opcional)</Label>
          <Input id="c-end" maxLength={300} placeholder="Rua, número, bairro, cidade/UF, CEP" value={form.endereco} onChange={set("endereco")} />
        </div>

        <div className="space-y-2">
          <Label>Fuso horário</Label>
          <Select value={form.timezone} onValueChange={(v) => setForm({ ...form, timezone: v })}>
            <SelectTrigger aria-label="Fuso horário">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {zones.map(([z, label]) => (
                <SelectItem key={z} value={z}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Define as datas e os horários da agenda, do financeiro e da numeração dos documentos.</p>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={!clinic.data || save.isPending} onClick={() => clinic.data && load(clinic.data)}>
            Desfazer alterações
          </Button>
          <Button type="submit" disabled={clinic.isLoading || save.isPending}>
            {save.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
