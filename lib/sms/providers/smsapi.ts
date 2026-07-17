// lib/sms/providers/smsapi.ts — konkretny provider SMSAPI.pl (pierwsza bramka).
// WYŁĄCZNIE server-side: token OAuth (SMSAPI_TOKEN) nigdy nie trafia do klienta.
//
// Kontrakt (potwierdzony w dokumentacji SMSAPI, nie z pamięci):
//   • Wysyłka:  POST {BASE}/sms.do, nagłówek `Authorization: Bearer <token>`,
//     parametry form-urlencoded: from, to, message, format=json, encoding=utf-8,
//     details=1, test=1 (tryb testowy), notify_url (URL raportu doręczeń).
//   • Odpowiedź JSON sukcesu: { count, list: [{ id, points, parts, number, status }] }.
//   • Odpowiedź JSON błędu:   { error: <kod>, message: <opis> }.
//   • Raport doręczeń (DLR): form-encoded GET/POST na notify_url z polami
//     MsgId, status, status_name, donedate (unix), to, from, points, idx.
//     Endpoint MUSI odpowiedzieć „OK", inaczej SMSAPI ponawia (→ idempotencja).
import "server-only";
import type {
  DeliveryReport,
  SendRequest,
  SendResult,
  SmsProvider,
  SmsStatus,
  StatusResult,
} from "../types";

const DEFAULT_BASE_URL = "https://api.smsapi.com";

export type SmsApiConfig = {
  token: string;
  sender?: string;
  baseUrl?: string;
};

// Mapowanie nazw statusów SMSAPI → kanoniczny status wewnętrzny.
function mapStatusName(name: string): SmsStatus {
  switch (name.toUpperCase()) {
    case "DELIVERED":
      return "delivered";
    case "SENT":
    case "ACCEPTED":
    case "QUEUE":
    case "QUEUED":
      return "sent";
    case "UNDELIVERED":
    case "EXPIRED":
      return "undelivered";
    default:
      // REJECTED, ERROR, UNKNOWN, FAILED, NOT_FOUND ...
      return "failed";
  }
}

// Log wejścia/wyjścia providera — BEZ tokenu (token jest w nagłówku, nie logujemy
// nagłówków). Numer skracamy, treści nie logujemy w całości.
function logIo(stage: string, data: Record<string, unknown>) {
  console.log(`[sms/smsapi] ${stage}`, JSON.stringify(data));
}

export class SmsApiProvider implements SmsProvider {
  readonly id = "smsapi";
  private token: string;
  private sender?: string;
  private baseUrl: string;

  constructor(config: SmsApiConfig) {
    this.token = config.token;
    this.sender = config.sender;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async send(message: SendRequest): Promise<SendResult> {
    if (!this.token) {
      return { ok: false, error: { code: "no_token", message: "Brak konfiguracji bramki SMS." } };
    }
    // SMSAPI oczekuje numeru z kodem kraju bez znaku „+".
    const to = message.to.replace(/^\+/, "");
    const from = (message.from || this.sender || "").trim();

    const params = new URLSearchParams();
    params.set("to", to);
    params.set("message", message.body);
    params.set("format", "json");
    params.set("encoding", "utf-8");
    params.set("details", "1");
    if (from) params.set("from", from);
    if (message.testMode) params.set("test", "1");
    if (message.notifyUrl) params.set("notify_url", message.notifyUrl);

    logIo("send:request", {
      to: `***${to.slice(-3)}`,
      from,
      test: message.testMode,
      encoding: message.encoding,
      length: message.body.length,
    });

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/sms.do`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
    } catch (e) {
      logIo("send:network_error", { message: String(e) });
      return { ok: false, error: { code: "network", message: "Błąd sieci przy wysyłce SMS." } };
    }

    const json = (await res.json().catch(() => null)) as
      | { error?: number | string; message?: string; count?: number; list?: SmsApiListItem[] }
      | null;

    if (!json) {
      logIo("send:bad_response", { status: res.status });
      return { ok: false, error: { code: "bad_response", message: "Nieprawidłowa odpowiedź bramki SMS." } };
    }

    if (json.error != null) {
      logIo("send:provider_error", { status: res.status, error: json.error, message: json.message });
      return {
        ok: false,
        error: { code: `smsapi_${json.error}`, message: normalizeErrorMessage(json.message) },
      };
    }

    const item = json.list?.[0];
    if (!item || !item.id) {
      logIo("send:no_id", { status: res.status });
      return { ok: false, error: { code: "no_message_id", message: "Bramka SMS nie zwróciła identyfikatora." } };
    }

    logIo("send:ok", { id: item.id, parts: item.parts, points: item.points });
    return {
      ok: true,
      providerMessageId: String(item.id),
      segments: typeof item.parts === "number" ? item.parts : undefined,
      cost: typeof item.points === "number" ? item.points : null,
      encoding: message.encoding,
    };
  }

  // SMSAPI nie udostępnia prostego odpytywania statusu pojedynczej wiadomości —
  // podstawowym mechanizmem jest DLR (webhook). getStatus istnieje dla kontraktu
  // providera; zwraca jawny „nieobsługiwane", nie zgaduje.
  async getStatus(): Promise<StatusResult> {
    return {
      ok: false,
      error: { code: "not_supported", message: "Status pobierany przez raport doręczeń (DLR)." },
    };
  }

  parseDeliveryWebhook(payload: Record<string, string>): DeliveryReport | null {
    const providerMessageId = payload.MsgId || payload.msg_id || payload.id;
    if (!providerMessageId) return null;

    const statusName = payload.status_name || payload.status || "";
    const status = mapStatusName(statusName);
    const doneUnix = Number(payload.donedate || payload.done_date || 0);
    const deliveredAt =
      status === "delivered" && Number.isFinite(doneUnix) && doneUnix > 0
        ? new Date(doneUnix * 1000)
        : null;

    return {
      providerMessageId: String(providerMessageId),
      status,
      statusName: statusName || undefined,
      deliveredAt,
      raw: payload,
      // Ten sam raport (ten sam id + status + donedate) → ten sam klucz → idempotencja.
      dedupeKey: `${providerMessageId}:${payload.status ?? ""}:${payload.donedate ?? ""}`,
    };
  }
}

type SmsApiListItem = {
  id?: string | number;
  points?: number;
  parts?: number;
  number?: string;
  status?: string;
};

// Nie przenosimy surowej treści błędu providera do klienta bez kontroli — jeśli
// SMSAPI nie podał opisu, dajemy neutralny komunikat po polsku.
function normalizeErrorMessage(message?: string): string {
  const m = (message || "").trim();
  if (!m) return "Bramka SMS odrzuciła wiadomość.";
  return m;
}
