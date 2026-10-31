import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errMsg } from "@/lib/api";
import { ROLE_LABEL, type AppUser, type InviteLink, type Role } from "@/lib/types";

const STATUS_LABEL = { convidado: "Convite pendente", ativo: "Ativo", inativo: "Inativo" } as const;

function LinkDialog({ nome, invite, onClose }: { nome: string; invite: InviteLink | null; onClose: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite!.link);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar; selecione e copie o link manualmente.");
    }
  };
  return (
    <Dialog open={!!invite} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link para {nome}</DialogTitle>
          <DialogDescription>
            Envie este link à pessoa (por exemplo, pelo WhatsApp). Ele aparece só agora, vale uma vez
            {invite ? ` e expira em ${new Date(invite.expires_at).toLocaleDateString("pt-BR")}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={invite?.link ?? ""} onFocus={(e) => e.currentTarget.select()} aria-label="Link do convite" />
          <Button type="button" variant="outline" onClick={copy} aria-label="Copiar link">
            <Copy className="w-4 h-4" />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Users() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<AppUser[]>("/users") });
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<{ nome: string; invite: InviteLink } | null>(null);
  const [form, setForm] = useState({ nome: "", role: "psicologo" as Role, crp: "", atende: false, telefone: "", email: "" });

  const create = useMutation({
    mutationFn: () =>
      api<{ user: AppUser; invite: InviteLink }>("/users", {
        body: {
          nome: form.nome,
          role: form.role,
          crp: form.crp.trim() || undefined,
          atende: form.role === "admin" ? form.atende : undefined,
          telefone: form.telefone.trim() || undefined,
          email: form.email.trim() || undefined,
        },
      }),
    onSuccess: (r) => {
      setCreating(false);
      setLink({ nome: r.user.nome, invite: r.invite });
      setForm({ nome: "", role: "psicologo", crp: "", atende: false, telefone: "", email: "" });
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const newLink = useMutation({
    mutationFn: (u: AppUser) => api<InviteLink>(`/users/${u.id}/invite`, { body: {} }).then((invite) => ({ u, invite })),
    onSuccess: ({ u, invite }) => setLink({ nome: u.nome, invite }),
    onError: (e) => toast.error(errMsg(e)),
  });

  const setStatus = useMutation({
    mutationFn: (v: { u: AppUser; status: "ativo" | "inativo" }) => api(`/users/${v.u.id}`, { method: "PATCH", body: { status: v.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e) => toast.error(errMsg(e)),
  });

  const needsCrp = form.role === "psicologo" || (form.role === "admin" && form.atende);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Usuários</h1>
          <p className="text-sm text-muted-foreground">Pré-cadastre a equipe e entregue o link de acesso.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4 mr-2" /> Novo usuário
        </Button>
      </div>

      <div className="rounded-xl border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>CRP</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data?.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <p className="font-medium">{u.nome}</p>
                  <p className="text-xs text-muted-foreground">{u.email ?? "e-mail será informado no aceite"}</p>
                </TableCell>
                <TableCell>
                  {ROLE_LABEL[u.role]}
                  {u.role === "admin" && u.atende && <span className="text-xs text-muted-foreground"> · atende</span>}
                </TableCell>
                <TableCell>{u.crp ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={u.status === "ativo" ? "default" : "secondary"}>{STATUS_LABEL[u.status]}</Badge>
                </TableCell>
                <TableCell className="text-right space-x-1 whitespace-nowrap">
                  {u.status !== "inativo" && (
                    <Button size="sm" variant="outline" onClick={() => newLink.mutate(u)} disabled={newLink.isPending}>
                      <KeyRound className="w-3.5 h-3.5 mr-1" /> {u.status === "convidado" ? "Novo convite" : "Redefinir senha"}
                    </Button>
                  )}
                  {u.status === "inativo" ? (
                    <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ u, status: "ativo" })}>
                      <UserCheck className="w-3.5 h-3.5 mr-1" /> Reativar
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ u, status: "inativo" })}>
                      <UserX className="w-3.5 h-3.5 mr-1" /> Desativar
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {users.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Nenhum usuário.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo usuário</DialogTitle>
            <DialogDescription>A pessoa define e-mail e senha ao abrir o link que você receberá em seguida.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="u-nome">Nome completo</Label>
              <Input id="u-nome" required minLength={2} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                <SelectTrigger aria-label="Papel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="psicologo">Psicólogo(a)</SelectItem>
                  <SelectItem value="recepcao">Recepção</SelectItem>
                  <SelectItem value="admin">Administração</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.role === "admin" && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="u-atende">Também atende pacientes</Label>
                  <p className="text-xs text-muted-foreground">Exige CRP e libera prontuário e documentos.</p>
                </div>
                <Switch id="u-atende" checked={form.atende} onCheckedChange={(v) => setForm({ ...form, atende: v })} />
              </div>
            )}
            {needsCrp && (
              <div className="space-y-2">
                <Label htmlFor="u-crp">CRP</Label>
                <Input id="u-crp" required placeholder="06/123456" value={form.crp} onChange={(e) => setForm({ ...form, crp: e.target.value })} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="u-tel">Telefone (opcional)</Label>
                <Input id="u-tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="u-email">E-mail (opcional)</Label>
                <Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Criando..." : "Criar e gerar link"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <LinkDialog nome={link?.nome ?? ""} invite={link?.invite ?? null} onClose={() => setLink(null)} />
    </div>
  );
}
