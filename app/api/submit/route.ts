// app/api/submit/route.ts
// Publiczny endpoint przyjmujący wypełnienie formularza.
// Ciąg: submission → upsert kontaktu (po emailu) → activity → mail (jeśli włączony).
// Działa na service_role (omija RLS), więc trzyma się WYŁĄCZNIE serwera.
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
function extract(answers: Record<string, any>, steps: any[]) {
  let email = "", name = "", phone = "";
  for (const step of steps ?? []) {
    const v = answers[step.id];
    if (v == null || v === "") continue;
    if (step.map === "email" || (step.type === "email" && !email)) email = String(v);
    else if (step.map === "name") name = String(v);
    else if (step.map === "phone") phone = String(v);
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
    const { email, name, phone } = extract(answers, steps);

    // 2. zapis surowego zgłoszenia
    await db.from("submissions").insert({ form_id: form.id, answers, meta });

    // 3. upsert kontaktu po (owner, email)
    let contactId: string;
    const { data: existing } = email
      ? await db.from("contacts").select("id").eq("owner", form.owner).eq("email", email).maybeSingle()
      : { data: null };

    if (existing) {
      contactId = existing.id;
      await db.from("contacts").update({ name: name || undefined, phone: phone || undefined }).eq("id", contactId);
    } else {
      const { data: inserted, error: cErr } = await db.from("contacts").insert({
        owner: form.owner, name, email, phone,
        stage: "new", source: form.slug ? `form:${form.slug}` : "form", form_id: form.id,
      }).select("id").single();
      if (cErr) throw cErr;
      contactId = inserted.id;
    }

    // 4. aktywność na osi czasu
    const summary = steps
      .filter((s: any) => answers[s.id] != null && answers[s.id] !== "" && s.type !== "welcome" && s.type !== "end")
      .map((s: any) => `${s.question}: ${answers[s.id]}`).join("\n");
    await db.from("activities").insert({
      owner: form.owner, contact_id: contactId, type: "submission",
      body: summary || "Wypełnił formularz", meta: { formId: form.id },
    });

    // 5. powiadomienie w aplikacji (dzwonek) — tylko dla nowych kontaktów
    if (!existing) {
      await db.from("notifications").insert({
        owner: form.owner,
        contact_id: contactId,
        type: "new_lead",
        body: `Nowy lead: ${name}`,
      });
    }

    // 6. powiadomienie mailowe (jeśli włączone w ustawieniach)
    const { data: settings } = await db.from("app_settings")
      .select("email_new_lead, notify_email").eq("owner", form.owner).maybeSingle();
    if (settings?.email_new_lead && settings.notify_email) {
      await notifyNewLead(settings.notify_email, { name, email, phone });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/submit]", e);
    return NextResponse.json({ error: "Błąd serwera" }, { status: 500 });
  }
}

// Wyślij maila przez Resend (https://resend.com). Działa tylko gdy ustawisz RESEND_API_KEY.
// Alternatywa: zamiast tego POST do webhooka Make, który wyśle Gmaila.
async function notifyNewLead(to: string, lead: { name: string; email: string; phone: string }) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "Selltic <leady@twoja-domena.pl>",
        to,
        subject: `🎯 Nowy lead: ${lead.name}`,
        html: `<h2>Nowy lead z formularza</h2>
               <p><b>Imię:</b> ${lead.name}</p>
               <p><b>Email:</b> ${lead.email || "—"}</p>
               <p><b>Telefon:</b> ${lead.phone || "—"}</p>`,
      }),
    });
  } catch (e) {
    console.error("[notifyNewLead]", e);
  }
}
