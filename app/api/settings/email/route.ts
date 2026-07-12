// app/api/settings/email/route.ts
// Integracje → Wysyłka e-mail (item 9). Trzyma klucz Resend WYŁĄCZNIE po stronie
// serwera: GET zwraca tylko czy klucz jest ustawiony (+ adres nadawcy), nigdy
// samego klucza. POST zapisuje klucz/adres (pusty klucz = bez zmian).
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
    .select("resend_api_key, resend_from")
    .eq("owner", user.id)
    .maybeSingle();

  return NextResponse.json({
    configured: !!(data?.resend_api_key && String(data.resend_api_key).trim()),
    from: data?.resend_from ?? "",
  });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const { apiKey, from, clear } = (await req.json()) as {
    apiKey?: string;
    from?: string;
    clear?: boolean;
  };

  const update: Record<string, unknown> = { owner: user.id };
  if (typeof from === "string") update.resend_from = from.trim() || null;
  // Pusty klucz = zostaw istniejący. Jawny `clear` = usuń klucz.
  if (clear) update.resend_api_key = null;
  else if (apiKey && apiKey.trim()) update.resend_api_key = apiKey.trim();

  const { error } = await supabase.from("app_settings").upsert(update, { onConflict: "owner" });
  if (error) {
    console.error("[/api/settings/email]", error);
    return NextResponse.json({ error: "Nie udało się zapisać ustawień." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
