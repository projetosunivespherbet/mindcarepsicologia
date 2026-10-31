import { Badge } from "@/components/ui/badge";
import type { Charge } from "@/lib/types";

/** Situação da nota fiscal de uma cobrança. Convênio e cobrança cancelada não mostram selo. */
export function NoteBadge({ charge }: { charge: Pick<Charge, "status" | "convenio" | "nota_status"> }) {
  if (charge.status === "cancelada" || charge.convenio) return null;
  if (charge.nota_status === "emitida") return <Badge variant="default">Nota emitida</Badge>;
  if (charge.nota_status === "rascunho") return <Badge variant="outline">Nota em rascunho</Badge>;
  return <Badge variant="secondary">Sem nota</Badge>;
}
