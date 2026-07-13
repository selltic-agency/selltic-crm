// app/api/scraper/pause/route.ts
// Pauza paczki: ustawia scrape_batches.status = 'paused'. Backend (Cloud Run)
// sprawdza ten status PRZED każdym kolejnym zadaniem i przerywa pętlę,
// pozostawiając zadania 'pending' nietknięte (postęp nie ginie). Zadanie
// aktualnie 'running' dokończy się — pauza wstrzymuje START nowych, nie ubija
// trwającego. Wznowienie (/api/scraper/resume) dosyła pozostałe 'pending'.
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

  // Pauzujemy tylko paczkę wciąż działającą (RLS ogranicza do własnych).
  const { data, error } = await supabase
    .from("scrape_batches")
    .update({ status: "paused", updated_at: new Date().toISOString() })
    .eq("id", batchId)
    .eq("status", "running")
    .select("id");
  if (error) {
    console.error("[scraper/pause]", error);
    return NextResponse.json({ error: "Nie udało się wstrzymać paczki" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Paczki nie można wstrzymać (już zakończona lub zatrzymana)." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, status: "paused" });
}
