import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, History } from "lucide-react";
import { RecordEditor } from "@/components/RecordEditor";
import { RecordHistory, usePatientRecords } from "@/components/PatientRecords";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { api, errMsg } from "@/lib/api";
import { hhmm } from "@/lib/dates";
import type { PatientDetail } from "@/lib/types";

/** Tela de atendimento: prontuário em destaque, anotações privativas ao lado e o histórico do paciente sob demanda. */
export default function Atendimento() {
  const { id = "", sessao = "" } = useParams();
  const { user } = useAuth();
  const [historico, setHistorico] = useState(false);
  const patient = useQuery({ queryKey: ["patient", id], queryFn: () => api<PatientDetail>(`/patients/${id}`), retry: false });
  const records = usePatientRecords(id);
  const list = records.data ?? [];
  const current = list.find((r) => r.appointment_id === sessao);
  const author = user?.role === "psicologo" || (user?.role === "admin" && user.atende);

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link to="/agenda">
          <ArrowLeft className="mr-1 h-4 w-4" /> Agenda
        </Link>
      </Button>
      {!author && <p className="text-destructive">O prontuário é restrito ao psicólogo responsável.</p>}
      {records.isError && <p className="text-destructive">{errMsg(records.error)}</p>}
      {author && records.isSuccess && !current && <p className="text-muted-foreground">Sessão não encontrada ou ainda não iniciada.</p>}
      {author && current && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>{patient.data?.nome ?? "Paciente"}</CardTitle>
              <CardDescription>
                Atendimento de {new Date(current.starts_at).toLocaleDateString("pt-BR")}, {hhmm(current.starts_at)}–{hhmm(current.ends_at)}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" aria-expanded={historico} onClick={() => setHistorico(!historico)}>
                <History className="mr-2 h-4 w-4" /> {historico ? "Ocultar histórico" : "Histórico do paciente"}
              </Button>
              <Button asChild variant="ghost">
                <Link to={`/pacientes/${id}`}>Ficha</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {historico && (
              <section aria-label="Histórico do paciente" className="space-y-2">
                <h2 className="text-sm font-semibold">Sessões anteriores</h2>
                <RecordHistory list={list.filter((r) => r.appointment_id !== current.appointment_id)} />
              </section>
            )}
            <RecordEditor key={current.appointment_id} rec={current} onSaved={() => void records.refetch()} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
