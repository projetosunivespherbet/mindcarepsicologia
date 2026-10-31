import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, ArrowLeft, Users, Download, Eye, StickyNote, Calendar, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";

const formatBirthDate = (date: string | null) => {
  if (!date) return "—";
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${day}/${month}/${year}`;
};

interface PatientData {
  user_id: string;
  nome_completo: string | null;
  data_nascimento: string | null;
  genero: string | null;
  estado_civil: string | null;
  profissao: string | null;
  queixa_principal: string | null;
  historico_familiar: string | null;
  medicamentos: string | null;
  tratamentos_anteriores: string | null;
  expectativas: string | null;
}

interface ConsultationData {
  id: string;
  patient_id: string;
  notes: string | null;
  status: "em_andamento" | "finalizado" | "cancelado";
  next_appointment: string | null;
  payment: "pendente" | "pago" | "nao_pago";
}

type ConsultationPatch = Partial<Pick<ConsultationData, "notes" | "status" | "next_appointment" | "payment">>;

interface AppointmentData {
  id: string;
  patient_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: string;
}

const PsychologistPatients = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [patients, setPatients] = useState<PatientData[]>([]);
  const [consultations, setConsultations] = useState<ConsultationData[]>([]);
  const [appointments, setAppointments] = useState<AppointmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPatient, setSelectedPatient] = useState<PatientData | null>(null);
  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [notesPatientId, setNotesPatientId] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [fichaDialogOpen, setFichaDialogOpen] = useState(false);
  const [agendaDialogOpen, setAgendaDialogOpen] = useState(false);
  const [agendaPatient, setAgendaPatient] = useState<PatientData | null>(null);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data: links } = await supabase
      .from("psychologist_patients")
      .select("patient_id")
      .eq("psychologist_id", user.id);

    if (links && links.length > 0) {
      const patientIds = links.map((l) => l.patient_id);

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, nome_completo, email")
        .in("user_id", patientIds);

      const { data: patientProfiles } = await supabase
        .from("patient_profiles")
        .select("*")
        .in("user_id", patientIds);

      const merged: PatientData[] = patientIds.map((pid) => {
        const prof = profiles?.find((p) => p.user_id === pid);
        const pat = patientProfiles?.find((p) => p.user_id === pid);
        return {
          user_id: pid,
          nome_completo: prof?.nome_completo?.trim() || prof?.email || null,
          data_nascimento: pat?.data_nascimento || null,
          genero: pat?.genero || null,
          estado_civil: pat?.estado_civil || null,
          profissao: pat?.profissao || null,
          queixa_principal: pat?.queixa_principal || null,
          historico_familiar: pat?.historico_familiar || null,
          medicamentos: pat?.medicamentos || null,
          tratamentos_anteriores: pat?.tratamentos_anteriores || null,
          expectativas: pat?.expectativas || null,
        };
      });
      setPatients(merged);

      const { data: consults } = await supabase
        .from("consultations")
        .select("*")
        .eq("psychologist_id", user.id);

      setConsultations((consults as ConsultationData[]) || []);

      const { data: appts } = await supabase
        .from("appointments")
        .select("id, patient_id, appointment_date, start_time, end_time, status")
        .eq("psychologist_id", user.id)
        .order("appointment_date", { ascending: true })
        .order("start_time", { ascending: true });

      setAppointments((appts as AppointmentData[]) || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  useEffect(() => {
    const handler = () => { if (user) fetchData(); };
    window.addEventListener("mc:payment-updated", handler);
    window.addEventListener("mc:appointments-updated", handler);
    return () => {
      window.removeEventListener("mc:payment-updated", handler);
      window.removeEventListener("mc:appointments-updated", handler);
    };
  }, [user, fetchData]);

  const getConsultation = (patientId: string) =>
    consultations.find((c) => c.patient_id === patientId);

  const upsertConsultation = async (patientId: string, data: ConsultationPatch) => {
    if (!user) return;
    const existing = getConsultation(patientId);
    try {
      if (existing) {
        const { error } = await supabase
          .from("consultations")
          .update(data)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const insertData = { psychologist_id: user.id, patient_id: patientId, ...data };
        const { error } = await supabase
          .from("consultations")
          .insert([insertData]);
        if (error) throw error;
      }
      fetchData();
    } catch (e: unknown) {
      toast.error(friendlyError(e, "Erro ao salvar"));
    }
  };

  const handleSaveNotes = async () => {
    if (!notesPatientId) return;
    await upsertConsultation(notesPatientId, { notes: newNote });
    toast.success("Anotação salva!");
    setNotesDialogOpen(false);
    setNewNote("");
  };

  const downloadAnamnese = async (patient: PatientData) => {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Ficha de Anamnese", bold: true })] }),
          new Paragraph({ children: [new TextRun("")] }),
          new Paragraph({ children: [new TextRun({ text: "Nome: ", bold: true }), new TextRun(patient.nome_completo || "—")] }),
          new Paragraph({ children: [new TextRun({ text: "Data de Nascimento: ", bold: true }), new TextRun(patient.data_nascimento || "—")] }),
          new Paragraph({ children: [new TextRun({ text: "Gênero: ", bold: true }), new TextRun(patient.genero || "—")] }),
          new Paragraph({ children: [new TextRun({ text: "Estado Civil: ", bold: true }), new TextRun(patient.estado_civil || "—")] }),
          new Paragraph({ children: [new TextRun({ text: "Profissão: ", bold: true }), new TextRun(patient.profissao || "—")] }),
          new Paragraph({ children: [new TextRun("")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Queixa Principal", bold: true })] }),
          new Paragraph({ children: [new TextRun(patient.queixa_principal || "Não informado")] }),
          new Paragraph({ children: [new TextRun("")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Histórico Familiar", bold: true })] }),
          new Paragraph({ children: [new TextRun(patient.historico_familiar || "Não informado")] }),
          new Paragraph({ children: [new TextRun("")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Medicamentos", bold: true })] }),
          new Paragraph({ children: [new TextRun(patient.medicamentos || "Não informado")] }),
          new Paragraph({ children: [new TextRun("")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Tratamentos Anteriores", bold: true })] }),
          new Paragraph({ children: [new TextRun(patient.tratamentos_anteriores || "Não informado")] }),
          new Paragraph({ children: [new TextRun("")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Expectativas", bold: true })] }),
          new Paragraph({ children: [new TextRun(patient.expectativas || "Não informado")] }),
        ],
      }],
    });
    const blob = await Packer.toBlob(doc);
    saveAs(blob, `anamnese_${(patient.nome_completo || "paciente").replace(/\s+/g, "_")}.docx`);
    toast.success("Ficha baixada com sucesso!");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto flex items-center justify-between py-4 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard/psicologo")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
              <Brain className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">MindCare</h2>
              <p className="text-xs text-muted-foreground">Pacientes</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 md:p-8">
        <div className="mb-6 animate-fade-in flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Users className="w-6 h-6" /> Pacientes Ativos
            </h1>
            <p className="text-muted-foreground mt-1">Lista de todos os pacientes vinculados ao seu consultório</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Atualizar lista
          </Button>
        </div>

        <Card className="shadow-card border-0 animate-slide-up">
          <CardContent className="p-0 md:p-2">
            {loading ? (
              <p className="text-center py-8 text-muted-foreground">Carregando...</p>
            ) : patients.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p>Nenhum paciente vinculado ainda</p>
                <p className="text-sm">Pacientes aparecerão aqui quando se cadastrarem</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Nascimento</TableHead>
                      <TableHead>Anamnese</TableHead>
                      <TableHead>Histórico</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Próxima Consulta</TableHead>
                      <TableHead>Pagamento</TableHead>
                      <TableHead>Agenda</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patients.map((patient) => {
                      const consultation = getConsultation(patient.user_id);
                      return (
                        <TableRow key={patient.user_id}>
                          <TableCell className="font-medium">{patient.nome_completo || "—"}</TableCell>
                          <TableCell>{formatBirthDate(patient.data_nascimento)}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => { setSelectedPatient(patient); setFichaDialogOpen(true); }} title="Ver ficha">
                                <Eye className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => downloadAnamnese(patient)} title="Baixar Word">
                                <Download className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => { setNotesPatientId(patient.user_id); setNewNote(consultation?.notes || ""); setNotesDialogOpen(true); }}>
                              <StickyNote className="w-3 h-3 mr-1" />
                              {consultation?.notes ? "Editar" : "Adicionar"}
                            </Button>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={consultation?.status || "em_andamento"}
                              onValueChange={(v) => upsertConsultation(patient.user_id, { status: v as "em_andamento" | "finalizado" | "cancelado" }).then(() => toast.success("Status atualizado!"))}
                            >
                              <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="em_andamento">Em andamento</SelectItem>
                                <SelectItem value="finalizado">Finalizado</SelectItem>
                                <SelectItem value="cancelado">Cancelado</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <input
                              type="date"
                              className="border rounded px-2 py-1 text-xs bg-background text-foreground"
                              value={consultation?.next_appointment?.split("T")[0] || ""}
                              onChange={(e) => upsertConsultation(patient.user_id, { next_appointment: e.target.value || null }).then(() => toast.success("Próxima consulta atualizada!"))}
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={consultation?.payment || "pendente"}
                              onValueChange={async (v) => {
                                await upsertConsultation(patient.user_id, { payment: v as "pendente" | "pago" | "nao_pago" });
                                if (user) {
                                  await supabase
                                    .from("appointments")
                                    .update({ payment_status: v })
                                    .eq("psychologist_id", user.id)
                                    .eq("patient_id", patient.user_id);
                                }
                                window.dispatchEvent(new CustomEvent("mc:payment-updated"));
                                window.dispatchEvent(new CustomEvent("mc:appointments-updated"));
                                toast.success("Pagamento atualizado!");
                              }}
                            >
                              <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pago">Pago</SelectItem>
                                <SelectItem value="nao_pago">Não pago</SelectItem>
                                <SelectItem value="pendente">Pendente</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setAgendaPatient(patient); setAgendaDialogOpen(true); }}
                              title="Ver agendamentos"
                            >
                              <Calendar className="w-3 h-3 mr-1" /> Ver
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Dialog: Ver Ficha de Anamnese */}
      <Dialog open={fichaDialogOpen} onOpenChange={setFichaDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ficha de Anamnese — {selectedPatient?.nome_completo}</DialogTitle>
          </DialogHeader>
          {selectedPatient && (
            <div className="space-y-4 text-sm">
              <div><strong>Data de Nascimento:</strong> {formatBirthDate(selectedPatient.data_nascimento)}</div>
              <div><strong>Gênero:</strong> {selectedPatient.genero || "—"}</div>
              <div><strong>Estado Civil:</strong> {selectedPatient.estado_civil || "—"}</div>
              <div><strong>Profissão:</strong> {selectedPatient.profissao || "—"}</div>
              <hr className="border-border" />
              <div><strong>Queixa Principal:</strong><p className="mt-1 text-muted-foreground">{selectedPatient.queixa_principal || "Não informado"}</p></div>
              <div><strong>Histórico Familiar:</strong><p className="mt-1 text-muted-foreground">{selectedPatient.historico_familiar || "Não informado"}</p></div>
              <div><strong>Medicamentos:</strong><p className="mt-1 text-muted-foreground">{selectedPatient.medicamentos || "Não informado"}</p></div>
              <div><strong>Tratamentos Anteriores:</strong><p className="mt-1 text-muted-foreground">{selectedPatient.tratamentos_anteriores || "Não informado"}</p></div>
              <div><strong>Expectativas:</strong><p className="mt-1 text-muted-foreground">{selectedPatient.expectativas || "Não informado"}</p></div>
              <Button onClick={() => downloadAnamnese(selectedPatient)} className="w-full gradient-primary text-primary-foreground">
                <Download className="w-4 h-4 mr-2" /> Baixar como Word
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Anotações */}
      <Dialog open={notesDialogOpen} onOpenChange={setNotesDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anotações da Consulta</DialogTitle>
          </DialogHeader>
          <Textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Escreva suas anotações sobre a consulta..."
            rows={6}
          />
          <Button onClick={handleSaveNotes} className="w-full gradient-primary text-primary-foreground">
            Salvar Anotação
          </Button>
        </DialogContent>
      </Dialog>

      {/* Dialog: Agenda do paciente */}
      <Dialog open={agendaDialogOpen} onOpenChange={setAgendaDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              Agenda — {agendaPatient?.nome_completo || "Paciente"}
            </DialogTitle>
          </DialogHeader>
          {agendaPatient && (() => {
            const patientAppts = appointments.filter((a) => a.patient_id === agendaPatient.user_id);
            if (patientAppts.length === 0) {
              return (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p>Nenhum agendamento marcado.</p>
                </div>
              );
            }
            const formatDate = (d: string) => {
              const [y, m, day] = d.split("-");
              return `${day}/${m}/${y}`;
            };
            const formatTime = (t: string) => t.slice(0, 5);
            return (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {patientAppts.map((appt) => (
                  <div key={appt.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-accent/30">
                    <div>
                      <p className="font-medium text-foreground">{formatDate(appt.appointment_date)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(appt.start_time)} — {formatTime(appt.end_time)}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-md capitalize ${
                      appt.status === "agendado"
                        ? "bg-primary/15 text-primary"
                        : appt.status === "confirmado"
                        ? "bg-green-500/15 text-green-700 dark:text-green-300"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {appt.status}
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PsychologistPatients;
