// app/api/sms/send/route.ts — manualna wysyłka SMS z karty leada.
// Uwierzytelnione (sesja właściciela). Waliduje wejście, normalizuje numer do
// E.164, ROZWIĄZUJE zmienne szablonu server-side z rekordu leada (nierozwiązane
// zmienne BLOKUJĄ wysyłkę), egzekwuje zgodę i limit, zapisuje wiersz i wysyła.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { toE164 } from "@/lib/phone";
import { renderSmsTemplate } from "@/lib/sms/templates";
import { dealSmsValues } from "@/lib/sms/values";
import { dispatchSms } from "@/lib/sms/service";
import type { SmsKind, SmsRelatedType } from "@/lib/types";

// Komunikaty dla użytkownika wg powodu odrzucenia (bez surowych payloadów providera).
const FAIL_MESSAGES: Record<string, string> = {
  invalid_number: "Nieprawidłowy numer telefonu odbiorcy.",
  consent: "Marketing wymaga zgody odbiorcy — ten lead jej nie udzielił.",
  duplicate: "Identyczna wiadomość na ten numer została wysłana przed chwilą.",
  duplicate_submission: "Ta wiadomość została już wysłana.",
  provider: "Nie udało się wysłać SMS. Spróbuj ponownie.",
  no_config: "Bramka SMS nie jest skonfigurowana.",
};

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

    const { relatedType, relatedId, to, body, kind, templateId } = (await req.json()) as {
      relatedType?: SmsRelatedType;
      relatedId?: string;
      to?: string;
      body?: string;
      kind?: SmsKind;
      templateId?: string | null;
    };

    if (!body || !body.trim()) {
      return NextResponse.json({ error: "Treść nie może być pusta." }, { status: 400 });
    }
    const e164 = toE164(String(to ?? ""));
    if (!e164) {
      return NextResponse.json({ error: "Nieprawidłowy numer telefonu odbiorcy." }, { status: 400 });
    }
    const smsKind: SmsKind = kind === "marketing" ? "marketing" : "transactional";

    // Rekord leada (deal) — do zmiennych + jawnego sprawdzenia właściciela.
    let values: Record<string, string> = {};
    if (relatedType === "deal" && relatedId) {
      const { data: deal } = await supabase
        .from("deals")
        .select("id, name, company, assignee")
        .eq("id", relatedId)
        .maybeSingle();
      if (!deal) return NextResponse.json({ error: "Nie znaleziono leada." }, { status: 404 });
      values = dealSmsValues(deal);
    }

    // Rozwiązanie zmiennych server-side. Braki (np. {{meeting_date}} bez spotkania)
    // BLOKUJĄ wysyłkę — nigdy nie wysyłamy dosłownych nawiasów.
    const { text, missing } = renderSmsTemplate(body, values, "strict");
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Nierozwiązane zmienne w treści: ${missing.map((m) => `{{${m}}}`).join(", ")}` },
        { status: 400 }
      );
    }

    const outcome = await dispatchSms(supabase, {
      owner: user.id,
      to: e164,
      body: text,
      kind: smsKind,
      trigger: "manual",
      createdBy: user.id,
      relatedType: relatedType ?? null,
      relatedId: relatedId ?? null,
      templateId: templateId ?? null,
      notifyBaseUrl: new URL(req.url).origin,
      logActivity: true,
    });

    if (!outcome.ok) {
      const msg = FAIL_MESSAGES[outcome.reason] || "Nie udało się wysłać SMS.";
      // provider zostawił wiersz `failed` — porażka jest audytowalna, nie cicha.
      return NextResponse.json({ error: msg }, { status: outcome.reason === "provider" ? 502 : 400 });
    }

    return NextResponse.json({ ok: true, messageId: outcome.messageId });
  } catch (e) {
    console.error("[/api/sms/send]", e);
    return NextResponse.json({ error: "Błąd serwera przy wysyłce SMS." }, { status: 500 });
  }
}
