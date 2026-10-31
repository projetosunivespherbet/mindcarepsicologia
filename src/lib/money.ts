/** Centavos → "R$ 1.250,00". */
export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Centavos → "1250,00" (para preencher campos de valor). */
export const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/**
 * Texto digitado pela pessoa → centavos. Aceita "150", "150,5", "1.250,00", "R$ 1.250,00" e "150.50".
 * Devolve null se não for um valor positivo com até duas casas decimais.
 */
export function parseBRL(input: string): number | null {
  let s = input.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // 1.250 = mil duzentos e cinquenta
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 && cents <= 10_000_000 ? cents : null;
}

/** "2030-03-01" → "03/2030". */
export const monthLabel = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** "2030-03-20" → "20/03/2030". */
export const dateBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Chave para o cabeçalho Idempotency-Key (8 a 100 caracteres). */
export const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
