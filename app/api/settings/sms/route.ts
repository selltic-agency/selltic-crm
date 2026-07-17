// app/api/settings/sms/route.ts — Ustawienia → Bramka SMS (SMSAPI).
// Trzyma token i sekret DLR WYŁĄCZNIE po stronie serwera: GET zwraca tylko czy
// są ustawione (+ nadawca, base URL, tryb testowy), nigdy samych sekretów.
// POST zapisuje wartości (pusty sekret = bez zmian; jawny `clear*` = usuń).
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const { data } = await supabase
    .from("app_settings")
    .select("smsapi_token, smsapi_sender, smsapi_base_url, sms_test_mode, sms_dlr_secret")
    .eq("owner", user.id)
    .maybeSingle();

  return NextResponse.json({
    tokenConfigured: !!(data?.smsapi_token && String(data.smsapi_token).trim()),
    dlrConfigured: !!(data?.sms_dlr_secret && String(data.sms_dlr_secret).trim()),
    sender: data?.smsapi_sender ?? "",
    baseUrl: data?.smsapi_base_url ?? "",
    testMode: !!data?.sms_test_mode,
  });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const { token, sender, baseUrl, testMode, dlrSecret, clearToken, clearDlr } =
    (await req.json()) as {
      token?: string;
      sender?: string;
      baseUrl?: string;
      testMode?: boolean;
      dlrSecret?: string;
      clearToken?: boolean;
      clearDlr?: boolean;
    };

  const update: Record<string, unknown> = { owner: user.id };
  if (typeof sender === "string") update.smsapi_sender = sender.trim() || null;
  if (typeof baseUrl === "string") update.smsapi_base_url = baseUrl.trim() || null;
  if (typeof testMode === "boolean") update.sms_test_mode = testMode;
  // Pusty sekret = zostaw istniejący. Jawny `clear*` = usuń.
  if (clearToken) update.smsapi_token = null;
  else if (token && token.trim()) update.smsapi_token = token.trim();
  if (clearDlr) update.sms_dlr_secret = null;
  else if (dlrSecret && dlrSecret.trim()) update.sms_dlr_secret = dlrSecret.trim();

  const { error } = await supabase.from("app_settings").upsert(update, { onConflict: "owner" });
  if (error) {
    console.error("[/api/settings/sms]", error);
    const missingColumn =
      error.code === "PGRST204" || /column .*(smsapi_|sms_test_mode|sms_dlr_secret)/i.test(error.message || "");
    const msg = missingColumn
      ? "Baza nie ma kolumn na ustawienia bramki SMS. Uruchom migrację migration_sms_settings.sql w Supabase."
      : `Nie udało się zapisać ustawień: ${error.message}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
