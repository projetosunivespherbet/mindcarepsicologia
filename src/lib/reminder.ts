import { hhmm } from "@/lib/dates";

/** Telefone digitado livremente → número do WhatsApp com DDI (Brasil), ou null se não parecer um telefone válido. */
export function whatsappNumber(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return null;
}

/** "2030-03-04T12:00:00.000Z" → "20300304T120000Z" (formato de data do Google Agenda e do .ics). */
const utcStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Título neutro: o evento vai para a agenda pessoal do paciente, então não leva nome nem conteúdo clínico. */
export const reminderTitle = (clinica: string) => `Sessão – ${clinica}`;

export function googleCalendarUrl(o: { clinica: string; starts_at: string; ends_at: string }) {
  const q = new URLSearchParams({ action: "TEMPLATE", text: reminderTitle(o.clinica), dates: `${utcStamp(o.starts_at)}/${utcStamp(o.ends_at)}` });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export function reminderText(o: { paciente: string; clinica: string; starts_at: string; ends_at: string }) {
  const primeiroNome = o.paciente.trim().split(/\s+/)[0] ?? "";
  const dia = new Date(o.starts_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
  return `Olá, ${primeiroNome}! Lembrete da sua sessão: ${dia}, às ${hhmm(o.starts_at)} (${o.clinica}). Se precisar remarcar, é só me avisar. Para adicionar à sua agenda: ${googleCalendarUrl(o)}`;
}

export const whatsappUrl = (numero: string, texto: string) => `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Arquivo .ics de um evento (abre no Google Agenda, Apple e Outlook). */
export function icsContent(o: { id: string; clinica: string; starts_at: string; ends_at: string; now?: Date }) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MindCare//Lembrete de sessao//PT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${o.id}@mindcare`,
    `DTSTAMP:${utcStamp((o.now ?? new Date()).toISOString())}`,
    `DTSTART:${utcStamp(o.starts_at)}`,
    `DTEND:${utcStamp(o.ends_at)}`,
    `SUMMARY:${icsEscape(reminderTitle(o.clinica))}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function downloadIcs(nome: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
