import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addDays, toDateStr, weekStart } from "@/lib/dates";

/** Primeiro e último instante exibidos na grade do mês (semanas completas, segunda a domingo). */
export function monthGridRange(ym: string): { first: Date; last: Date } {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const first = weekStart(new Date(y, m - 1, 1));
  const last = addDays(weekStart(new Date(y, m, 0)), 7);
  return { first, last };
}

const WEEKDAYS = ["S", "T", "Q", "Q", "S", "S", "D"];

/** Calendário do mês: dia selecionado em destaque e um ponto nos dias que têm sessões. */
export function MiniCalendar({
  selected,
  marked,
  month,
  onMonth,
  onSelect,
}: {
  selected: string; // AAAA-MM-DD
  marked: Set<string>;
  month: string; // AAAA-MM mostrado
  onMonth: (ym: string) => void;
  onSelect: (date: string) => void;
}) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const { first } = monthGridRange(month);
  const weeks = Math.round((monthGridRange(month).last.getTime() - first.getTime()) / (7 * 24 * 3600 * 1000));
  const cells = Array.from({ length: weeks * 7 }, (_, i) => toDateStr(addDays(first, i)));
  const today = toDateStr(new Date());
  const shift = (n: number) => onMonth(toDateStr(new Date(y, m - 1 + n, 1)).slice(0, 7));
  const title = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="rounded-xl border bg-card p-3" aria-label="Calendário do mês">
      <div className="mb-2 flex items-center justify-between">
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Mês anterior" onClick={() => shift(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="text-sm font-semibold capitalize" aria-live="polite">
          {title}
        </p>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Próximo mês" onClick={() => shift(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="py-1 text-muted-foreground">
            {d}
          </span>
        ))}
        {cells.map((d) => {
          const inMonth = d.slice(0, 7) === month;
          const isSel = d === selected;
          return (
            <button
              key={d}
              type="button"
              aria-label={`${d.split("-").reverse().join("/")}${marked.has(d) ? ", com sessões" : ""}`}
              aria-pressed={isSel}
              onClick={() => onSelect(d)}
              className={`relative mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors ${
                isSel ? "bg-primary text-primary-foreground font-semibold" : d === today ? "border border-primary" : "hover:bg-muted"
              } ${inMonth ? "" : "text-muted-foreground/50"}`}
            >
              {Number(d.slice(8))}
              {marked.has(d) && <span className={`absolute bottom-0.5 h-1 w-1 rounded-full ${isSel ? "bg-primary-foreground" : "bg-primary"}`} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
