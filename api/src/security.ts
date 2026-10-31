import { scryptAsync } from "@noble/hashes/scrypt.js";

const enc = new TextEncoder();

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Formato: scrypt$N$r$p$salt$hash — os parâmetros ficam no hash, então podem ser elevados depois. */
export async function hashPassword(password: string, n = 16384) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await scryptAsync(enc.encode(password), salt, { N: n, r: 8, p: 1, dkLen: 32 });
  return `scrypt$${n}$8$1$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const derived = await scryptAsync(enc.encode(password), unb64(salt), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    dkLen: 32,
  });
  return timingSafeEqual(derived, unb64(hash));
}

export function randomToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
  return Array.from(digest, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function safeEqualStrings(a: string, b: string) {
  return timingSafeEqual(enc.encode(await sha256Hex(a)), enc.encode(await sha256Hex(b)));
}

export async function verifyTurnstile(secret: string | undefined, token: string | undefined, ip?: string) {
  if (!secret) return true;
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}
