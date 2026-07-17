// lib/sms/provider.ts — fabryka providera SMS. Rozwiązuje aktywnego providera
// z konfiguracji środowiska (SMS_PROVIDER). Podmiana bramki = zmiana env +
// ewentualnie nowy plik w providers/ — bez dotykania miejsc wywołań.
import "server-only";
import type { SmsProvider } from "./types";
import { SmsApiProvider } from "./providers/smsapi";

// Domyślny provider, gdy SMS_PROVIDER nieustawiony.
const DEFAULT_PROVIDER = "smsapi";

// Nazwa nadawcy z konfiguracji (read-only w UI).
export function getSmsSender(): string {
  return (process.env.SMSAPI_SENDER || "").trim();
}

// Tryb testowy: wiadomości są walidowane, ale NIE wysyłane i NIE zużywają kredytów.
export function isSmsTestMode(): boolean {
  const v = (process.env.SMS_TEST_MODE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

// Sekret do weryfikacji pochodzenia webhooka DLR (SMSAPI nie podpisuje callbacków,
// więc chronimy endpoint sekretem w URL — patrz /api/sms/dlr).
export function getDlrSecret(): string {
  return (process.env.SMS_DLR_SECRET || "").trim();
}

// Identyfikator aktywnego providera (do zapisu w sms_messages.provider).
export function getActiveProviderId(): string {
  return (process.env.SMS_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
}

// Buduje absolutny URL callbacku DLR z sekretem w query (weryfikacja pochodzenia).
// `baseUrl` to origin aplikacji (np. z request.url albo DEPLOY_URL). Zwraca null,
// gdy nie da się zbudować adresu (brak base) — wtedy wysyłamy bez notify_url.
export function buildDlrNotifyUrl(baseUrl: string | null | undefined): string | undefined {
  const base = (baseUrl || "").replace(/\/+$/, "");
  const secret = getDlrSecret();
  if (!base || !secret) return undefined;
  return `${base}/api/sms/dlr?token=${encodeURIComponent(secret)}`;
}

// Origin aplikacji do budowy callbacku, gdy nie mamy obiektu request (np. cron).
export function getAppBaseUrl(): string | null {
  const explicit = (process.env.APP_BASE_URL || process.env.DEPLOY_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = (process.env.VERCEL_URL || "").trim();
  if (vercel) return `https://${vercel}`;
  return null;
}

let cached: SmsProvider | null = null;

// Zwraca aktywnego providera (singleton per proces). Rzuca dla nieznanej bramki.
export function getSmsProvider(): SmsProvider {
  if (cached) return cached;
  const id = getActiveProviderId();
  switch (id) {
    case "smsapi":
      cached = new SmsApiProvider({
        token: (process.env.SMSAPI_TOKEN || "").trim(),
        sender: getSmsSender(),
        baseUrl: (process.env.SMSAPI_BASE_URL || "").trim() || undefined,
      });
      return cached;
    default:
      throw new Error(`Nieznany provider SMS: „${id}". Ustaw SMS_PROVIDER na obsługiwaną bramkę.`);
  }
}
