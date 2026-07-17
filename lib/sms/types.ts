// lib/sms/types.ts — provider-agnostyczny kontrakt warstwy SMS.
// Cel: bramkę SMS (SMSAPI → SMSPlanet → SerwerSMS) można podmienić bez zmiany
// miejsc wywołań. Wszystkie konkretne providery implementują `SmsProvider`.
import type { SmsEncoding } from "./encoding";

// Kanoniczny status wiadomości (spójny z CHECK w sms_messages.status).
export type SmsStatus = "queued" | "sent" | "delivered" | "failed" | "undelivered";

// Znormalizowany błąd wewnętrzny — NIGDY nie przenosi surowego payloadu providera
// do klienta. `code` jest stabilnym identyfikatorem (do mapowań/telemetrii),
// `message` krótkim opisem po polsku.
export type NormalizedSmsError = {
  code: string;
  message: string;
};

// Żądanie wysyłki jednej wiadomości. `to` jest już w E.164, `body` gotowe
// (placeholdery podstawione), `encoding` policzone po stronie serwisu.
export type SendRequest = {
  to: string;
  body: string;
  from?: string;
  encoding: SmsEncoding;
  testMode: boolean;
  // URL raportu doręczeń (per-wiadomość) — provider zawoła go przy zmianie statusu.
  notifyUrl?: string;
};

// Wynik wysyłki. `segments`/`cost` są opcjonalne — nie każdy provider je zwraca.
export type SendResult =
  | {
      ok: true;
      providerMessageId: string;
      segments?: number;
      cost?: number | null;
      encoding?: SmsEncoding;
    }
  | { ok: false; error: NormalizedSmsError };

// Wynik odpytania o status (getStatus).
export type StatusResult =
  | { ok: true; status: SmsStatus; statusName?: string }
  | { ok: false; error: NormalizedSmsError };

// Znormalizowany raport doręczenia (z parseDeliveryWebhook). `dedupeKey` służy
// do idempotencji — ten sam DLR może przyjść wielokrotnie.
export type DeliveryReport = {
  providerMessageId: string;
  status: SmsStatus;
  statusName?: string;
  deliveredAt: Date | null;
  raw: Record<string, unknown>;
  dedupeKey: string;
};

// Kontrakt providera. Implementacje są WYŁĄCZNIE server-side (token nigdy do klienta).
export interface SmsProvider {
  readonly id: string;
  send(message: SendRequest): Promise<SendResult>;
  getStatus(providerMessageId: string): Promise<StatusResult>;
  // Parsuje surowy payload webhooka DLR na znormalizowany raport lub null,
  // gdy payload jest nierozpoznany.
  parseDeliveryWebhook(payload: Record<string, string>): DeliveryReport | null;
}
