// app/api/scraper/reject/route.ts
// „Odrzuć / Archiwizuj”: oznacza wybrane scraped_leads jako 'rejected'. W
// przeciwieństwie do „Przenieś do Prospectingu” NIE tworzy prospektów — lead
// znika z aktywnej listy „Leady” i trafia do zakładki „Archiwum”, gdzie
// zostaje zachowany do wglądu. Obsługuje pojedynczy i zbiorczy wybór (tablica).
// Odrzucamy tylko leady w statusie 'new' (aktywne) — nie ruszamy 'moved'/'duplicate'.
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

  let body: { scraped_lead_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  const ids = [...new Set(body.scraped_lead_ids ?? [])];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Nie wybrano żadnych leadów" }, { status: 400 });
  }

  // RLS (auth.uid() = owner) ogranicza zapis do własnych leadów. Warunek
  // status='new' chroni przed przypadkowym nadpisaniem 'moved'/'duplicate'.
  const { data: updated, error } = await supabase
    .from("scraped_leads")
    .update({ status: "rejected" })
    .in("id", ids)
    .eq("status", "new")
    .select("id");

  if (error) {
    console.error("[scraper/reject]", error);
    return NextResponse.json({ error: "Nie udało się odrzucić leadów" }, { status: 500 });
  }

  return NextResponse.json({ rejected: updated?.length ?? 0 });
}
