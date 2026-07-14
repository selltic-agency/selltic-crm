// app/api/email/send/route.ts
// Wysyła e-mail DO LEADA z karty leada (przycisk „E-mail”). Treść to gotowy,
// wypełniony szablon (subject + html) — placeholdery są już podstawione po
// stronie klienta. Klucz/nadawca/reply-to bierzemy z app_settings właściciela
// (server-side, klucz nigdy nie wraca do klienta). Po wysyłce logujemy wpis
// „email” na osi czasu leada.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

    const { dealId, to, subject, html } = (await req.json()) as {
      dealId?: string;
      to?: string;
      subject?: string;
      html?: string;
    };

    const target = (to || "").trim();
    if (!EMAIL_RE.test(target)) {
      return NextResponse.json({ error: "Lead nie ma poprawnego adresu e-mail." }, { status: 400 });
    }
    if (!subject || !subject.trim()) {
      return NextResponse.json({ error: "Temat nie może być pusty." }, { status: 400 });
    }
    if (!html || !html.trim()) {
      return NextResponse.json({ error: "Treść nie może być pusta." }, { status: 400 });
    }

    // Deal musi należeć do użytkownika (RLS i tak by to wymusiło przy insercie
    // aktywności, ale sprawdzamy jawnie dla czytelnego komunikatu).
    const { data: deal } = await supabase
      .from("deals")
      .select("id, owner")
      .eq("id", dealId)
      .maybeSingle();
    if (!deal) return NextResponse.json({ error: "Nie znaleziono leada." }, { status: 404 });

    const { data: settings } = await supabase
      .from("app_settings")
      .select("resend_api_key, resend_from, resend_reply_to")
      .eq("owner", user.id)
      .maybeSingle();

    const apiKey = (settings?.resend_api_key || process.env.RESEND_API_KEY || "").trim();
    const from = (settings?.resend_from || process.env.RESEND_FROM || "").trim();
    const replyTo = (settings?.resend_reply_to || "").trim();

    if (!apiKey) {
      return NextResponse.json(
        { error: "Brak klucza Resend. Ustaw go w Ustawienia → Integracje." },
        { status: 400 }
      );
    }
    if (!from) {
      return NextResponse.json(
        { error: "Brak adresu nadawcy. Ustaw go w Ustawienia → Integracje." },
        { status: 400 }
      );
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: target,
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: subject.trim(),
        html,
      }),
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      const msg = detail?.message || detail?.error?.message || `Resend zwrócił status ${res.status}.`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    // Zaloguj wpis na osi czasu leada (typ „email”). Body = krótkie podsumowanie,
    // meta = temat + adresat (do ewentualnego podglądu w przyszłości).
    await supabase.from("activities").insert({
      owner: user.id,
      deal_id: deal.id,
      type: "email",
      body: `Wysłano e-mail: „${subject.trim()}” → ${target}`,
      meta: { to: target, subject: subject.trim(), from, reply_to: replyTo || null },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/email/send]", e);
    return NextResponse.json({ error: "Błąd serwera przy wysyłce." }, { status: 500 });
  }
}
