import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Briefcase, Check, FileUp, Loader2, Paperclip, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/errors";

interface GestaoAtendimentoCardProps {
  psychologistId: string;
}

interface Row {
  id: string;
  patient_id: string;
  appointment_date: string;
  start_time: string;
  valor: number | null;
  payment_status: string;
  convenio: boolean;
  convenio_file_url: string | null;
  imposto: boolean;
  imposto_file_url: string | null;
  tipo: string;
}

const formatBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const PAYMENT_OPTIONS = [
  { value: "pago", label: "Pago" },
  { value: "nao_pago", label: "Não pago" },
  { value: "pendente", label: "Pendente" },
];

const ACCEPTED = ".pdf,.doc,.docx,image/*";

export const GestaoAtendimentoCard = ({ psychologistId }: GestaoAtendimentoCardProps) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [defaultValor, setDefaultValor] = useState<number>(() => {
    const s = localStorage.getItem(`mc_valor_consulta_${psychologistId}`);
    return s ? Number(s) : 150;
  });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("appointments")
      .select(
        "id, patient_id, appointment_date, start_time, valor, payment_status, convenio, convenio_file_url, imposto, imposto_file_url, status, tipo"
      )
      .eq("psychologist_id", psychologistId)
      .neq("status", "indisponivel")
      .order("appointment_date", { ascending: false })
      .order("start_time", { ascending: false });

    const list = (data || []) as Row[];
    setRows(list);

    const ids = Array.from(new Set(list.map((r) => r.patient_id)));
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, nome_completo, email")
        .in("user_id", ids);
      const map: Record<string, string> = {};
      (profs || []).forEach((p) => {
        map[p.user_id] = p.nome_completo?.trim() || p.email || "Paciente";
      });
      setNames(map);
    }
  }, [psychologistId]);

  useEffect(() => {
    if (psychologistId) load();
    const handler = () => load();
    window.addEventListener("mc:payment-updated", handler);
    window.addEventListener("mc:appointments-updated", handler);
    return () => {
      window.removeEventListener("mc:payment-updated", handler);
      window.removeEventListener("mc:appointments-updated", handler);
    };
  }, [psychologistId, load]);

  const syncConsultationPayment = async (patientId: string, payment: string) => {
    const { data: existing } = await supabase
      .from("consultations")
      .select("id")
      .eq("psychologist_id", psychologistId)
      .eq("patient_id", patientId)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("consultations")
        .update({ payment: payment as "pago" | "nao_pago" | "pendente" })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("consultations")
        .insert([{ psychologist_id: psychologistId, patient_id: patientId, payment: payment as "pago" | "nao_pago" | "pendente" }]);
    }
    window.dispatchEvent(new CustomEvent("mc:payment-updated"));
  };

  const persistDefault = (v: number) => {
    setDefaultValor(v);
    localStorage.setItem(`mc_valor_consulta_${psychologistId}`, String(v));
  };

  const updateRow = async (id: string, patch: Partial<Row>) => {
    setSavingId(id);
    const { error } = await supabase.from("appointments").update(patch).eq("id", id);
    setSavingId(null);
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("Conflito de agenda")) {
        toast({
          title: "Conflito de agenda",
          description: "Já existe outro atendimento neste horário. Marque como 'Grupo' nos dois atendimentos para permitir simultaneidade.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Erro ao salvar", description: friendlyError(error, "Não foi possível salvar. Tente novamente."), variant: "destructive" });
      }
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    window.dispatchEvent(new CustomEvent("mc:appointments-updated"));
    if (patch.payment_status) {
      const row = rows.find((r) => r.id === id);
      if (row) await syncConsultationPayment(row.patient_id, patch.payment_status);
    }
  };

  const handleValorBlur = (row: Row, raw: string) => {
    const v = raw === "" ? null : Number(raw);
    if (v !== null && Number.isNaN(v)) return;
    if (v === row.valor) return;
    updateRow(row.id, { valor: v });
  };

  const handleUpload = async (
    row: Row,
    field: "convenio_file_url" | "imposto_file_url",
    file: File
  ) => {
    setUploading(`${row.id}:${field}`);
    const ext = file.name.split(".").pop() || "bin";
    const path = `${psychologistId}/${row.id}/${field}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("appointment-docs").upload(path, file, {
      upsert: true,
      contentType: file.type || undefined,
    });
    if (error) {
      setUploading(null);
      toast({ title: "Falha no upload", description: friendlyError(error, "Não foi possível enviar o arquivo. Tente novamente."), variant: "destructive" });
      return;
    }
    await updateRow(row.id, { [field]: path } as Partial<Row>);
    setUploading(null);
    toast({ title: "Arquivo enviado" });
  };

  const handleOpenFile = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("appointment-docs")
      .createSignedUrl(path, 60);
    if (error || !data) {
      toast({ title: "Erro ao abrir arquivo", variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const handleRemoveFile = async (row: Row, field: "convenio_file_url" | "imposto_file_url") => {
    if (!row[field]) return;
    await supabase.storage.from("appointment-docs").remove([row[field] as string]);
    await updateRow(row.id, { [field]: null } as Partial<Row>);
  };

  const totalPago = useMemo(
    () =>
      rows
        .filter((r) => r.payment_status === "pago")
        .reduce((acc, r) => acc + Number(r.valor ?? defaultValor), 0),
    [rows, defaultValor]
  );
  const totalPendente = useMemo(
    () =>
      rows
        .filter((r) => r.payment_status !== "pago")
        .reduce((acc, r) => acc + Number(r.valor ?? defaultValor), 0),
    [rows, defaultValor]
  );

  return (
    <Card className="shadow-card border-0 mb-6">
      <CardContent className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-accent-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Gestão de Atendimento</h3>
              <p className="text-sm text-muted-foreground">
                Controle de orçamento por sessão — valores marcados como pagos alimentam o Faturamento
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Valor padrão R$/sessão</Label>
            <Input
              type="number"
              className="h-9 w-28"
              value={defaultValor}
              onChange={(e) => persistDefault(Number(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Total pago</p>
            <p className="text-lg font-bold text-foreground">{formatBRL(totalPago)}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">A receber</p>
            <p className="text-lg font-bold text-foreground">{formatBRL(totalPendente)}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Sessões</p>
            <p className="text-lg font-bold text-foreground">{rows.length}</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Nenhuma sessão registrada ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Dia</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead className="w-[130px]">Valor (R$)</TableHead>
                  <TableHead>Convênio</TableHead>
                  <TableHead>Imposto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const dateLabel = new Date(r.appointment_date + "T00:00:00").toLocaleDateString(
                    "pt-BR",
                    { day: "2-digit", month: "2-digit", year: "numeric" }
                  );
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {names[r.patient_id] || "Paciente"}
                      </TableCell>
                      <TableCell>
                        {dateLabel} <span className="text-muted-foreground">{r.start_time?.slice(0, 5)}</span>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={r.tipo || "individual"}
                          onValueChange={(v) => updateRow(r.id, { tipo: v })}
                        >
                          <SelectTrigger className="h-8 w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="individual">Individual</SelectItem>
                            <SelectItem value="grupo">Grupo</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={r.payment_status}
                          onValueChange={(v) => updateRow(r.id, { payment_status: v })}
                        >
                          <SelectTrigger className="h-8 w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PAYMENT_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="h-8 w-28"
                          defaultValue={r.valor ?? ""}
                          placeholder={String(defaultValor)}
                          onBlur={(e) => handleValorBlur(r, e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <FieldYesNoFile
                          flag={r.convenio}
                          fileUrl={r.convenio_file_url}
                          onToggle={(v) => updateRow(r.id, { convenio: v })}
                          onPickFile={() => fileRefs.current[`c-${r.id}`]?.click()}
                          onOpen={() => r.convenio_file_url && handleOpenFile(r.convenio_file_url)}
                          onRemove={() => handleRemoveFile(r, "convenio_file_url")}
                          uploading={uploading === `${r.id}:convenio_file_url`}
                        />
                        <input
                          ref={(el) => (fileRefs.current[`c-${r.id}`] = el)}
                          type="file"
                          accept={ACCEPTED}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleUpload(r, "convenio_file_url", f);
                            e.target.value = "";
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <FieldYesNoFile
                          flag={r.imposto}
                          fileUrl={r.imposto_file_url}
                          onToggle={(v) => updateRow(r.id, { imposto: v })}
                          onPickFile={() => fileRefs.current[`i-${r.id}`]?.click()}
                          onOpen={() => r.imposto_file_url && handleOpenFile(r.imposto_file_url)}
                          onRemove={() => handleRemoveFile(r, "imposto_file_url")}
                          uploading={uploading === `${r.id}:imposto_file_url`}
                        />
                        <input
                          ref={(el) => (fileRefs.current[`i-${r.id}`] = el)}
                          type="file"
                          accept={ACCEPTED}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleUpload(r, "imposto_file_url", f);
                            e.target.value = "";
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {savingId && (
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Salvando...
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

interface FieldProps {
  flag: boolean;
  fileUrl: string | null;
  onToggle: (v: boolean) => void;
  onPickFile: () => void;
  onOpen: () => void;
  onRemove: () => void;
  uploading: boolean;
}

const FieldYesNoFile = ({
  flag,
  fileUrl,
  onToggle,
  onPickFile,
  onOpen,
  onRemove,
  uploading,
}: FieldProps) => (
  <div className="flex items-center gap-1">
    <Select value={flag ? "sim" : "nao"} onValueChange={(v) => onToggle(v === "sim")}>
      <SelectTrigger className="h-8 w-[80px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="sim">Sim</SelectItem>
        <SelectItem value="nao">Não</SelectItem>
      </SelectContent>
    </Select>
    {flag && (
      <>
        {fileUrl ? (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="Abrir arquivo"
              onClick={onOpen}
            >
              <Paperclip className="w-4 h-4 text-primary" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="Remover"
              onClick={onRemove}
            >
              <X className="w-4 h-4" />
            </Button>
          </>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            title="Enviar arquivo"
            onClick={onPickFile}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileUp className="w-4 h-4" />
            )}
          </Button>
        )}
      </>
    )}
    {!flag && fileUrl && (
      <Check className="w-4 h-4 text-muted-foreground opacity-30" />
    )}
  </div>
);
