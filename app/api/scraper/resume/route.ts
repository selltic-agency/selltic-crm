// app/api/scraper/resume/route.ts
// Wznowienie wstrzymanej paczki: ustawia scrape_batches.status = 'running'
// i dosyła do backendu Cloud Run pozostałe zadania 'pending'. Backend podejmie
// je od miejsca, w którym pauza przerwała pętlę (zadania done/error/canceled
// zostają nietknięte — backend akceptuje tylko 'pending').
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { dispatchScrapeJobs } from "@/lib/scraperDispatch";

export const maxDuration = 60;

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

  // Wznawiamy tylko paczkę wstrzymaną (zatrzymanej/zakończonej nie da się).
  const { data, error } = await supabase
    .from("scrape_batches")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", batchId)
    .eq("status", "paused")
    .select("id");
  if (error) {
    console.error("[scraper/resume]", error);
    return NextResponse.json({ error: "Nie udało się wznowić paczki" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Paczki nie można wznowić (nie jest wstrzymana)." },
      { status: 409 }
    );
  }

  // Pozostałe zadania do zrobienia = wciąż 'pending'.
  const { data: pending } = await supabase
    .from("scrape_jobs")
    .select("id")
    .eq("batch_id", batchId)
    .eq("status", "pending");
  const jobIds = (pending ?? []).map((j) => j.id as string);

  if (jobIds.length === 0) {
    // Nic nie zostało do zrobienia — domknij paczkę jako zakończoną.
    await supabase
      .from("scrape_batches")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", batchId);
    return NextResponse.json({ ok: true, status: "completed", dispatched: 0 });
  }

  const result = await dispatchScrapeJobs(supabase, batchId, jobIds);
  return NextResponse.json({
    ok: true,
    status: "running",
    dispatched: jobIds.length,
    ...(result.warning ? { warning: result.warning } : {}),
  });
}
