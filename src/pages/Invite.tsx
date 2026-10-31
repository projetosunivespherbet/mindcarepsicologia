import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Brain } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { PASSWORD_RULE_TEXT, validateStrongPassword } from "@/lib/passwordValidation";
import { ROLE_LABEL, type Role } from "@/lib/types";

interface InviteInfo {
  kind: "convite" | "redefinicao";
  nome: string;
  role: Role;
  email: string | null;
  clinic_nome: string;
}

export default function Invite() {
  const { token = "" } = useParams();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<InviteInfo>(`/invites/${encodeURIComponent(token)}`, { auth: false }),
    retry: false,
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const rule = validateStrongPassword(password);
    if (rule) return toast.error(rule);
    if (password !== confirm) return toast.error("As senhas não conferem");
    setBusy(true);
    try {
      const isInvite = info.data?.kind === "convite";
      await acceptInvite(token, password, isInvite ? (email.trim() || info.data?.email || undefined) : undefined);
      toast.success(isInvite ? "Cadastro concluído" : "Senha redefinida");
      navigate("/");
    } catch (err) {
      toast.error(errMsg(err, "Não foi possível concluir"));
    } finally {
      setBusy(false);
    }
  };

  const data = info.data;
  return (
    <div className="min-h-screen flex items-center justify-center gradient-soft p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl gradient-primary mb-4">
            <Brain className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold">MindCare</h1>
        </div>
        <Card className="shadow-elevated border-0">
          {info.isLoading && <CardContent className="py-10 text-center text-muted-foreground">Verificando convite...</CardContent>}
          {info.isError && (
            <CardContent className="py-8 text-center space-y-3">
              <p className="font-medium">Convite inválido ou expirado</p>
              <p className="text-sm text-muted-foreground">Peça um novo link à administração da clínica.</p>
              <Button asChild variant="outline">
                <Link to="/entrar">Ir para o login</Link>
              </Button>
            </CardContent>
          )}
          {data && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="text-xl">{data.kind === "convite" ? `Olá, ${data.nome}` : "Redefinir senha"}</CardTitle>
                <CardDescription>
                  {data.kind === "convite"
                    ? `${data.clinic_nome} convidou você como ${ROLE_LABEL[data.role]}. Informe seu e-mail e crie uma senha.`
                    : `Crie uma nova senha para acessar ${data.clinic_nome}.`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submit} className="space-y-4">
                  {data.kind === "convite" && (
                    <div className="space-y-2">
                      <Label htmlFor="email">E-mail</Label>
                      <Input id="email" type="email" required defaultValue={data.email ?? ""} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="senha">Senha</Label>
                    <Input id="senha" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                    <p className="text-xs text-muted-foreground">{PASSWORD_RULE_TEXT}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirma">Confirmar senha</Label>
                    <Input id="confirma" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? "Salvando..." : data.kind === "convite" ? "Concluir cadastro" : "Salvar nova senha"}
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
