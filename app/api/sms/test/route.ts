// app/api/sms/test/route.ts — „Wyślij testowy SMS" z edytora formularza.
// Wysyła na własny numer zalogowanego użytkownika, używając PRZYKŁADOWYCH danych.
// Z SMS_TEST_MODE=true przechodzi przez cały flow, ale nic nie jest dostarczane.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { toE164 } from "@/lib/phone";
import { renderSmsTemplate, SMS_SAMPLE_VALUES } from "@/lib/sms/templates";
import { dispatchSms } from "@/lib/sms/service";
import { buildDlrNotifyUrl, getSmsSender } from "@/lib/sms/provider";
import type { SmsTemplate } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

    const { to, templateId, body } = (await req.json()) as {
      to?: string;
      templateId?: string;
      body?: string;
    };

    const e164 = toE164(String(to ?? ""));
    if (!e164) return NextResponse.json({ error: "Podaj poprawny numer telefonu." }, { status: 400 });

    let rawBody = (body || "").trim();
    if (templateId) {
      const { data } = await supabase
        .from("sms_templates")
        .select("*")
        .eq("id", templateId)
        .eq("owner", user.id)
        .maybeSingle();
      const tpl = data as SmsTemplate | null;
      if (!tpl) return NextResponse.json({ error: "Nie znaleziono szablonu." }, { status: 404 });
      rawBody = tpl.body;
    }
    if (!rawBody) return NextResponse.json({ error: "Treść nie może być pusta." }, { status: 400 });

    const { text } = renderSmsTemplate(rawBody, SMS_SAMPLE_VALUES, "graceful");

    const outcome = await dispatchSms(supabase, {
      owner: user.id,
      to: e164,
      body: text,
      kind: "transactional",
      trigger: "manual",
      senderName: getSmsSender() || undefined,
      createdBy: user.id,
      notifyUrl: buildDlrNotifyUrl(new URL(req.url).origin),
      logActivity: false,
    });

    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.error?.message || "Nie udało się wysłać testowego SMS." },
        { status: outcome.reason === "provider" ? 502 : 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[/api/sms/test]", e);
    return NextResponse.json({ error: "Błąd serwera przy wysyłce testu." }, { status: 500 });
  }
}
