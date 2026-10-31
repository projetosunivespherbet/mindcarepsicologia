import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, addMinutes, dayKey, dayLabel, hhmm, localInstant, minutesBetween, monthRange, todayIn, toDateStr, weekStart } from "./dates";

describe("datas", () => {
  it("a semana começa na segunda-feira", () => {
    expect(toDateStr(weekStart(new Date(2030, 2, 6)))).toBe("2030-03-04"); // quarta
    expect(toDateStr(weekStart(new Date(2030, 2, 4)))).toBe("2030-03-04"); // a própria segunda
    expect(toDateStr(weekStart(new Date(2030, 2, 10)))).toBe("2030-03-04"); // domingo
  });
  it("soma dias atravessando o mês", () => {
    expect(toDateStr(addDays(new Date(2030, 0, 30), 3))).toBe("2030-02-02");
  });
  it("hora digitada vira instante e volta igual", () => {
    const start = localInstant("2030-03-04", "09:30");
    expect(hhmm(start)).toBe("09:30");
    expect(dayKey(start)).toBe("2030-03-04");
    const end = addMinutes(start, 50);
    expect(hhmm(end)).toBe("10:20");
    expect(minutesBetween(start, end)).toBe(50);
  });
  it("limites do mês e rótulo do dia", () => {
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2030-12")).toEqual({ from: "2030-12-01", to: "2030-12-31" });
    expect(dayLabel("2030-03-04")).toMatch(/^Segunda-feira, 04\/03$/);
  });
});

describe("todayIn", () => {
  afterEach(() => vi.useRealTimers());
  it("usa o dia do fuso da clínica, não o do navegador", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-03-05T02:30:00Z")); // 23:30 do dia 4 em São Paulo
    expect(todayIn("America/Sao_Paulo")).toBe("2030-03-04");
    expect(todayIn("UTC")).toBe("2030-03-05");
    expect(todayIn("Asia/Tokyo")).toBe("2030-03-05");
  });
});
