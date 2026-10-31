const pad = (n: number) => String(n).padStart(2, "0");

/** Data local → "AAAA-MM-DD". */
export const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Segunda-feira, 00:00 (hora local), da semana da data informada. */
export function weekStart(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(r, -((r.getDay() + 6) % 7));
}

/** Data e hora digitadas (locais) → instante ISO com fuso, no formato que a API espera. */
export const localInstant = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();

export const addMinutes = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Instante ISO → "AAAA-MM-DD" no fuso local. */
export const dayKey = (iso: string) => toDateStr(new Date(iso));

export const timeInput = (iso: string) => hhmm(iso);

export const minutesBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);

/** "2030-03-04" → "Segunda-feira, 04/03". */
export function dayLabel(date: string): string {
  const s = new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2030-02" → primeiro e último dia do mês. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return { from: `${ym}-01`, to: toDateStr(new Date(y, m, 0)) };
}

/** "Hoje" (AAAA-MM-DD) no fuso informado; sem fuso, o do navegador. A API valida datas pelo fuso da clínica. */
export const todayIn = (timeZone?: string) => new Date().toLocaleDateString("sv-SE", timeZone ? { timeZone } : undefined);
