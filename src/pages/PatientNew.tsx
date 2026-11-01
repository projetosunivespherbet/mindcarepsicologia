import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataForm } from "./PatientDetail";

/** Cadastro de paciente em tela cheia: o mesmo formulário completo da ficha. */
export default function PatientNew() {
  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link to="/pacientes">
          <ArrowLeft className="mr-1 h-4 w-4" /> Pacientes
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Novo paciente</CardTitle>
          <CardDescription>Só o nome é obrigatório. Anamnese, documentos e cobranças ficam na ficha, que abre ao cadastrar.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataForm />
        </CardContent>
      </Card>
    </div>
  );
}
