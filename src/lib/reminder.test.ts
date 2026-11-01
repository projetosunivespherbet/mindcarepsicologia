import { describe, expect, it } from "vitest";
import { googleCalendarUrl, icsContent, reminderText, whatsappNumber, whatsappUrl } from "./reminder";

describe("lembrete de sessão", () => {
  it("normaliza o telefone para o WhatsApp (DDI 55)", () => {
    expect(whatsappNumber("(11) 91234-5678")).toBe("5511912345678");
    expect(whatsappNumber("11 3456-7890")).toBe("551134567890");
    expect(whatsappNumber("+55 11 91234-5678")).toBe("5511912345678");
    expect(whatsappNumber("12345")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });

  it("monta o link do Google Agenda com título neutro e horários em UTC", () => {
    const url = googleCalendarUrl({ clinica: "Clínica Bem-Estar", starts_at: "2030-03-04T12:00:00.000Z", ends_at: "2030-03-04T12:50:00.000Z" });
    expect(url).toContain("https://calendar.google.com/calendar/render?");
    expect(new URL(url).searchParams.get("text")).toBe("Sessão – Clínica Bem-Estar");
    expect(new URL(url).searchParams.get("dates")).toBe("20300304T120000Z/20300304T125000Z");
  });

  it("a mensagem usa só o primeiro nome e leva o link da agenda", () => {
    const t = reminderText({ paciente: "Maria da Silva Souza", clinica: "Clínica Bem-Estar", starts_at: "2030-03-04T12:00:00.000Z", ends_at: "2030-03-04T12:50:00.000Z" });
    expect(t).toMatch(/^Olá, Maria! Lembrete da sua sessão/);
    expect(t).not.toContain("Silva");
    expect(t).toContain("calendar.google.com");
    expect(whatsappUrl("5511912345678", t)).toMatch(/^https:\/\/wa\.me\/5511912345678\?text=/);
  });

  it("gera um .ics válido, sem nome do paciente", () => {
    const ics = icsContent({ id: "abc", clinica: "Clínica; Bem, Estar", starts_at: "2030-03-04T12:00:00.000Z", ends_at: "2030-03-04T12:50:00.000Z", now: new Date("2030-03-01T10:00:00Z") });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20300304T120000Z");
    expect(ics).toContain("DTEND:20300304T125000Z");
    expect(ics).toContain("SUMMARY:Sessão – Clínica\; Bem\\, Estar");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});
