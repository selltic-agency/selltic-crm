// lib/server/metaCrm.ts — sygnał jakości leada do Meta (Conversions API dla CRM).
// Token czytany WYŁĄCZNIE tu (service_role / sesja właściciela) — nigdy nie
// trafia do przeglądarki.
//
// Czym to się różni od lib/server/meta.ts (§9c):
//   • tamto wysyła „Lead” w momencie zgłoszenia formularza na naszej stronie
//     (action_source 'website', hashowane PII, dedup z Pixelem po event_id),
//   • to wysyła ZDARZENIA DALSZYCH ETAPÓW LEJKA dla leadów z formularzy
//     błyskawicznych (action_source 'system_generated', dopasowanie po
//     `lead_id` — bez żadnego PII w payloadzie).
//
// Dla leadów z Lead Ads NIE wysyłamy zdarzenia „Lead” — Facebook zapisał je
// sam w chwili wypełnienia formularza. Podwójna wysyłka zaburzyłaby liczenie.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendCapiEvent, type MetaConfig } from "@/lib/meta";

type Db = SupabaseClient;

// Nazwa źródła raportowana Meta — pojawia się w Events Managerze przy
// zdarzeniach CRM i pozwala odróżnić je od zdarzeń z Pixela.
export const LEAD_EVENT_SOURCE = "Selltic CRM";

// Meta przyjmuje zdarzenia CRM dla leadów nie starszych niż 90 dni. Starszych
// nie próbujemy wysyłać — i tak zostałyby odrzucone, a log zapełniłby się
// błędami nie do naprawienia.
export const MAX_LEAD_AGE_DAYS = 90;

// Konfiguracja datasetu dla zdarzeń CRM. Osobne pola, bo leady błyskawiczne
// często idą na inne konto reklamowe niż formularze na stronie — ale gdy nie
// są ustawione, spadamy na globalną konfigurację Meta (prosty przypadek
// „jeden pixel na wszystko” nie wymaga podwójnej konfiguracji).
export async function resolveCrmMetaConfig(db: Db, owner: string): Promise<MetaConfig> {
  const { data } = await db
    .from("app_settings")
    .select(
      "meta_crm_dataset_id, meta_crm_token, meta_crm_test_event_code, meta_crm_enabled, meta_pixel_id, meta_capi_token, meta_test_event_code"
    )
    .eq("owner", owner)
    .maybeSingle();

  return {
    pixelId: data?.meta_crm_dataset_id || data?.meta_pixel_id || "",
    capiToken: data?.meta_crm_token || data?.meta_capi_token || "",
    testEventCode: data?.meta_crm_test_event_code || data?.meta_test_event_code || undefined,
    eventsEnabled: !!data?.meta_crm_enabled,
  };
}

export type CrmLeadEventArgs = {
  owner: string;
  dealId: string | null;
  fbLeadId: string;
  eventName: string;
  stageKey?: string | null;
  eventTime?: Date;
  // Wartość zamknięcia — dokładana do zdarzenia etapu wygranego, żeby Meta
  // optymalizowała pod wartość, a nie samą liczbę konwersji.
  value?: number | null;
  currency?: string;
  // Wiek leada (data wypełnienia formularza po stronie Meta) — do sprawdzenia
  // limitu 90 dni. Brak daty = nie blokujemy.
  leadCreatedAt?: string | null;
};

export type CrmLeadEventOutcome = {
  sent: boolean;
  skipped?: "disabled" | "not-configured" | "already-sent" | "too-old" | "no-lead-id";
  status?: number;
  error?: string;
};

// Wyślij pojedyncze zdarzenie etapu lejka i zaloguj próbę w meta_lead_events.
// NIGDY nie rzuca — wysyłka jest poboczna wobec pracy w CRM.
export async function sendCrmLeadEvent(db: Db, args: CrmLeadEventArgs): Promise<CrmLeadEventOutcome> {
  try {
    if (!args.fbLeadId) return { sent: false, skipped: "no-lead-id" };

    const cfg = await resolveCrmMetaConfig(db, args.owner);
    if (!cfg.eventsEnabled) return { sent: false, skipped: "disabled" };
    if (!cfg.pixelId || !cfg.capiToken) return { sent: false, skipped: "not-configured" };

    // Dany etap raportujemy dla leada raz. Powrót na etap (albo ponowne
    // kliknięcie) nie generuje duplikatu.
    const { data: existing } = await db
      .from("meta_lead_events")
      .select("id, ok, attempts")
      .eq("fb_lead_id", args.fbLeadId)
      .eq("event_name", args.eventName)
      .maybeSingle();
    if (existing?.ok) return { sent: false, skipped: "already-sent" };

    if (isTooOld(args.leadCreatedAt)) {
      await logAttempt(db, args, existing?.id ?? null, (existing?.attempts ?? 0) + 1, {
        ok: false,
        error: `lead starszy niż ${MAX_LEAD_AGE_DAYS} dni — Meta odrzuca takie zdarzenia`,
      });
      return { sent: false, skipped: "too-old" };
    }

    const eventTime = args.eventTime ?? new Date();
    const result = await sendCapiEvent({
      config: cfg,
      eventName: args.eventName,
      // Dedup po stronie Meta: ten sam lead + ten sam etap = to samo zdarzenie,
      // niezależnie ile razy ponowimy.
      eventId: `${args.fbLeadId}:${args.eventName}`,
      eventTime: Math.floor(eventTime.getTime() / 1000),
      actionSource: "system_generated",
      // Dopasowanie po identyfikatorze leada z Facebooka — 100% pewne i bez PII.
      userData: { lead_id: toLeadId(args.fbLeadId) },
      customData: {
        lead_event_source: LEAD_EVENT_SOURCE,
        event_source: "crm",
        ...(typeof args.value === "number" && args.value > 0
          ? { value: args.value, currency: args.currency || "PLN" }
          : {}),
      },
    });

    await logAttempt(db, args, existing?.id ?? null, (existing?.attempts ?? 0) + 1, {
      ok: result.ok,
      status: result.status,
      error: result.error,
      response: result.response,
      eventTime,
    });

    return { sent: result.ok, status: result.status, error: result.error };
  } catch (e) {
    console.error("[sendCrmLeadEvent]", e);
    return { sent: false, error: e instanceof Error ? e.message : "błąd" };
  }
}

// Zdarzenie wynikające ze zmiany etapu deala. Rozwiązuje mapowanie etapu
// (pipeline_stages.meta_event_name) i dane leada, po czym deleguje wysyłkę.
// Deal bez fb_lead_id (formularz na stronie, prospecting) jest pomijany.
export async function sendStageEventForDeal(
  db: Db,
  args: { owner: string; dealId: string; stageKey: string }
): Promise<CrmLeadEventOutcome> {
  const { data: deal } = await db
    .from("deals")
    .select("id, owner, fb_lead_id, fb_created_at, value")
    .eq("id", args.dealId)
    .eq("owner", args.owner)
    .maybeSingle();
  if (!deal?.fb_lead_id) return { sent: false, skipped: "no-lead-id" };

  const { data: stage } = await db
    .from("pipeline_stages")
    .select("key, label, meta_event_name, meta_event_enabled, is_won")
    .eq("owner", args.owner)
    .eq("key", args.stageKey)
    .maybeSingle();

  const eventName = (stage?.meta_event_name || "").trim();
  if (!stage?.meta_event_enabled || !eventName) return { sent: false, skipped: "disabled" };

  return sendCrmLeadEvent(db, {
    owner: args.owner,
    dealId: deal.id as string,
    fbLeadId: deal.fb_lead_id as string,
    eventName,
    stageKey: args.stageKey,
    // Wartość dokładamy tylko na etapie wygranym — na wcześniejszych jest
    // jeszcze szacunkiem i zaburzałaby optymalizację pod wartość.
    value: stage.is_won ? (deal.value as number | null) : null,
    leadCreatedAt: deal.fb_created_at as string | null,
  });
}

// Ponowienie nieudanych wysyłek (cron). Bierze najstarsze wiersze z ok=false
// i próbuje ponownie — dedup po stronie Meta (event_id) sprawia, że ponowienie
// jest bezpieczne nawet jeśli poprzednia próba jednak doszła.
export async function retryPendingCrmEvents(
  db: Db,
  opts: { limit?: number; maxAttempts?: number } = {}
): Promise<{ retried: number; ok: number }> {
  const limit = opts.limit ?? 50;
  const maxAttempts = opts.maxAttempts ?? 5;

  const { data: pending } = await db
    .from("meta_lead_events")
    .select("id, owner, deal_id, fb_lead_id, event_name, stage_key, event_time, attempts")
    .eq("ok", false)
    .lt("attempts", maxAttempts)
    .order("created_at", { ascending: true })
    .limit(limit);

  let ok = 0;
  for (const row of pending ?? []) {
    // Deal mógł zostać usunięty (deal_id ma ON DELETE CASCADE, ale wiersz
    // mógł też powstać bez niego) — wtedy po prostu nie znamy wieku leada.
    const { data: deal } = row.deal_id
      ? await db.from("deals").select("fb_created_at").eq("id", row.deal_id).maybeSingle()
      : { data: null };

    const outcome = await sendCrmLeadEvent(db, {
      owner: row.owner as string,
      dealId: row.deal_id as string | null,
      fbLeadId: row.fb_lead_id as string,
      eventName: row.event_name as string,
      stageKey: row.stage_key as string | null,
      eventTime: row.event_time ? new Date(row.event_time as string) : undefined,
      leadCreatedAt: (deal?.fb_created_at as string | null) ?? null,
    });
    if (outcome.sent) ok++;
  }

  return { retried: (pending ?? []).length, ok };
}

// ── Pomocnicze ─────────────────────────────────────────────────────────────

// Meta oczekuje `lead_id` jako liczby. Identyfikatory Facebooka mieszczą się
// w zakresie bezpiecznych liczb JS, ale gdyby kiedyś przestały — wysyłamy
// wtedy tekst zamiast tracić precyzję po cichu.
function toLeadId(raw: string): number | string {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : raw;
}

function isTooOld(leadCreatedAt: string | null | undefined): boolean {
  if (!leadCreatedAt) return false;
  const t = new Date(leadCreatedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t > MAX_LEAD_AGE_DAYS * 24 * 60 * 60 * 1000;
}

async function logAttempt(
  db: Db,
  args: CrmLeadEventArgs,
  existingId: string | null,
  attempts: number,
  result: { ok: boolean; status?: number; error?: string; response?: unknown; eventTime?: Date }
): Promise<void> {
  const row = {
    owner: args.owner,
    deal_id: args.dealId,
    fb_lead_id: args.fbLeadId,
    event_name: args.eventName,
    stage_key: args.stageKey ?? null,
    event_time: (result.eventTime ?? args.eventTime ?? new Date()).toISOString(),
    ok: result.ok,
    attempts,
    status: result.status ?? null,
    error: result.error ?? null,
    response: (result.response as Record<string, unknown> | null) ?? null,
    sent_at: result.ok ? new Date().toISOString() : null,
  };
  try {
    if (existingId) await db.from("meta_lead_events").update(row).eq("id", existingId);
    else await db.from("meta_lead_events").insert(row);
  } catch (e) {
    // Log jest wtórny wobec samej wysyłki — nie wywracamy z jego powodu.
    console.error("[metaCrm/logAttempt]", e);
  }
}
