import type { FiscalStatus } from "@/lib/types";

export const DOC_STATUS: Record<FiscalStatus, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  rascunho: { label: "Rascunho", variant: "secondary" },
  emitida: { label: "Emitida", variant: "default" },
  cancelada: { label: "Cancelada", variant: "destructive" },
};
