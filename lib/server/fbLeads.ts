// lib/server/fbLeads.ts — ingest leadów z formularzy błyskawicznych Facebooka
// (Make.com → /api/leads/facebook). Server-only: działa na service_role.
//
// Idempotencja: deal jest identyfikowany po `fb_lead_id` (leadgen_id z Meta).
// Make ponawia webhooki, a Facebook potrafi przysłać ten sam lead dwa razy —
// powtórka aktualizuje istniejącego deala zamiast tworzyć duplikat.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PHONE_PREFIX, formatPhoneValue, splitPhone } from "@/lib/phone";
import { CONTACT_SOURCE_KEY, ensureContactSourceDef } from "@/lib/contactSource";
import { firstStageKey, flagPhoneDuplicate, notifyNewDeal } from "@/lib/server/leads";
import { loadMailConfig, sendNewLeadEmail } from "@/lib/server/leadMail";
import {
  answersSummary,
  mapFbAnswers,
  type FbFieldMap,
  type FbLeadPayload,
} from "@/lib/fbFieldMapping";

type Db = SupabaseClient;

// Etykieta źródła — używana w mailu i na osi czasu.
export const FB_SOURCE_LABEL = "Facebook Lead Ads";

export type FbIngestResult = {
  lead_id: string;
  status: "created" | "updated" | "skipped" | "error";
  deal_id?: string;
  error?: string;
};

// Konfiguracja formularza FB (mapowanie pól, etap startowy, włącznik).
type FbFormConfig = {
  fb_form_id: string;
  label: string | null;
  field_map: FbFieldMap;
  known_fields: string[];
  default_stage: string | null;
  enabled: boolean;
};

// Wczytuje konfigurację formularza; przy pierwszym leadzie z nieznanego
// formularza zakłada wiersz-zalążek, żeby pojawił się w Ustawieniach gotowy
// do zmapowania pól. Nowy formularz jest od razu aktywny — leady wpadają do
// CRM od pierwszego zgłoszenia, a mapowanie doprecyzowuje się później
// (niezmapowane odpowiedzi i tak lądują na osi czasu).
export async function loadFormConfig(db: Db, owner: string, lead: FbLeadPayload): Promise<FbFormConfig> {
  const formId = lead.formId || "unknown";
  const fields = Object.keys(lead.answers);
  const { data } = await db
    .from("fb_lead_forms")
    .select("fb_form_id, label, field_map, known_fields, default_stage, enabled")
    .eq("fb_form_id", formId)
    .maybeSingle();

  if (data) {
    // Nowe pola w formularzu (właściciel dodał pytanie w Meta) dopisujemy do
    // listy znanych, żeby pojawiły się w Ustawieniach do zmapowania.
    const known = new Set<string>(((data.known_fields as string[] | null) ?? []).concat(fields));
    if (known.size !== ((data.known_fields as string[] | null) ?? []).length) {
      await db.from("fb_lead_forms").update({ known_fields: [...known] }).eq("fb_form_id", formId);
    }
    return {
      fb_form_id: data.fb_form_id as string,
      label: (data.label as string | null) ?? lead.formName,
      field_map: (data.field_map as FbFieldMap | null) ?? {},
      known_fields: [...known],
      default_stage: (data.default_stage as string | null) ?? null,
      enabled: data.enabled !== false,
    };
  }

  await db.from("fb_lead_forms").upsert(
    { fb_form_id: formId, owner, label: lead.formName, field_map: {}, known_fields: fields },
    { onConflict: "fb_form_id" }
  );

  return {
    fb_form_id: formId,
    label: lead.formName,
    field_map: {},
    known_fields: fields,
    default_stage: null,
    enabled: true,
  };
}

// Numer z Facebooka przychodzi jako "+48512345678" — sprowadzamy do formatu
// używanego w CRM ("+48 512 345 678"), żeby wyszukiwanie i moduł SMS działały
// tak samo jak dla leadów z formularzy na stronie.
export function normalizeFbPhone(raw: string): string {
  const value = (raw || "").trim();
  if (!value) return "";
  const { prefix, local } = splitPhone(value, DEFAULT_PHONE_PREFIX);
  return formatPhoneValue(prefix, local) || value;
}

// Główna ścieżka: znormalizowany lead z Facebooka → deal w CRM.
export async function ingestFbLead(
  db: Db,
  owner: string,
  lead: FbLeadPayload
): Promise<FbIngestResult> {
  const cfg = await loadFormConfig(db, owner, lead);
  if (!cfg.enabled) {
    return { lead_id: lead.leadId, status: "skipped", error: "Formularz wyłączony w ustawieniach CRM" };
  }

  const mapped = mapFbAnswers(lead.answers, cfg.field_map);
  const phone = normalizeFbPhone(mapped.phone);
  const email = mapped.email;
  const title = mapped.name || email || phone || `Lead z ${cfg.label || FB_SOURCE_LABEL}`;

  // Kolumny „twarde” — te same przy tworzeniu i przy ponownym przyjęciu leada.
  const fbColumns = {
    fb_lead_id: lead.leadId,
    fb_form_id: lead.formId || null,
    fb_form_name: cfg.label ?? lead.formName ?? null,
    fb_page_id: lead.pageId,
    fb_ad_id: lead.adId,
    fb_adset_id: lead.adsetId,
    fb_campaign_id: lead.campaignId,
    fb_platform: lead.platform,
    fb_is_organic: lead.isOrganic,
    fb_created_at: lead.createdAt,
  };

  const { data: existing } = await db
    .from("deals")
    .select("id")
    .eq("fb_lead_id", lead.leadId)
    .maybeSingle();

  // Powtórka: aktualizujemy metadane kampanii (mogły dojść w kolejnym
  // przebiegu Make), ale NIE ruszamy etapu, właściwości ani osi czasu —
  // praca wykonana w CRM jest ważniejsza niż ponowiony webhook.
  if (existing?.id) {
    await db.from("deals").update(fbColumns).eq("id", existing.id);
    return { lead_id: lead.leadId, status: "updated", deal_id: existing.id as string };
  }

  await ensureContactSourceDef(db, owner);

  const props: Record<string, unknown> = { ...mapped.props };
  if (props[CONTACT_SOURCE_KEY] == null || props[CONTACT_SOURCE_KEY] === "") {
    props[CONTACT_SOURCE_KEY] = "facebook_lead_ads";
  }
  // Odpowiedzi bez mapowania przechowujemy surowo — zero utraty danych, nawet
  // gdy mapowanie formularza jest jeszcze nieskonfigurowane.
  if (Object.keys(mapped.unmapped).length > 0) props.fb_answers = mapped.unmapped;

  const stage = cfg.default_stage || (await firstStageKey(db, owner));
  const dealExisted = email
    ? !!(await db.from("deals").select("id").eq("owner", owner).eq("email", email).limit(1).maybeSingle()).data
    : false;

  const insert: Record<string, unknown> = {
    owner,
    name: title,
    email,
    phone,
    stage,
    source: lead.formId ? `facebook:${lead.formId}` : "facebook",
    props,
    // Czas wypełnienia po stronie Meta — deal ma być na liście w miejscu
    // odpowiadającym realnemu momentowi pozyskania leada, nie momentowi
    // przyjęcia webhooka.
    ...(lead.createdAt ? { opened_at: lead.createdAt } : {}),
    ...fbColumns,
  };
  if (mapped.company) insert.company = mapped.company;
  if (typeof mapped.value === "number") insert.value = mapped.value;

  const { data: deal, error } = await db.from("deals").insert(insert).select("id").single();
  if (error) {
    // Wyścig dwóch równoległych webhooków o ten sam lead: unikalny indeks na
    // fb_lead_id odbija drugi INSERT. To nie jest błąd — deal właśnie powstał.
    if (error.code === "23505") {
      const { data: raced } = await db.from("deals").select("id").eq("fb_lead_id", lead.leadId).maybeSingle();
      if (raced?.id) return { lead_id: lead.leadId, status: "updated", deal_id: raced.id as string };
    }
    console.error("[fbLeads/ingest]", lead.leadId, error);
    return { lead_id: lead.leadId, status: "error", error: error.message };
  }
  const dealId = deal.id as string;

  // Oś czasu: pełna treść zgłoszenia (wszystkie odpowiedzi, także niezmapowane).
  const summary = answersSummary(lead.answers);
  await db.from("activities").insert({
    owner,
    deal_id: dealId,
    type: "submission",
    body: summary || `Wypełnił formularz błyskawiczny „${cfg.label || lead.formId}”`,
    meta: {
      source: "facebook_lead_ads",
      fb_lead_id: lead.leadId,
      fb_form_id: lead.formId,
      fb_campaign_id: lead.campaignId,
      fb_ad_id: lead.adId,
      platform: lead.platform,
    },
  });

  await notifyNewDeal(
    db,
    owner,
    dealId,
    `${dealExisted ? "Powracający e-mail — nowy lead" : "Nowy lead"} (${FB_SOURCE_LABEL}): ${title}`
  );
  await flagPhoneDuplicate(db, owner, dealId, phone);

  // Licznik na formularzu — do podglądu w Ustawieniach, że ingest żyje.
  await db
    .from("fb_lead_forms")
    .update({ last_lead_at: new Date().toISOString(), leads_count: await countLeads(db, cfg.fb_form_id) })
    .eq("fb_form_id", cfg.fb_form_id);

  await maybeNotifyByEmail(db, owner, {
    name: title,
    email,
    phone,
    returning: dealExisted,
    details: summary,
  });

  return { lead_id: lead.leadId, status: "created", deal_id: dealId };
}

async function countLeads(db: Db, formId: string): Promise<number> {
  const { count } = await db
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("fb_form_id", formId);
  return count ?? 0;
}

// Mail „nowy lead” — o ile właściciel go nie wyłączył (osobny przełącznik dla
// leadów z Facebooka, bo ich wolumen bywa inny niż formularzy na stronie).
async function maybeNotifyByEmail(
  db: Db,
  owner: string,
  lead: { name: string; email: string; phone: string; returning: boolean; details: string }
): Promise<void> {
  try {
    const { data: settings } = await db
      .from("app_settings")
      .select("email_new_lead, notify_email, fb_leads_notify")
      .eq("owner", owner)
      .maybeSingle();
    if (!settings?.email_new_lead || !settings.notify_email) return;
    if (settings.fb_leads_notify === false) return;

    const mail = await loadMailConfig(db, owner);
    await sendNewLeadEmail(mail, settings.notify_email, { ...lead, sourceLabel: FB_SOURCE_LABEL });
  } catch (e) {
    console.error("[fbLeads/notify]", e);
  }
}
