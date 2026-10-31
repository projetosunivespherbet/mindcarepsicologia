import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errMsg } from "@/lib/api";
import { brl } from "@/lib/money";

interface Entry {
  id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  changes: Record<string, unknown>;
  at: string;
  usuario: string | null;
}

// Só os campos que fazem sentido para quem lê; ids e carimbos técnicos ficam de fora.
const LABELS: Record<string, string> = {
  valor: "Valor",
  valor_centavos: "Valor",
  desconto_centavos: "Desconto",
  paid_centavos: "Valor pago",
  status: "Situação",
  atendimento: "Tipo de atendimento",
  payment_status: "Pagamento",
  convenio: "Convênio",
  imposto: "Imposto recolhido",
  imposto_recolhido: "Imposto recolhido",
  starts_at: "Início",
  ends_at: "Fim",
  vencimento: "Vencimento",
  competencia: "Competência",
  forma_prevista: "Forma prevista",
  descricao: "Descrição",
  nome: "Nome",
  ativo: "Ativo",
  numero_nfse: "Número da nota",
  chave_acesso: "Chave de acesso",
  cancel_reason: "Motivo do cancelamento",
  cancel_motivo: "Motivo do cancelamento",
  cpf: "CPF",
  telefone: "Telefone",
  email: "E-mail",
  tomador: "Tomador",
};

const ACTION: Record<Entry["action"], string> = { INSERT: "criou", UPDATE: "alterou", DELETE: "apagou" };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Formata um valor guardado no histórico (números de `valor` estão em reais; `*_centavos` em centavos). */
export function formatValue(key: string, v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return (v as { alterado?: boolean }).alterado ? "alterado" : JSON.stringify(v);
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (key === "valor" && typeof v === "number") return brl(Math.round(v * 100));
  if (key.endsWith("_centavos") && typeof v === "number") return brl(v);
  if (typeof v === "string" && ISO.test(v)) return dateTime(v);
  return String(v);
}

function Line({ entry }: { entry: Entry }) {
  const rows = Object.entries(entry.changes).filter(([k]) => LABELS[k]);
  return (
    <li className="p-3 text-sm space-y-1">
      <p className="text-xs text-muted-foreground">
        {dateTime(entry.at)} · {entry.usuario ?? "sistema"} {ACTION[entry.action]}
      </p>
      {rows.length === 0 && <p className="text-muted-foreground">Sem campos para exibir.</p>}
      <ul className="space-y-0.5">
        {rows.map(([k, v]) => {
          const change = entry.action === "UPDATE" && v && typeof v === "object" && "de" in (v as object);
          const { de, para } = (change ? v : {}) as { de?: unknown; para?: unknown };
          return (
            <li key={k}>
              <span className="font-medium">{LABELS[k]}:</span> {change ? `${formatValue(k, de)} → ${formatValue(k, para)}` : formatValue(k, v)}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/** Histórico de alterações de um registro (só a administração consegue abrir). */
export function ChangeHistory({ table, rowId, open, onClose, title }: { table: string; rowId: string | null; open: boolean; onClose: () => void; title: string }) {
  const q = useQuery({
    queryKey: ["history", table, rowId],
    queryFn: () => api<Entry[]>(`/audit/changes?table=${table}&row_id=${rowId}`),
    enabled: open && !!rowId,
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Cada mudança fica registrada com o valor antigo e o novo, e não pode ser apagada.</DialogDescription>
        </DialogHeader>
        {q.isError && <p className="text-sm text-destructive">{errMsg(q.error, "Não foi possível carregar o histórico.")}</p>}
        <ul className="max-h-[60vh] overflow-y-auto divide-y rounded-xl border bg-card">
          {q.data?.map((e) => <Line key={e.id} entry={e} />)}
          {q.data?.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Nenhuma alteração registrada.</li>}
          {q.isLoading && <li className="p-4 text-center text-sm text-muted-foreground">Carregando...</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
