// Maps raw errors (Supabase/Postgres/Auth) to safe, user-facing Portuguese messages.
// Unknown errors are collapsed to a generic message and the full error is logged
// to the console for developers, never surfaced to the UI.

const SAFE_MESSAGE_PREFIXES = [
  "Conflito de agenda",
  "Horário inválido",
  "Não é possível agendar",
  "Profissional não atende",
  "Pacientes só podem",
  "Você já tem",
];

const AUTH_MESSAGE_MAP: Record<string, string> = {
  "Invalid login credentials": "E-mail ou senha incorretos.",
  "Email not confirmed": "Confirme seu e-mail antes de entrar.",
  "User already registered": "Este e-mail já está cadastrado.",
};

export function friendlyError(err: unknown, fallback = "Erro inesperado. Tente novamente."): string {
  const raw = (err as { message?: string } | null | undefined)?.message ?? "";

  // Log full details for developers only
  if (typeof console !== "undefined") {
    console.error("[app error]", err);
  }

  if (!raw) return fallback;

  if (AUTH_MESSAGE_MAP[raw]) return AUTH_MESSAGE_MAP[raw];

  if (SAFE_MESSAGE_PREFIXES.some((p) => raw.startsWith(p))) {
    return raw;
  }

  return fallback;
}
