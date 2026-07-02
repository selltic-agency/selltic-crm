// app/api/prospecting/archive/route.ts
// Archiwizacja / przywracanie prospektów (miękkie usunięcie). Obsługuje
// pojedynczy i zbiorczy wybór (tablica `ids`). `archived: true` ustawia
// `archived_at = now()` (prospekt znika z aktywnych list, trafia do „Archiwum”),
// `archived: false` czyści `archived_at` (przywrócenie). Status dzwonienia
// (`prospecting_status`) pozostaje nietknięty. RLS (auth.uid() = owner)
// ogranicza zapis do własnych prospektów.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  let body: { ids?: string[]; archived?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  const ids = [...new Set(body.ids ?? [])];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Nie wybrano żadnych prospektów" }, { status: 400 });
  }
  const archived = body.archived !== false; // domyślnie archiwizuj

  const { data, error } = await supabase
    .from("prospects")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .in("id", ids)
    .select("id");

  if (error) {
    console.error("[prospecting/archive]", error);
    return NextResponse.json({ error: "Nie udało się zaktualizować prospektów" }, { status: 500 });
  }

  return NextResponse.json({ updated: data?.length ?? 0, archived });
}
