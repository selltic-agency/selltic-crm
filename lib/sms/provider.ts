// lib/sms/provider.ts — fabryka providera SMS. Buduje aktywnego providera z
// rozwiązanej konfiguracji (app_settings + fallback ENV, patrz config.ts).
// Podmiana bramki = nowy plik w providers/ + gałąź w createSmsProvider — bez
// dotykania miejsc wywołań.
import "server-only";
import type { SmsProvider } from "./types";
import { SmsApiProvider } from "./providers/smsapi";
import type { SmsRuntimeConfig } from "./config";

// Tworzy providera z konfiguracji. Rzuca dla nieznanej bramki.
export function createSmsProvider(config: SmsRuntimeConfig): SmsProvider {
  switch (config.providerId) {
    case "smsapi":
      return new SmsApiProvider({
        token: config.token,
        sender: config.sender,
        baseUrl: config.baseUrl || undefined,
      });
    default:
      throw new Error(`Nieznany provider SMS: „${config.providerId}". Ustaw SMS_PROVIDER na obsługiwaną bramkę.`);
  }
}

// Buduje absolutny URL callbacku DLR z sekretem w query (weryfikacja pochodzenia).
// `baseUrl` to origin aplikacji (np. z request.url albo DEPLOY_URL), `secret` z
// konfiguracji właściciela. Zwraca undefined, gdy brakuje adresu lub sekretu —
// wtedy wysyłamy bez notify_url.
export function buildDlrNotifyUrl(
  baseUrl: string | null | undefined,
  secret: string | null | undefined
): string | undefined {
  const base = (baseUrl || "").replace(/\/+$/, "");
  const s = (secret || "").trim();
  if (!base || !s) return undefined;
  return `${base}/api/sms/dlr?token=${encodeURIComponent(s)}`;
}

// Origin aplikacji do budowy callbacku, gdy nie mamy obiektu request (np. cron).
export function getAppBaseUrl(): string | null {
  const explicit = (process.env.APP_BASE_URL || process.env.DEPLOY_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = (process.env.VERCEL_URL || "").trim();
  if (vercel) return `https://${vercel}`;
  return null;
}
