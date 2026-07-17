// lib/sms/config.ts — rozwiązanie konfiguracji bramki SMS (server-only).
// Źródło prawdy: app_settings (ustawiane z UI → Ustawienia → Bramka SMS).
// Zmienne środowiskowe pozostają FALLBACKIEM (istniejące wdrożenia i testy),
// używanym, gdy bramka nie została skonfigurowana w UI.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SmsRuntimeConfig = {
  providerId: string;
  token: string;
  sender: string;
  baseUrl: string; // "" = domyślny adres providera
  testMode: boolean;
  dlrSecret: string;
};

// Konfiguracja z ENV (fallback).
export function envSmsConfig(): SmsRuntimeConfig {
  return {
    providerId: (process.env.SMS_PROVIDER || "smsapi").trim().toLowerCase(),
    token: (process.env.SMSAPI_TOKEN || "").trim(),
    sender: (process.env.SMSAPI_SENDER || "").trim(),
    baseUrl: (process.env.SMSAPI_BASE_URL || "").trim(),
    testMode: /^(1|true|yes)$/i.test((process.env.SMS_TEST_MODE || "").trim()),
    dlrSecret: (process.env.SMS_DLR_SECRET || "").trim(),
  };
}

// Rozwiązuje konfigurację dla właściciela. Zasada „wszystko albo nic": jeśli
// token bramki jest ustawiony w UI, konfiguracja z bazy jest nadrzędna (z
// rozsądnymi fallbackami do ENV dla pól opcjonalnych). W przeciwnym razie ENV.
export async function loadSmsConfig(
  db: SupabaseClient,
  owner?: string | null
): Promise<SmsRuntimeConfig> {
  const env = envSmsConfig();
  if (!owner) return env;

  const { data } = await db
    .from("app_settings")
    .select("smsapi_token, smsapi_sender, smsapi_base_url, sms_test_mode, sms_dlr_secret")
    .eq("owner", owner)
    .maybeSingle();

  const dbToken = (data?.smsapi_token as string | null)?.trim() || "";
  if (!dbToken) return env; // bramka nieskonfigurowana w UI → ENV

  return {
    providerId: env.providerId,
    token: dbToken,
    sender: (data?.smsapi_sender as string | null)?.trim() || env.sender,
    baseUrl: (data?.smsapi_base_url as string | null)?.trim() || env.baseUrl,
    testMode: typeof data?.sms_test_mode === "boolean" ? data.sms_test_mode : env.testMode,
    dlrSecret: (data?.sms_dlr_secret as string | null)?.trim() || env.dlrSecret,
  };
}
