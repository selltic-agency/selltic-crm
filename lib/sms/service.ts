// lib/sms/service.ts — warstwa serwisu SMS (server-only). Wspólny rdzeń dla:
//   • wysyłki manualnej z karty leada (/api/sms/send),
//   • automatów formularzy (lib/sms/formTrigger.ts),
//   • drenażu wysyłek zaplanowanych i przypomnień (/api/cron/sms).
//
// Konfiguracja bramki (token/nadawca/tryb testowy/sekret DLR) jest rozwiązywana
// per-właściciel z app_settings (fallback ENV) — patrz config.ts. Callbacki DLR
// budujemy tutaj z sekretu właściciela.
//
// Reguły egzekwowane TUTAJ (nie tylko w UI):
//   • numer musi być poprawny (E.164),
//   • marketing bez zgody = twarda blokada,
//   • deduplikacja: identyczna treść na ten sam numer w 60 s (poza wewn. alertami),
//   • błąd wysyłki ZAWSZE zostawia wiersz `failed` z kodem/komunikatem (bez cichych porażek),
//   • surowy payload providera NIGDY nie trafia do klienta (błąd znormalizowany).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsKind, SmsMessage, SmsMessageStatus, SmsRelatedType, SmsTrigger } from "@/lib/types";
import { segmentInfo } from "./encoding";
import { buildDlrNotifyUrl, createSmsProvider, getAppBaseUrl } from "./provider";
import { loadSmsConfig, type SmsRuntimeConfig } from "./config";
import type { NormalizedSmsError, SendRequest, SmsProvider } from "./types";

type Db = SupabaseClient;

export type SmsSendContext = {
  owner: string;
  to: string; // E.164 (znormalizowany przez toE164 zanim tu trafi)
  body: string; // finalna treść (placeholdery już podstawione)
  kind: SmsKind;
  trigger: SmsTrigger;
  senderName?: string;
  createdBy?: string | null;
  relatedType?: SmsRelatedType | null;
  relatedId?: string | null;
  templateId?: string | null;
  formId?: string | null;
  formSubmissionId?: string | null;
  // Origin aplikacji do budowy callbacku DLR (np. z request.url). Sam sekret
  // dokłada serwis z konfiguracji właściciela. Brak → getAppBaseUrl() (ENV).
  notifyBaseUrl?: string;
  // Czy dopisać wpis na osi czasu leada (domyślnie: tak, gdy powiązano z dealem).
  logActivity?: boolean;
};

export type SmsFailReason =
  | "invalid_number"
  | "consent"
  | "duplicate"
  | "duplicate_submission"
  | "provider"
  | "no_config";

export type SmsOutcome =
  | { ok: true; messageId: string; providerMessageId?: string; status: SmsMessageStatus }
  | { ok: false; reason: SmsFailReason; error?: NormalizedSmsError; messageId?: string };

const E164_RE = /^\+\d{8,15}$/;

// Marketing wymaga zgody — sprawdzane w warstwie serwisu (defense in depth).
// Alerty wewnętrzne (form_internal) omijają zgodę całkowicie.
async function consentAllowed(db: Db, ctx: SmsSendContext): Promise<boolean> {
  if (ctx.kind !== "marketing") return true;
  if (ctx.trigger === "form_internal") return true;
  if (ctx.relatedType === "deal" && ctx.relatedId) {
    const { data } = await db.from("deals").select("sms_consent").eq("id", ctx.relatedId).maybeSingle();
    return !!data?.sms_consent;
  }
  // Marketing do rekordu bez możliwej zgody → blokada.
  return false;
}

// Identyczna treść na ten sam numer w ostatnich 60 s (poza alertami wewnętrznymi).
async function isRecentDuplicate(db: Db, ctx: SmsSendContext): Promise<boolean> {
  if (ctx.trigger === "form_internal") return false;
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data } = await db
    .from("sms_messages")
    .select("id")
    .eq("owner", ctx.owner)
    .eq("to_number", ctx.to)
    .eq("body", ctx.body)
    .gte("created_at", since)
    .neq("status", "failed")
    .limit(1);
  return !!data?.[0];
}

// Wstawia wiersz `queued`. Zwraca id lub sygnał konfliktu idempotencji
// (partial unique index na form_submission_id dla potwierdzeń/alertów).
async function insertQueuedRow(
  db: Db,
  ctx: SmsSendContext,
  config: SmsRuntimeConfig,
  scheduledAt: string | null
): Promise<{ id: string } | { conflict: true } | { error: string }> {
  const seg = segmentInfo(ctx.body);
  const { data, error } = await db
    .from("sms_messages")
    .insert({
      owner: ctx.owner,
      related_type: ctx.relatedType ?? null,
      related_id: ctx.relatedId ?? null,
      to_number: ctx.to,
      body: ctx.body,
      sender_name: ctx.senderName ?? (config.sender || null),
      provider: config.providerId,
      status: "queued",
      encoding: seg.encoding,
      segments: seg.segments,
      created_by: ctx.createdBy ?? null,
      kind: ctx.kind,
      template_id: ctx.templateId ?? null,
      form_id: ctx.formId ?? null,
      form_submission_id: ctx.formSubmissionId ?? null,
      trigger: ctx.trigger,
      scheduled_at: scheduledAt,
    })
    .select("id")
    .single();
  if (error) {
    // 23505 = naruszenie unikalności → wiadomość już istnieje (idempotencja).
    if ((error as { code?: string }).code === "23505") return { conflict: true };
    return { error: error.message };
  }
  return { id: data.id as string };
}

// Woła providera dla istniejącego wiersza i aktualizuje jego stan. Wspólne dla
// wysyłki natychmiastowej i drenażu zaplanowanych.
async function performSend(
  db: Db,
  provider: SmsProvider,
  messageId: string,
  req: SendRequest,
  logActivityFor?: { owner: string; dealId: string }
): Promise<SmsOutcome> {
  const result = await provider.send(req);

  if (!result.ok) {
    await db
      .from("sms_messages")
      .update({ status: "failed", error_code: result.error.code, error_message: result.error.message })
      .eq("id", messageId);
    if (logActivityFor) await logSmsActivity(db, logActivityFor, req.body, "failed");
    return { ok: false, reason: "provider", error: result.error, messageId };
  }

  await db
    .from("sms_messages")
    .update({
      status: "sent",
      provider_message_id: result.providerMessageId,
      sent_at: new Date().toISOString(),
      cost_points: result.cost ?? null,
      ...(typeof result.segments === "number" ? { segments: result.segments } : {}),
    })
    .eq("id", messageId);
  if (logActivityFor) await logSmsActivity(db, logActivityFor, req.body, "sent");
  return { ok: true, messageId, providerMessageId: result.providerMessageId, status: "sent" };
}

// Wpis na osi czasu leada (typ „sms"). Failed = wyróżnione wizualnie w UI.
async function logSmsActivity(
  db: Db,
  target: { owner: string; dealId: string },
  body: string,
  status: SmsMessageStatus
) {
  const prefix = status === "failed" ? "Nie udało się wysłać SMS" : "Wysłano SMS";
  await db.from("activities").insert({
    owner: target.owner,
    deal_id: target.dealId,
    type: "sms",
    body: `${prefix}: „${body}"`,
    meta: { status },
  });
}

// Buduje żądanie do providera z kontekstu i konfiguracji.
function toSendRequest(ctx: SmsSendContext, config: SmsRuntimeConfig, notifyUrl?: string): SendRequest {
  const seg = segmentInfo(ctx.body);
  return {
    to: ctx.to,
    body: ctx.body,
    from: ctx.senderName ?? (config.sender || undefined),
    encoding: seg.encoding,
    testMode: config.testMode,
    notifyUrl,
  };
}

// Wspólna kontrola przed wstawieniem wiersza (numer, zgoda, dedup).
async function precheck(db: Db, ctx: SmsSendContext): Promise<SmsOutcome | null> {
  if (!E164_RE.test(ctx.to)) {
    return { ok: false, reason: "invalid_number" };
  }
  if (!(await consentAllowed(db, ctx))) {
    return { ok: false, reason: "consent" };
  }
  if (await isRecentDuplicate(db, ctx)) {
    return { ok: false, reason: "duplicate" };
  }
  return null;
}

function activityTarget(ctx: SmsSendContext): { owner: string; dealId: string } | undefined {
  const wantLog = ctx.logActivity ?? ctx.relatedType === "deal";
  if (wantLog && ctx.relatedType === "deal" && ctx.relatedId) {
    return { owner: ctx.owner, dealId: ctx.relatedId };
  }
  return undefined;
}

function notifyUrlFor(ctx: SmsSendContext, config: SmsRuntimeConfig): string | undefined {
  return buildDlrNotifyUrl(ctx.notifyBaseUrl ?? getAppBaseUrl(), config.dlrSecret);
}

// Wysyłka NATYCHMIASTOWA: precheck → wiersz `queued` → provider → aktualizacja.
export async function dispatchSms(db: Db, ctx: SmsSendContext): Promise<SmsOutcome> {
  const pre = await precheck(db, ctx);
  if (pre) return pre;

  const config = await loadSmsConfig(db, ctx.owner);
  let provider: SmsProvider;
  try {
    provider = createSmsProvider(config);
  } catch (e) {
    return { ok: false, reason: "no_config", error: { code: "no_provider", message: String(e) } };
  }

  const inserted = await insertQueuedRow(db, ctx, config, null);
  if ("conflict" in inserted) return { ok: false, reason: "duplicate_submission" };
  if ("error" in inserted) return { ok: false, reason: "provider", error: { code: "db", message: inserted.error } };

  return performSend(db, provider, inserted.id, toSendRequest(ctx, config, notifyUrlFor(ctx, config)), activityTarget(ctx));
}

// Wysyłka OPÓŹNIONA: tylko wstawia wiersz `queued` ze `scheduled_at`. Cron
// (/api/cron/sms) zdrenuje go, gdy nadejdzie termin. Zwraca id lub powód pominięcia.
export async function enqueueScheduledSms(
  db: Db,
  ctx: SmsSendContext,
  scheduledAtIso: string
): Promise<SmsOutcome> {
  const pre = await precheck(db, ctx);
  if (pre) return pre;
  const config = await loadSmsConfig(db, ctx.owner);
  const inserted = await insertQueuedRow(db, ctx, config, scheduledAtIso);
  if ("conflict" in inserted) return { ok: false, reason: "duplicate_submission" };
  if ("error" in inserted) return { ok: false, reason: "provider", error: { code: "db", message: inserted.error } };
  return { ok: true, messageId: inserted.id, status: "queued" };
}

// Ponawia wysyłkę istniejącego wiersza (retry alertu wewnętrznego). Pobiera
// aktualny wiersz i wywołuje providera raz jeszcze na tym samym rekordzie.
export async function resendMessage(db: Db, messageId: string, notifyBaseUrl?: string): Promise<SmsOutcome> {
  const { data } = await db.from("sms_messages").select("*").eq("id", messageId).maybeSingle();
  if (!data) return { ok: false, reason: "provider", error: { code: "not_found", message: "Brak wiersza." } };
  return deliverQueuedRow(db, data as SmsMessage, notifyBaseUrl);
}

// Drenaż jednego wcześniej zakolejkowanego wiersza (cron / wysyłki opóźnione).
export async function deliverQueuedRow(
  db: Db,
  row: SmsMessage,
  notifyBaseUrl?: string
): Promise<SmsOutcome> {
  const config = await loadSmsConfig(db, row.owner);
  let provider: SmsProvider;
  try {
    provider = createSmsProvider(config);
  } catch (e) {
    return { ok: false, reason: "no_config", error: { code: "no_provider", message: String(e) } };
  }
  const req: SendRequest = {
    to: row.to_number,
    body: row.body,
    from: row.sender_name ?? (config.sender || undefined),
    encoding: (row.encoding as "gsm7" | "ucs2") ?? segmentInfo(row.body).encoding,
    testMode: config.testMode,
    notifyUrl: buildDlrNotifyUrl(notifyBaseUrl ?? getAppBaseUrl(), config.dlrSecret),
  };
  const logFor =
    row.related_type === "deal" && row.related_id
      ? { owner: row.owner, dealId: row.related_id }
      : undefined;
  return performSend(db, provider, row.id, req, logFor);
}
