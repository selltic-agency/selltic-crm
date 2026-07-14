// app/api/submit/route.ts
// Publiczny endpoint przyjmujący wypełnienie formularza.
// Ciąg: submission → nowy deal (każde zgłoszenie = osobna szansa) → activity → mail (jeśli włączony).
// Działa na service_role (omija RLS), więc trzyma się WYŁĄCZNIE serwera.
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { DEFAULT_PHONE_PREFIX, phoneLocalError, splitPhone } from "@/lib/phone";
import {
  renderThankYouHtml,
  DEFAULT_THANK_YOU_SUBJECT,
  DEFAULT_THANK_YOU_HTML,
  stepFields,
  type FormSettings,
  type Step,
} from "@/lib/forms";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Walidacja telefonu po stronie serwera (nie do obejścia bezpośrednim POST-em).
// Zwraca komunikat błędu lub null. Sprawdza wszystkie pola typu „phone”
// (item 6 — krok może zawierać wiele pól).
function validatePhones(answers: Record<string, any>, steps: Step[]): string | null {
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

// ── Prosty limiter w pamięci: max 10 zgłoszeń / IP / minutę. ───────────────
// Uwaga: w środowisku serverless pamięć jest per-instancja — to ochrona przed
// oczywistym spamem, nie twardy globalny limit. Do produkcji na większą skalę
// warto przenieść licznik do Redis/Upstash.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  // Sprzątanie, by mapa nie rosła w nieskończoność.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  return recent.length > RATE_LIMIT;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// Wyciąga email/imię/telefon z odpowiedzi.
// Najpewniejsze: oznacz pola w schemacie formularza polem `map: 'email'|'name'|'phone'`.
// Tu jest fallback heurystyczny, gdyby mapowania zabrakło.
function extract(answers: Record<string, any>, steps: Step[]) {
  let email = "", name = "", phone = "";
  for (const step of steps ?? []) {
    for (const field of stepFields(step)) {
      const v = answers[field.id];
      if (v == null || v === "") continue;
      if (field.map === "email" || (field.type === "email" && !email)) email = String(v);
      else if (field.map === "name") name = String(v);
      else if (field.map === "phone") phone = String(v);
    }
  }
  if (!email) for (const v of Object.values(answers)) if (typeof v === "string" && EMAIL_RE.test(v)) { email = v; break; }
  if (!name) name = Object.values(answers).find((v) => typeof v === "string" && v.length < 40 && !EMAIL_RE.test(v)) as string ?? "Nowy lead";
  return { email, name, phone };
}

export async function POST(req: Request) {
  try {
    if (rateLimited(clientIp(req))) {
      return NextResponse.json(
        { error: "Zbyt wiele zgłoszeń. Spróbuj ponownie za chwilę." },
        { status: 429 }
      );
    }

    const { formId, answers, meta } = await req.json();
    if (!formId || !answers) return NextResponse.json({ error: "Brak danych" }, { status: 400 });

    const db = createSupabaseAdmin();

    // 1. formularz (właściciel + schemat do mapowania pól)
    const { data: form, error: fErr } = await db
      .from("forms").select("id, owner, slug, published, status").eq("id", formId).single();
    if (fErr || !form) return NextResponse.json({ error: "Nie znaleziono formularza" }, { status: 404 });
    if (form.status !== "published") return NextResponse.json({ error: "Formularz nieopublikowany" }, { status: 403 });

    const steps = form.published?.steps ?? [];

    // Walidacja telefonu po stronie serwera (item 5) — spójna z frontendem.
    const phoneError = validatePhones(answers, steps);
    if (phoneError) return NextResponse.json({ error: phoneError }, { status: 400 });

    const { email, name, phone } = extract(answers, steps);

    // 2. zapis surowego zgłoszenia (id potrzebne, by potem dopisać
    //    deal_id — zasila widok Inbox).
    const { data: submission, error: subErr } = await db
      .from("submissions")
      .insert({ form_id: form.id, answers, meta })
      .select("id")
      .single();
    if (subErr) throw subErr;

    // 3. „Powracający” tylko dla komunikatu powiadomienia — czy ten e-mail
    //    miał już wcześniej deal. Nie scalamy danych, każde zgłoszenie to
    //    NOWY, samodzielny deal (osobna szansa sprzedaży z własną kopią
    //    tożsamości).
    const { data: existing } = email
      ? await db.from("deals").select("id").eq("owner", form.owner).eq("email", email).limit(1).maybeSingle()
      : { data: null };
    const dealExisted = !!existing;

    // 4. Etap startowy = pierwszy etap lejka właściciela (fallback 'new').
    const { data: firstStage } = await db
      .from("pipeline_stages")
      .select("key")
      .eq("owner", form.owner)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    const stageKey = firstStage?.key ?? "new";

    const { data: deal, error: dErr } = await db.from("deals").insert({
      owner: form.owner,
      name, email, phone,
      stage: stageKey,
      source: form.slug ? `form:${form.slug}` : "form",
      form_id: form.id,
    }).select("id").single();
    if (dErr) throw dErr;
    const dealId = deal.id;

    // 4b. dopisz deal_id do zgłoszenia — żeby Inbox mógł linkować zgłoszenie
    //     do dealu, które utworzyło.
    await db.from("submissions").update({ deal_id: dealId }).eq("id", submission.id);

    // 5. aktywność „zgłoszenie” — oś czasu tego deala. Iterujemy po polach
    //    (item 6 — krok może zawierać wiele pól).
    const summary = (steps as Step[])
      .flatMap((s) => stepFields(s))
      .filter((f) => {
        const v = answers[f.id];
        return v != null && v !== "" && !(Array.isArray(v) && v.length === 0);
      })
      .map((f) => {
        const v = answers[f.id];
        return `${f.question}: ${Array.isArray(v) ? v.join(", ") : v}`;
      })
      .join("\n");
    await db.from("activities").insert({
      owner: form.owner, deal_id: dealId, type: "submission",
      body: summary || "Wypełnił formularz", meta: { formId: form.id },
    });

    // 6. flaga duplikatu: telefon pasuje do INNEGO deala.
    if (phone) {
      const { data: phoneMatches } = await db
        .from("deals")
        .select("id")
        .eq("owner", form.owner)
        .eq("phone", phone)
        .neq("id", dealId)
        .limit(1);
      const phoneMatch = phoneMatches?.[0];
      if (phoneMatch) {
        await db.from("duplicate_flags").insert({
          owner: form.owner,
          deal_a: dealId,
          deal_b: phoneMatch.id,
          reason: "phone match, different email",
        });
      }
    }

    // 7. powiadomienie w aplikacji (dzwonek) — z rozróżnieniem czy e-mail
    //    miał już wcześniej deal.
    const leadKind = dealExisted ? "Powracający e-mail — nowy lead" : "Nowy lead";
    await db.from("notifications").insert({
      owner: form.owner,
      deal_id: dealId,
      type: "new_lead",
      body: `${leadKind}: ${name}`,
    });

    // 8. Konfiguracja e-mail właściciela: klucz Resend (item 9 — trzymany
    //    server-side w app_settings) + adres nadawcy + adres powiadomień.
    const { data: settings } = await db.from("app_settings")
      .select("email_new_lead, notify_email, resend_api_key, resend_from, resend_reply_to")
      .eq("owner", form.owner)
      .maybeSingle();
    const mail: MailConfig = {
      apiKey: settings?.resend_api_key || process.env.RESEND_API_KEY || "",
      from: settings?.resend_from || process.env.RESEND_FROM || "Selltic <leady@twoja-domena.pl>",
      replyTo: settings?.resend_reply_to || undefined,
    };

    // Powiadomienie mailowe DO WŁAŚCICIELA (jeśli włączone w ustawieniach).
    if (settings?.email_new_lead && settings.notify_email) {
      await notifyNewLead(mail, settings.notify_email, { name, email, phone, returning: dealExisted });
    }

    // 9. automatyczny mail „dziękujemy” DO ZGŁASZAJĄCEGO (item 8).
    //    Wysyłka jest odporna na błędy — nigdy nie blokuje zapisu zgłoszenia.
    const formSettings = (form.published?.settings ?? {}) as FormSettings;
    if (email) {
      await sendThankYouEmail(mail, email, name, formSettings);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/submit]", e);
    return NextResponse.json({ error: "Błąd serwera" }, { status: 500 });
  }
}

// Konfiguracja wysyłki e-mail (item 9). Klucz preferencyjnie z app_settings
// (ustawiany w Ustawienia → Integracje), z fallbackiem do zmiennej środowiskowej.
type MailConfig = { apiKey: string; from: string; replyTo?: string };

// Wyślij maila przez Resend (https://resend.com). Działa tylko gdy jest klucz.
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

// Automatyczny mail z podziękowaniem do osoby, która wypełniła formularz.
// Treść pochodzi z ustawień formularza (edytowalna w kreatorze) lub z domyślnego
// szablonu. Błędy są logowane i połykane — zapis zgłoszenia jest już zakończony.
async function sendThankYouEmail(mail: MailConfig, to: string, name: string, settings: FormSettings) {
  try {
    if (!mail.apiKey) return;
    const cfg = settings.thankYouEmail;
    // Domyślnie włączone — wyłączamy tylko gdy jawnie ustawiono enabled=false.
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
