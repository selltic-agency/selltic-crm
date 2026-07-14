// app/api/email/test/route.ts
// Wysyła testowy e-mail przez Resend, używając klucza właściciela zapisanego
// server-side w app_settings (item 9) — albo klucza podanego jednorazowo w body
// (do „Test połączenia”, zanim użytkownik zapisze). Klucz nigdy nie wraca do
// klienta. Używane przez: kreator (podgląd szablonu) i Ustawienia → Integracje.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import {
  renderThankYouHtml,
  DEFAULT_THANK_YOU_SUBJECT,
  DEFAULT_THANK_YOU_HTML,
} from "@/lib/forms";

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

    const { to, subject, html, extraLink, apiKey: bodyKey, from: bodyFrom } =
      (await req.json()) as {
        to?: string;
        subject?: string;
        html?: string;
        extraLink?: string;
        apiKey?: string;
        from?: string;
      };

    const target = (to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      return NextResponse.json({ error: "Podaj poprawny adres e-mail." }, { status: 400 });
    }

    // Klucz/nadawca: preferuj podane w body (test przed zapisem), potem
    // app_settings, na końcu zmienne środowiskowe.
    const { data: settings } = await supabase
      .from("app_settings")
      .select("resend_api_key, resend_from, resend_reply_to")
      .eq("owner", user.id)
      .maybeSingle();

    const apiKey = (bodyKey || settings?.resend_api_key || process.env.RESEND_API_KEY || "").trim();
    const from = (bodyFrom || settings?.resend_from || process.env.RESEND_FROM || "Selltic <leady@twoja-domena.pl>").trim();
    const replyTo = (settings?.resend_reply_to || "").trim();

    if (!apiKey) {
      return NextResponse.json(
        { error: "Brak klucza Resend. Ustaw go w Ustawienia → Integracje." },
        { status: 400 }
      );
    }

    const finalSubject = (subject || DEFAULT_THANK_YOU_SUBJECT).trim() || DEFAULT_THANK_YOU_SUBJECT;
    const finalHtml = renderThankYouHtml(html || DEFAULT_THANK_YOU_HTML, {
      extraLink,
      name: "Test",
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: target,
        subject: `[TEST] ${finalSubject}`,
        html: finalHtml,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      const msg = detail?.message || detail?.error?.message || `Resend zwrócił status ${res.status}.`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/email/test]", e);
    return NextResponse.json({ error: "Błąd serwera przy wysyłce testu." }, { status: 500 });
  }
}
