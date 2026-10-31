import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { Pencil, Save, X } from "lucide-react";

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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const PsychologistProfileDialog = ({ open, onOpenChange }: Props) => {
  const { user, profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const [nomeCompleto, setNomeCompleto] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [crp, setCrp] = useState("");
  const [trajetoria, setTrajetoria] = useState("");
  const [especialidades, setEspecialidades] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !user) return;
    const load = async () => {
      setLoading(true);
      try {
        const { data: psych } = await supabase
          .from("psychologist_profiles")
          .select("crp, trajetoria_profissional, especializacoes")
          .eq("user_id", user.id)
          .maybeSingle();

        setNomeCompleto(profile?.nome_completo || "");
        setTelefone(profile?.telefone || "");
        setEmail(profile?.email || user.email || "");
        setCrp(psych?.crp || "");
        setTrajetoria(psych?.trajetoria_profissional || "");
        setEspecialidades(psych?.especializacoes || []);
      } catch {
        toast.error("Erro ao carregar perfil");
      } finally {
        setLoading(false);
      }
    };
    load();
    setEditing(false);
  }, [open, user, profile]);

  const toggleEspecialidade = (esp: string) => {
    if (!editing) return;
    setEspecialidades((prev) =>
      prev.includes(esp) ? prev.filter((e) => e !== esp) : [...prev, esp]
    );
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ nome_completo: nomeCompleto, telefone })
        .eq("user_id", user.id);
      if (profileError) throw profileError;

      const { error: psychError } = await supabase
        .from("psychologist_profiles")
        .update({
          crp,
          trajetoria_profissional: trajetoria,
          especializacoes: especialidades,
        })
        .eq("user_id", user.id);
      if (psychError) throw psychError;

      await refreshProfile();
      toast.success("Perfil atualizado com sucesso!");
      setEditing(false);
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Erro ao salvar perfil"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Perfil Profissional</DialogTitle>
          <DialogDescription>
            {editing
              ? "Edite suas informações e clique em salvar"
              : "Visualize e edite as informações cadastradas"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 text-center text-muted-foreground">Carregando...</div>
        ) : (
          <div className="space-y-5 py-2">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome Completo</Label>
                <Input
                  value={nomeCompleto}
                  onChange={(e) => setNomeCompleto(e.target.value)}
                  disabled={!editing}
                />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  disabled={!editing}
                  placeholder="(11) 99999-9999"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input value={email} disabled />
              </div>
              <div className="space-y-2">
                <Label>CRP</Label>
                <Input
                  value={crp}
                  onChange={(e) => setCrp(e.target.value)}
                  disabled={!editing}
                  placeholder="Ex: 06/123456"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Trajetória Profissional</Label>
              <Textarea
                value={trajetoria}
                onChange={(e) => setTrajetoria(e.target.value)}
                disabled={!editing}
                rows={5}
                placeholder="Conte sobre sua formação, experiência e abordagem terapêutica..."
              />
            </div>

            <div className="space-y-2">
              <Label>Especializações</Label>
              <div className="grid grid-cols-2 gap-2">
                {ESPECIALIDADES.map((esp) => {
                  const selected = especialidades.includes(esp);
                  return (
                    <label
                      key={esp}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border-2 transition-all duration-200 ${
                        editing ? "cursor-pointer" : "cursor-default opacity-90"
                      } ${
                        selected
                          ? "border-primary bg-accent"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleEspecialidade(esp)}
                        disabled={!editing}
                      />
                      <span className="text-sm font-medium">{esp}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {!editing ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button
                onClick={() => setEditing(true)}
                className="gradient-primary text-primary-foreground"
                disabled={loading}
              >
                <Pencil className="w-4 h-4 mr-2" /> Editar perfil
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                <X className="w-4 h-4 mr-2" /> Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="gradient-primary text-primary-foreground"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? "Salvando..." : "Salvar alterações"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
