// Strong password rule: min 8 chars + uppercase + lowercase + special character
export const STRONG_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]).{8,}$/;

export const PASSWORD_RULE_TEXT =
  "Mínimo 8 caracteres, com letra maiúscula, minúscula e caractere especial";

export function validateStrongPassword(password: string): string | null {
  if (password.length < 8) return "A senha deve ter no mínimo 8 caracteres";
  if (!/[A-Z]/.test(password)) return "A senha deve conter ao menos uma letra maiúscula";
  if (!/[a-z]/.test(password)) return "A senha deve conter ao menos uma letra minúscula";
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password))
    return "A senha deve conter ao menos um caractere especial";
  return null;
}
