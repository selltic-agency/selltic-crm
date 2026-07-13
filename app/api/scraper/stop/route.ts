// app/api/scraper/stop/route.ts
// Zatrzymanie paczki (NIEODWRACALNE): ustawia scrape_batches.status = 'stopped'
// i anuluje wszystkie pozostałe zadania 'pending' (status → 'canceled'). Leady
// już znalezione ZOSTAJĄ — anulujemy tylko pracę, która się jeszcze nie zaczęła.
// Zadanie aktualnie 'running' dokończy się; backend nie wystartuje kolejnych, bo
// widzi status 'stopped'. Zatrzymanej paczki nie da się wznowić — trzeba
// uruchomić nowe scrapowanie.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });

  let batchId: string | undefined;
  try {
    batchId = (await req.json())?.batch_id;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }
  if (!batchId) return NextResponse.json({ error: "Brak batch_id" }, { status: 400 });

  // Tylko paczki jeszcze aktywne (running/paused) można zatrzymać.
  const { data, error } = await supabase
    .from("scrape_batches")
    .update({ status: "stopped", updated_at: new Date().toISOString() })
    .eq("id", batchId)
    .in("status", ["running", "paused"])
    .select("id");
  if (error) {
    console.error("[scraper/stop]", error);
    return NextResponse.json({ error: "Nie udało się zatrzymać paczki" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Paczki nie można zatrzymać (już zakończona)." },
      { status: 409 }
    );
  }

  // Anuluj pozostałe zadania, które jeszcze nie ruszyły. Nieodwracalne —
  // ponowne uruchomienie wymaga nowego scrapowania.
  const { data: canceled, error: cancelErr } = await supabase
    .from("scrape_jobs")
    .update({ status: "canceled", completed_at: new Date().toISOString(), current_step: null })
    .eq("batch_id", batchId)
    .eq("status", "pending")
    .select("id");
  if (cancelErr) {
    console.error("[scraper/stop] anulowanie zadań", cancelErr);
  }

  return NextResponse.json({ ok: true, status: "stopped", canceled: canceled?.length ?? 0 });
}
