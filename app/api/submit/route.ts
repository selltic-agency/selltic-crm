// app/api/submit/route.ts — publiczny endpoint przyjmujący wypełnienie formularza.
// Ciąg: zgłoszenie (z MIGAWKAMI tytułu+schematu) → lead (wspólna ścieżka §6/§7)
// → sesja completed → mail (jeśli włączony) → Meta CAPI (§9c, fire-and-forget)
// → generyczny webhook (§9d). Działa na service_role (omija RLS) — WYŁĄCZNIE server.
import { NextResponse, after } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { DEFAULT_PHONE_PREFIX, phoneLocalError, splitPhone } from "@/lib/phone";
import { triggerFormSms } from "@/lib/sms/formTrigger";
import { buildDlrNotifyUrl } from "@/lib/sms/provider";
import {
  renderThankYouHtml,
  DEFAULT_THANK_YOU_SUBJECT,
  DEFAULT_THANK_YOU_HTML,
  stepFields,
  type FormSchema,
  type FormSettings,
  type Step,
} from "@/lib/forms";
import { createLeadFromForm } from "@/lib/server/leads";
import { fireCapiLead, fireWebhook } from "@/lib/server/meta";

// Walidacja telefonu po stronie serwera (spójna z frontendem).
function validatePhones(answers: Record<string, unknown>, steps: Step[]): string | null {
  for (const step of steps ?? []) {
    for (const field of stepFields(step)) {
      if (field.type !== "phone") continue;
      const raw = answers[field.id];
      if (raw == null || raw === "") {
        if (field.required) return "Numer telefonu jest wymagany.";
        continue;
      }
      const { prefix, local } = splitPhone(String(raw), field.phonePrefix || DEFAULT_PHONE_PREFIX);
      const msg = phoneLocalError(prefix, local);
      if (msg) return msg;
    }
  }
  return null;
}

// ── Limiter w pamięci: max 10 zgłoszeń / IP / minutę. ──────────────────────
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
  }
  return recent.length > RATE_LIMIT;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim(); // §9c — pierwszy segment nagłówka
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      return NextResponse.json({ error: "Zbyt wiele zgłoszeń. Spróbuj ponownie za chwilę." }, { status: 429 });
    }

    const body = await req.json();
    const { formId, answers, meta, sessionId } = body as {
      formId?: string;
      answers?: Record<string, unknown>;
      meta?: Record<string, unknown>;
      sessionId?: string;
    };
    if (!formId || !answers) return NextResponse.json({ error: "Brak danych" }, { status: 400 });

    const db = createSupabaseAdmin();

    // 1. Formularz (właściciel + schemat opublikowany + stan archiwum).
    const { data: form, error: fErr } = await db
      .from("forms")
      .select("id, owner, title, slug, published, status, archived_at")
      .eq("id", formId)
      .single();
    if (fErr || !form) return NextResponse.json({ error: "Nie znaleziono formularza" }, { status: 404 });
    if (form.status !== "published") return NextResponse.json({ error: "Formularz nieopublikowany" }, { status: 403 });
    // §1 — zarchiwizowany formularz odrzuca nowe zgłoszenia (410).
    if (form.archived_at) return NextResponse.json({ error: "Formularz nie jest już aktywny" }, { status: 410 });

    const schema = (form.published ?? { steps: [], theme: {} }) as FormSchema;
    const steps = (schema.steps ?? []) as Step[];

    const phoneError = validatePhones(answers, steps);
    if (phoneError) return NextResponse.json({ error: phoneError }, { status: 400 });

    // 2. Zapis zgłoszenia z MIGAWKAMI tytułu i schematu (§1). Render odpowiedzi
    //    zawsze użyje tej migawki — zgłoszenie pozostaje czytelne po edycji formularza.
    const { data: submission, error: subErr } = await db
      .from("submissions")
      .insert({
        form_id: form.id,
        answers,
        meta,
        title_snapshot: form.title,
        schema_snapshot: form.published,
        session_id: sessionId ?? null,
      })
      .select("id")
      .single();
    if (subErr) throw subErr;

    // 3. Lead — wspólna ścieżka (mapowanie §7b + tytuł §7a + aktywność + dup).
    const lead = await createLeadFromForm({
      db,
      owner: form.owner,
      formId: form.id,
      formSlug: form.slug,
      formTitle: form.title,
      schema,
      answers,
      incomplete: false,
    });
    const { dealId, name, email, phone, dealExisted } = lead;

    // 3b. Powiąż zgłoszenie z dealem (Inbox).
    await db.from("submissions").update({ deal_id: dealId }).eq("id", submission.id);

    // 3d. Automatyka SMS (moduł SMS): potwierdzenie + alert wewnętrzny. Uruchamiana
    //     w tle przez `after` PO wysłaniu odpowiedzi — NIGDY nie blokuje ekranu
    //     „dziękujemy". Błąd SMS nie może wywrócić zgłoszenia. Wyłącznie ta ścieżka
    //     (ukończone zgłoszenie) wyzwala SMS — porzucenia/recovery są wykluczone.
    after(async () => {
      await triggerFormSms({
        db,
        owner: form.owner,
        form: { id: form.id, title: form.title, slug: form.slug },
        submissionId: submission.id,
        schema,
        answers,
        lead: { dealId, name, phone },
        notifyUrl: buildDlrNotifyUrl(new URL(req.url).origin),
      });
    });

    // 3c. Powiąż/utwórz sesję. Zgłoszenie bez sessionId → syntetyczna sesja
    //     completed, żeby i tak pojawiło się w raportowaniu (§3). Zwrócony
    //     identyfikator sesji jest zarazem event_id dla Meta (dedup z Pixelem).
    const eventSessionId = await linkOrCreateSession(db, {
      sessionId,
      formId: form.id,
      owner: form.owner,
      submissionId: submission.id,
      answers,
      totalSteps: steps.length,
      meta,
    });

    // 4. Konfiguracja e-mail właściciela (Resend, server-side).
    const { data: settings } = await db
      .from("app_settings")
      .select("email_new_lead, notify_email, resend_api_key, resend_from, resend_reply_to")
      .eq("owner", form.owner)
      .maybeSingle();
    const mail: MailConfig = {
      apiKey: settings?.resend_api_key || process.env.RESEND_API_KEY || "",
      from: settings?.resend_from || process.env.RESEND_FROM || "Selltic <leady@twoja-domena.pl>",
      replyTo: settings?.resend_reply_to || undefined,
    };

    if (settings?.email_new_lead && settings.notify_email) {
      await notifyNewLead(mail, settings.notify_email, { name, email, phone, returning: dealExisted });
    }

    // 5. Auto-mail „dziękujemy” do zgłaszającego (odporny na błędy).
    const formSettings = (schema.settings ?? {}) as FormSettings;
    if (email) await sendThankYouEmail(mail, email, name, formSettings);

    // 6. §9c — Meta Conversions API (fire-and-forget, NIGDY nie blokuje odpowiedzi).
    //    Ten sam event_id co Pixel (id sesji) → deduplikacja w Events Managerze.
    await fireCapiLead(db, {
      form: { id: form.id, owner: form.owner, title: form.title },
      sessionId: eventSessionId,
      answers,
      schema,
      lead: { email, phone, name },
      meta: meta as Record<string, unknown> | undefined,
      clientIp: ip,
    });

    // 7. §9d — generyczny webhook (Make/Zapier/GA4), fire-and-forget.
    await fireWebhook(db, {
      formId: form.id,
      owner: form.owner,
      payload: { formId: form.id, slug: form.slug, submissionId: submission.id, dealId, answers, meta },
    });

    return NextResponse.json({ ok: true, dealId });
  } catch (e) {
    console.error("[/api/submit]", e);
    return NextResponse.json({ error: "Błąd serwera" }, { status: 500 });
  }
}

// Powiąż istniejącą sesję ze zgłoszeniem i oznacz jako completed; przy braku
// sessionId utwórz syntetyczną sesję completed (§3 — zgłoszenie bez śledzenia
// nadal widoczne w raportowaniu).
async function linkOrCreateSession(
  db: ReturnType<typeof createSupabaseAdmin>,
  args: {
    sessionId?: string;
    formId: string;
    owner: string;
    submissionId: string;
    answers: Record<string, unknown>;
    totalSteps: number;
    meta?: Record<string, unknown>;
  }
): Promise<string> {
  const nowIso = new Date().toISOString();
  try {
    if (args.sessionId) {
      const { data } = await db
        .from("form_sessions")
        .update({
          status: "completed",
          completed_at: nowIso,
          last_seen_at: nowIso,
          submission_id: args.submissionId,
          answers: args.answers,
        })
        .eq("id", args.sessionId)
        .eq("form_id", args.formId)
        .select("id")
        .maybeSingle();
      if (data) return data.id as string;
      // sessionId nie pasuje — spadamy do syntetycznej.
    }
    const { data: created } = await db
      .from("form_sessions")
      .insert({
        form_id: args.formId,
        owner: args.owner,
        visitor_id: `synthetic:${args.submissionId}`,
        status: "completed",
        started_at: nowIso,
        last_seen_at: nowIso,
        completed_at: nowIso,
        total_steps: args.totalSteps,
        max_step: Math.max(args.totalSteps - 1, 0),
        last_step: Math.max(args.totalSteps - 1, 0),
        answers: args.answers,
        submission_id: args.submissionId,
        meta: { ...(args.meta || {}), synthetic: true },
      })
      .select("id")
      .single();
    return (created?.id as string) ?? args.submissionId;
  } catch (e) {
    // Sesja jest wtórna wobec zgłoszenia — nie przerywamy przepływu.
    console.error("[submit/linkOrCreateSession]", e);
    return args.sessionId ?? args.submissionId;
  }
}

// ── E-mail (Resend) ────────────────────────────────────────────────────────
type MailConfig = { apiKey: string; from: string; replyTo?: string };

async function notifyNewLead(
  mail: MailConfig,
  to: string,
  lead: { name: string; email: string; phone: string; returning: boolean }
) {
  if (!mail.apiKey) return;
  const kind = lead.returning ? "Powracający e-mail — nowy lead" : "Nowy lead";
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${mail.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: mail.from,
        to,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        subject: `🎯 ${kind}: ${lead.name}`,
        html: `<h2>${kind}</h2>
               <p>Nowa szansa sprzedaży z formularza${lead.returning ? " (ten e-mail już wcześniej zostawił zgłoszenie)" : ""}.</p>
               <p><b>Imię:</b> ${lead.name}</p>
               <p><b>Email:</b> ${lead.email || "—"}</p>
               <p><b>Telefon:</b> ${lead.phone || "—"}</p>`,
      }),
    });
  } catch (e) {
    console.error("[notifyNewLead]", e);
  }
}

async function sendThankYouEmail(mail: MailConfig, to: string, name: string, settings: FormSettings) {
  try {
    if (!mail.apiKey) return;
    const cfg = settings.thankYouEmail;
    if (cfg && cfg.enabled === false) return;
    const subject = (cfg?.subject || DEFAULT_THANK_YOU_SUBJECT).trim() || DEFAULT_THANK_YOU_SUBJECT;
    const rawHtml = cfg?.html || DEFAULT_THANK_YOU_HTML;
    const html = renderThankYouHtml(rawHtml, { extraLink: settings.extraLink, name });
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${mail.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: mail.from,
        to,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        subject,
        html,
      }),
    });
  } catch (e) {
    console.error("[sendThankYouEmail]", e);
  }
}
