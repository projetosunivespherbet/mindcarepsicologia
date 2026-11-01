import { z } from "zod";
import type { Context } from "hono";

export const passwordSchema = z
  .string()
  .min(8, "A senha deve ter ao menos 8 caracteres")
  .max(128)
  .regex(/[a-z]/, "A senha deve ter uma letra minúscula")
  .regex(/[A-Z]/, "A senha deve ter uma letra maiúscula")
  .regex(/[0-9]/, "A senha deve ter um número")
  .regex(/[^A-Za-z0-9]/, "A senha deve ter um caractere especial");

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("E-mail inválido"));
export const nameSchema = z.string().trim().min(2, "Nome muito curto").max(160);
export const optText = (max = 500) => z.string().trim().max(max).optional().nullable();
export const isoDateTime = z.iso.datetime({ offset: true });
export const roleSchema = z.enum(["admin", "psicologo", "recepcao"]);

export async function readBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => ({}));
  return schema.parse(raw);
}

export function readQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  return schema.parse(c.req.query());
}

/** Valor em centavos (inteiro), de R$ 0,01 a R$ 100.000,00. */
export const centsSchema = z.number().int().min(1).max(10_000_000);
export const dateOnly = z.iso.date();

// ---------------------------------------------------------------- CPF / CNPJ

const onlyDocChars = (s: string) => s.replace(/[.\-/\s]/g, "").toUpperCase();

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i);
    const dv = ((sum * 10) % 11) % 10;
    if (dv !== Number(digits[len])) return false;
  }
  return true;
}

/** Aceita o CNPJ numérico e o alfanumérico (valor de cada caractere = código ASCII − 48). */
export function isValidCnpj(value: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(value) || /^(.)\1{13}$/.test(value)) return false;
  const v = [...value].map((ch) => ch.charCodeAt(0) - 48);
  for (const len of [12, 13]) {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += v[i]! * weights[i]!;
    const r = sum % 11;
    const dv = r < 2 ? 0 : 11 - r;
    if (dv !== v[len]) return false;
  }
  return true;
}

/** CPF ou CNPJ com ou sem máscara; devolve só os caracteres do documento. */
export const cpfCnpjSchema = z
  .string()
  .trim()
  .max(30)
  .transform(onlyDocChars)
  .refine((d) => isValidCpf(d) || isValidCnpj(d), "CPF ou CNPJ inválido");

/** Só CPF (com ou sem máscara); guarda os 11 dígitos. */
export const cpfSchema = z
  .string()
  .trim()
  .max(20)
  .transform(onlyDocChars)
  .refine(isValidCpf, "CPF inválido");

/** CNPJ (numérico ou alfanumérico) com ou sem máscara. */
export const cnpjSchema = z
  .string()
  .trim()
  .max(30)
  .transform(onlyDocChars)
  .refine(isValidCnpj, "CNPJ inválido");

/** Chave Pix: CPF/CNPJ (só dígitos; CNPJ pode ser alfanumérico), telefone (+55DDDNÚMERO), e-mail ou chave aleatória (UUID). */
export const pixKeySchema = z
  .string()
  .trim()
  .max(77)
  .refine(
    (v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ||
      /^\+55\d{10,11}$/.test(v) ||
      /^\d{11}$/.test(v) ||
      /^[0-9A-Za-z]{12}\d{2}$/.test(v) ||
      emailSchema.safeParse(v).success,
    "Chave Pix inválida: use CPF, CNPJ, e-mail, telefone no formato +5511999998888 ou a chave aleatória",
  )
  .transform((v) => (v.includes("@") || /^[0-9a-f]{8}-/i.test(v) ? v.toLowerCase() : v));
