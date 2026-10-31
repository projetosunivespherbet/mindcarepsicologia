import { Badge } from "@/components/ui/badge";

const MAP = {
  rascunho: { label: "Rascunho", variant: "secondary" as const },
  emitido: { label: "Emitido", variant: "default" as const },
  anulado: { label: "Anulado", variant: "destructive" as const },
};

export function DocStatusBadge({ status }: { status: keyof typeof MAP }) {
  const m = MAP[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
