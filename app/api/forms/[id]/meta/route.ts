// app/api/forms/[id]/meta/route.ts — §9a. Ustawienia Meta per-formularz.
// Token CAPI trzymany WYŁĄCZNIE po stronie serwera: GET zwraca tylko, czy token
// jest ustawiony (nigdy jego wartości — §9a/§10). POST zapisuje (pusty token =
// bez zmian; jawny `clearToken` = usuń).
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const { data } = await supabase
    .from("form_meta_settings")
    .select("pixel_id, capi_token, test_event_code, events_enabled, webhook_url")
    .eq("form_id", id)
    .maybeSingle();

  return NextResponse.json({
    pixelId: data?.pixel_id ?? "",
    // Nigdy nie zwracamy tokenu — tylko informację, czy jest ustawiony.
    tokenConfigured: !!(data?.capi_token && String(data.capi_token).trim()),
    testEventCode: data?.test_event_code ?? "",
    eventsEnabled: data?.events_enabled ?? false,
    webhookUrl: data?.webhook_url ?? "",
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  // Formularz musi należeć do użytkownika.
  const { data: form } = await supabase.from("forms").select("owner").eq("id", id).maybeSingle();
  if (!form || form.owner !== user.id) return NextResponse.json({ error: "Brak dostępu." }, { status: 403 });

  const { pixelId, capiToken, clearToken, testEventCode, eventsEnabled, webhookUrl } =
    (await req.json()) as {
      pixelId?: string; capiToken?: string; clearToken?: boolean;
      testEventCode?: string; eventsEnabled?: boolean; webhookUrl?: string;
    };

  const update: Record<string, unknown> = { form_id: id, owner: user.id };
  if (typeof pixelId === "string") update.pixel_id = pixelId.trim() || null;
  if (typeof testEventCode === "string") update.test_event_code = testEventCode.trim() || null;
  if (typeof eventsEnabled === "boolean") update.events_enabled = eventsEnabled;
  if (typeof webhookUrl === "string") update.webhook_url = webhookUrl.trim() || null;
  if (clearToken) update.capi_token = null;
  else if (capiToken && capiToken.trim()) update.capi_token = capiToken.trim();

  const { error } = await supabase.from("form_meta_settings").upsert(update, { onConflict: "form_id" });
  if (error) {
    console.error("[/api/forms/[id]/meta]", error);
    const missing = error.code === "PGRST205" || /form_meta_settings/i.test(error.message || "");
    const msg = missing
      ? "Baza nie ma tabeli form_meta_settings. Uruchom migrację migration_forms_phase.sql w Supabase."
      : `Nie udało się zapisać: ${error.message}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
