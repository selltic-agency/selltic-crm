// lib/visitor.ts — §2. First-party anonimowy identyfikator gościa.
// Trwały po stronie klienta, stabilny między wizytami. localStorage jako
// podstawa, cookie first-party jako fallback dla Safari/ITP. BEZ third-party
// cookies. To jest podstawa liczenia „unikalnych użytkowników”.
"use client";

const KEY = "selltic_vid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // ~13 miesięcy

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Zwraca stabilny identyfikator gościa. Kolejność: localStorage → cookie → nowy.
// Zapisuje w obu magazynach dla odporności na ITP/czyszczenie pojedynczego.
export function getVisitorId(): string {
  if (typeof window === "undefined") return genId();
  let id: string | null = null;
  try {
    id = window.localStorage.getItem(KEY);
  } catch {
    // localStorage zablokowany (tryb prywatny) — spadamy do cookie.
  }
  if (!id) id = readCookie(KEY);
  if (!id) id = genId();
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
  writeCookie(KEY, id);
  return id;
}

// Odczyt cookie po nazwie (np. _fbp / _fbc dla Meta) — bez zapisu.
export function getCookie(name: string): string | null {
  return readCookie(name);
}
