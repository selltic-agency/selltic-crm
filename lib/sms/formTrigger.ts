// lib/sms/formTrigger.ts — automatyzacja SMS po zgłoszeniu formularza (server-only).
// Wywoływane z /api/submit PO zatwierdzeniu zgłoszenia i utworzeniu leada,
// jako zadanie w tle (next/server `after`) — NIGDY nie blokuje odpowiedzi ani
// ekranu „dziękujemy". Błąd SMS nie może wywrócić zgłoszenia.
//
// Zakres: potwierdzenie do zgłaszającego (transakcyjne; marketing wymaga zgody),
// alert wewnętrzny (Dominik + Jakub, omija zgodę i dedup). Idempotencja przez
// partial unique index na sms_messages (patrz migration_sms.sql).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormSchema, Step } from "@/lib/forms";
import { stepFields } from "@/lib/forms";
import type { SmsTemplate } from "@/lib/types";
import { toE164 } from "@/lib/phone";
import { renderSmsTemplate } from "./templates";
import { dispatchSms, enqueueScheduledSms, resendMessage, type SmsSendContext } from "./service";

type Db = SupabaseClient;

const INTERNAL_RETRY_DELAY_MS = 30_000;

export type FormSmsTriggerArgs = {
  db: Db;
  owner: string;
  form: { id: string; title: string | null; slug: string | null };
  submissionId: string;
  schema: FormSchema;
  answers: Record<string, unknown>;
  lead: { dealId: string; name: string; phone: string };
  notifyUrl?: string;
};

function firstToken(s: string | null | undefined): string {
  return (s || "").trim().split(/\s+/)[0] || "";
}

// Czy odpowiedź na pole zgody oznacza zaznaczony checkbox.
function isConsentChecked(value: unknown): boolean {
  if (value === true) return true;
  if (Array.isArray(value)) return value.length > 0;
  const s = String(value ?? "").trim().toLowerCase();
  return ["true", "on", "yes", "tak", "1", "zgoda"].includes(s);
}

// Wartość pola zmapowanego na „firmę" (jeśli formularz je ma).
function companyFromAnswers(schema: FormSchema, answers: Record<string, unknown>): string {
  for (const step of (schema.steps ?? []) as Step[]) {
    for (const f of stepFields(step)) {
      if (f.mapping?.property === "company") {
        const v = answers[f.id];
        if (v != null && v !== "") return String(v);
      }
    }
  }
  return "";
}

// Buduje wartości zmiennych szablonu z payloadu zgłoszenia. Braki → puste
// (strategia graceful w renderSmsTemplate). Pola własne dostępne po ID pola.
function buildValues(args: FormSmsTriggerArgs): Record<string, string> {
  const values: Record<string, string> = {
    first_name: firstToken(args.lead.name),
    company: companyFromAnswers(args.schema, args.answers),
    form_name: args.form.title ?? "",
  };
  for (const [k, v] of Object.entries(args.answers)) {
    if (v == null) continue;
    values[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return values;
}

async function loadTemplate(db: Db, owner: string, id: string | null): Promise<SmsTemplate | null> {
  if (!id) return null;
  const { data } = await db
    .from("sms_templates")
    .select("*")
    .eq("id", id)
    .eq("owner", owner)
    .maybeSingle();
  return (data as SmsTemplate) ?? null;
}

// Główne wejście — best-effort, wszystkie błędy łapane i logowane.
export async function triggerFormSms(args: FormSmsTriggerArgs): Promise<void> {
  const { db, owner, form, submissionId } = args;
  try {
    const { data: cfg } = await db
      .from("form_sms_settings")
      .select("*")
      .eq("form_id", form.id)
      .maybeSingle();
    if (!cfg || !cfg.enabled) return;

    const values = buildValues(args);

    // Odbiorca potwierdzenia: numer z wskazanego pola telefonu (znormalizowany).
    const rawPhone = cfg.phone_field_id ? args.answers[cfg.phone_field_id] : args.lead.phone;
    const toNumber = toE164(String(rawPhone ?? ""));

    const consentChecked = cfg.consent_field_id
      ? isConsentChecked(args.answers[cfg.consent_field_id])
      : false;

    // Utrwal zgodę na rekordzie leada (dowód RODO: z jakiego formularza/zgłoszenia).
    if (consentChecked) {
      await db
        .from("deals")
        .update({
          sms_consent: true,
          sms_consent_at: new Date().toISOString(),
          sms_consent_form_id: form.id,
          sms_consent_submission_id: submissionId,
        })
        .eq("id", args.lead.dealId);
    }

    // ── Limit nadużyć: pułap SMS na formularz na godzinę ────────────────────
    if (cfg.confirmation_enabled || cfg.internal_enabled) {
      const sinceHour = new Date(Date.now() - 60 * 60_000).toISOString();
      const { count } = await db
        .from("sms_messages")
        .select("id", { count: "exact", head: true })
        .eq("form_id", form.id)
        .gte("created_at", sinceHour);
      if ((count ?? 0) >= (cfg.hourly_cap ?? 50)) {
        console.warn(`[sms/formTrigger] pułap godzinowy formularza ${form.id} osiągnięty — pomijam SMS`);
        return; // zgłoszenie już zapisane; SMS pomijamy
      }
    }

    // ── Potwierdzenie do zgłaszającego ──────────────────────────────────────
    if (cfg.confirmation_enabled && cfg.confirmation_template_id && toNumber) {
      await sendConfirmation(args, cfg, values, toNumber, consentChecked);
    }

    // ── Alert wewnętrzny (Dominik + Jakub) — omija zgodę i dedup ─────────────
    if (cfg.internal_enabled && cfg.internal_template_id && (cfg.internal_recipients?.length ?? 0) > 0) {
      await sendInternal(args, cfg, values);
    }
  } catch (e) {
    // Automatyka SMS jest wtórna wobec zgłoszenia — nie propagujemy błędu.
    console.error("[sms/formTrigger]", e);
  }
}

async function sendConfirmation(
  args: FormSmsTriggerArgs,
  cfg: { confirmation_template_id: string; confirmation_delay_seconds: number },
  values: Record<string, string>,
  toNumber: string,
  consentChecked: boolean
) {
  const { db, owner, form, submissionId } = args;
  const tpl = await loadTemplate(db, owner, cfg.confirmation_template_id);
  if (!tpl) return;

  // Marketing wymaga zaznaczonej zgody w TYM zgłoszeniu.
  if (tpl.kind === "marketing" && !consentChecked) {
    console.warn(`[sms/formTrigger] pominięto potwierdzenie (marketing bez zgody) zgłoszenie=${submissionId}`);
    return;
  }

  // Dedup: brak potwierdzenia na ten sam numer z tego formularza w 15 min.
  const since15 = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: recent } = await db
    .from("sms_messages")
    .select("id")
    .eq("form_id", form.id)
    .eq("to_number", toNumber)
    .eq("trigger", "form_confirmation")
    .gte("created_at", since15)
    .limit(1);
  if (recent?.[0]) {
    console.warn(`[sms/formTrigger] pominięto potwierdzenie (dedup 15 min) numer=***${toNumber.slice(-3)}`);
    return;
  }

  const { text } = renderSmsTemplate(tpl.body, values, "graceful");
  const ctx: SmsSendContext = {
    owner,
    to: toNumber,
    body: text,
    kind: tpl.kind,
    trigger: "form_confirmation",
    relatedType: "deal",
    relatedId: args.lead.dealId,
    templateId: tpl.id,
    formId: form.id,
    formSubmissionId: submissionId,
    notifyUrl: args.notifyUrl,
    logActivity: true,
  };

  // Opóźnienie > 0 → kolejkujemy (drenaż cronem). NIGDY nie ponawiamy potwierdzenia.
  const delay = cfg.confirmation_delay_seconds ?? 0;
  if (delay > 0) {
    await enqueueScheduledSms(db, ctx, new Date(Date.now() + delay * 1000).toISOString());
  } else {
    await dispatchSms(db, ctx);
  }
}

async function sendInternal(
  args: FormSmsTriggerArgs,
  cfg: { internal_template_id: string; internal_recipients: string[] },
  values: Record<string, string>
) {
  const { db, owner, form, submissionId } = args;
  const tpl = await loadTemplate(db, owner, cfg.internal_template_id);
  if (!tpl) return;
  const { text } = renderSmsTemplate(tpl.body, values, "graceful");

  for (const rawRecipient of cfg.internal_recipients) {
    const to = toE164(String(rawRecipient));
    if (!to) continue;
    const ctx: SmsSendContext = {
      owner,
      to,
      body: text,
      kind: "transactional", // alerty wewnętrzne zawsze transakcyjne
      trigger: "form_internal",
      formId: form.id,
      formSubmissionId: submissionId,
      notifyUrl: args.notifyUrl,
      logActivity: false,
    };
    const outcome = await dispatchSms(db, ctx);
    // Retry alertu wewnętrznego: raz, po 30 s. Potem log i rezygnacja.
    if (!outcome.ok && outcome.reason === "provider" && outcome.messageId) {
      const messageId = outcome.messageId;
      await new Promise((r) => setTimeout(r, INTERNAL_RETRY_DELAY_MS));
      const retry = await resendMessage(db, messageId, args.notifyUrl);
      if (!retry.ok) {
        console.error(`[sms/formTrigger] alert wewnętrzny nie powiódł się po retry numer=***${to.slice(-3)}`);
      }
    }
  }
}
