import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { Brain, ArrowRight, ArrowLeft, Check, X, LogOut } from "lucide-react";
import { validateStrongPassword, PASSWORD_RULE_TEXT } from "@/lib/passwordValidation";

const ESPECIALIDADES = [
  "Depressão",
  "Ansiedade",
  "Luto",
  "Transtornos Alimentares",
  "Terapia de Casal",
  "Psicologia Infantil",
  "TDAH",
  "Trauma e TEPT",
  "Dependência Química",
  "Autoestima",
  "Estresse",
  "Fobias",
];

const PsychologistOnboarding = () => {
  const { user, signUp, signIn, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  // Credentials (only used when there's no logged-in user yet)
  const [email, setEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [nomeCompleto, setNomeCompleto] = useState("");
  const [telefone, setTelefone] = useState("");
  const [crp, setCrp] = useState("");
  const [trajetoria, setTrajetoria] = useState("");
  const [especialidades, setEspecialidades] = useState<string[]>([]);

  const needsAccount = !user;

  // Password rule checks (live indicators)
  const pwChecks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password),
  };

  const emailsMatch = email && email === confirmEmail;
  const passwordsMatch = password && password === confirmPassword;
  const passwordStrong = validateStrongPassword(password) === null;

  const step1Valid = needsAccount
    ? !!nomeCompleto &&
      !!crp &&
      !!email &&
      emailsMatch &&
      passwordStrong &&
      passwordsMatch
    : !!nomeCompleto && !!crp;

  const toggleEspecialidade = (esp: string) => {
    setEspecialidades((prev) =>
      prev.includes(esp) ? prev.filter((e) => e !== esp) : [...prev, esp]
    );
  };

  const handleNextStep1 = async () => {
    if (!step1Valid) return;

    // If user is not signed in yet, create the account first
    if (needsAccount) {
      setIsLoading(true);
      try {
        await signUp(email, password);
        // Try to sign in immediately so the rest of the onboarding can write data
        try {
          await signIn(email, password);
        } catch {
          toast.success("Cadastro criado! Verifique seu e-mail para confirmar.");
          navigate(`/auth/psicologo`);
          return;
        }
        // Mark role for the freshly created profile
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          await supabase
            .from("profiles")
            .update({ role: "psicologo" })
            .eq("user_id", currentUser.id);
          await refreshProfile();
        }
      } catch (error: unknown) {
        toast.error(friendlyError(error, "Erro ao criar conta"));
        setIsLoading(false);
        return;
      }
      setIsLoading(false);
    }

    setStep(2);
  };

  const handleSubmit = async () => {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) {
      toast.error("Sessão expirada. Faça login novamente.");
      navigate("/auth/psicologo");
      return;
    }
    setIsLoading(true);
    try {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ nome_completo: nomeCompleto, telefone, onboarding_completed: true })
        .eq("user_id", currentUser.id);

      if (profileError) throw profileError;

      const { error: psychError } = await supabase
        .from("psychologist_profiles")
        .insert({
          user_id: currentUser.id,
          crp,
          trajetoria_profissional: trajetoria,
          especializacoes: especialidades,
        });

      if (psychError) throw psychError;

      await refreshProfile();
      const userEmail = currentUser.email || email;
      if (userEmail) sessionStorage.setItem("pending_email_confirm", userEmail);
      toast.success("Cadastro concluído!");
      navigate("/dashboard/psicologo");
    } catch (error: unknown) {
      toast.error(friendlyError(error, "Erro ao salvar dados"));
    } finally {
      setIsLoading(false);
    }
  };

  const RuleItem = ({ ok, label }: { ok: boolean; label: string }) => (
    <li className={`flex items-center gap-2 text-xs ${ok ? "text-primary" : "text-muted-foreground"}`}>
      {ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
      {label}
    </li>
  );

  const handleExit = async () => {
    if (user) {
      await signOut();
    }
    navigate("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center gradient-soft p-4">
      <div className="w-full max-w-lg animate-fade-in">
        <div className="flex justify-end mb-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleExit}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-4 h-4 mr-1" /> Sair
          </Button>
        </div>
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl gradient-primary mb-3">
            <Brain className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Cadastro Profissional</h1>
          <div className="flex justify-center gap-2 mt-4">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-2 rounded-full transition-all duration-300 ${
                  s <= step ? "w-12 gradient-primary" : "w-8 bg-muted"
                }`}
              />
            ))}
          </div>
        </div>

        <Card className="shadow-elevated border-0">
          <CardHeader>
            <CardTitle>
              {step === 1 && "Dados Pessoais"}
              {step === 2 && "Informações Profissionais"}
              {step === 3 && "Especializações"}
            </CardTitle>
            <CardDescription>
              {step === 1 && "Preencha seus dados básicos e crie suas credenciais"}
              {step === 2 && "Conte-nos sobre sua trajetória"}
              {step === 3 && "Selecione suas áreas de atuação"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Nome Completo</Label>
                  <Input value={nomeCompleto} onChange={(e) => setNomeCompleto(e.target.value)} placeholder="Dr(a). Nome Sobrenome" />
                </div>
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(11) 99999-9999" />
                </div>
                <div className="space-y-2">
                  <Label>CRP</Label>
                  <Input value={crp} onChange={(e) => setCrp(e.target.value)} placeholder="Ex: 06/123456" />
                </div>

                {needsAccount && (
                  <>
                    <div className="pt-2 border-t border-border">
                      <p className="text-sm font-medium text-foreground mb-3">Credenciais de acesso</p>
                    </div>
                    <div className="space-y-2">
                      <Label>E-mail</Label>
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="seu@email.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Confirmar E-mail</Label>
                      <Input
                        type="email"
                        value={confirmEmail}
                        onChange={(e) => setConfirmEmail(e.target.value)}
                        placeholder="Repita seu e-mail"
                      />
                      {confirmEmail && !emailsMatch && (
                        <p className="text-xs text-destructive">Os e-mails não coincidem</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Senha</Label>
                      <Input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={PASSWORD_RULE_TEXT}
                      />
                      {password && (
                        <ul className="space-y-1 mt-1">
                          <RuleItem ok={pwChecks.length} label="Mínimo 8 caracteres" />
                          <RuleItem ok={pwChecks.upper} label="Uma letra maiúscula" />
                          <RuleItem ok={pwChecks.lower} label="Uma letra minúscula" />
                          <RuleItem ok={pwChecks.special} label="Um caractere especial (!@#$...)" />
                        </ul>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Confirmar Senha</Label>
                      <Input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repita sua senha"
                      />
                      {confirmPassword && !passwordsMatch && (
                        <p className="text-xs text-destructive">As senhas não coincidem</p>
                      )}
                    </div>
                  </>
                )}

                <Button
                  onClick={handleNextStep1}
                  className="w-full gradient-primary text-primary-foreground"
                  disabled={!step1Valid || isLoading}
                >
                  {isLoading ? "Criando conta..." : <>Próximo <ArrowRight className="ml-2 w-4 h-4" /></>}
                </Button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Trajetória Profissional</Label>
                  <Textarea
                    value={trajetoria}
                    onChange={(e) => setTrajetoria(e.target.value)}
                    placeholder="Conte sobre sua formação, experiência e abordagem terapêutica..."
                    rows={6}
                  />
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                    <ArrowLeft className="mr-2 w-4 h-4" /> Voltar
                  </Button>
                  <Button onClick={() => setStep(3)} className="flex-1 gradient-primary text-primary-foreground">
                    Próximo <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {ESPECIALIDADES.map((esp) => (
                    <label
                      key={esp}
                      className={`flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                        especialidades.includes(esp)
                          ? "border-primary bg-accent"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <Checkbox
                        checked={especialidades.includes(esp)}
                        onCheckedChange={() => toggleEspecialidade(esp)}
                      />
                      <span className="text-sm font-medium">{esp}</span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                    <ArrowLeft className="mr-2 w-4 h-4" /> Voltar
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    className="flex-1 gradient-primary text-primary-foreground"
                    disabled={isLoading || especialidades.length === 0}
                  >
                    {isLoading ? "Salvando..." : "Concluir Cadastro"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PsychologistOnboarding;
