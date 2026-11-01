import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AttentionItem } from "@/lib/types";

/** Aviso na agenda: pacientes que podem estar se afastando (faltas seguidas ou sem retorno marcado). */
export function AttentionBanner({ proName, showPro }: { proName: Map<string, string>; showPro: boolean }) {
  const q = useQuery({ queryKey: ["appointments", "attention"], queryFn: () => api<AttentionItem[]>("/appointments/attention") });
  const lista = q.data ?? [];
  if (lista.length === 0) return null;
  return (
    <details className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {lista.length === 1 ? "1 paciente pode estar se afastando" : `${lista.length} pacientes podem estar se afastando`}
      </summary>
      <ul className="mt-2 divide-y">
        {lista.map((a) => (
          <li key={`${a.patient_id}-${a.professional_id}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span>
              <Link to={`/pacientes/${a.patient_id}`} className="font-medium text-primary hover:underline">
                {a.nome}
              </Link>
              {" · "}
              {a.motivo === "faltas_seguidas" ? "faltou às duas últimas sessões" : `sem sessão há ${a.dias} dias e sem retorno marcado`}
              {showPro && proName.get(a.professional_id) ? ` · ${proName.get(a.professional_id)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">Vale um contato: um lembrete, uma remarcação ou o registro de alta.</p>
    </details>
  );
}
