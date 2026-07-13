// app/api/scraper/start/route.ts
// Wywoływane z zakładki "Scraper" (zalogowany user, RLS po owner). Tworzy
// wiersz scrape_batches (paczka = jedno kliknięcie), generuje zadania
// scrape_jobs jako iloczyn kartezjański keywords × locations, po czym woła
// webhook Cloud Run z SAMYMI job_id (nigdy z danymi leadów — te zapisuje
// bezpośrednio do Supabase headless backend na Cloud Run).
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { dispatchScrapeJobs } from "@/lib/scraperDispatch";

// Cloud Run może mieć min-instances=0 → pierwszy webhook po bezczynności
// wywołuje zimny start (kilka–kilkanaście s). Domyślny limit czasu funkcji
// Vercel (10 s na Hobby) potrafi ubić żądanie w trakcie tego oczekiwania, ZANIM
// wykona się nasza obsługa błędu — zadania zostają wtedy w "pending" bez śladu.
// Podnosimy limit funkcji, żeby to MY kontrolowali timeout.
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  let body: { keywords?: string[]; locations?: string[]; contact_purpose?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  const keywords = [...new Set((body.keywords ?? []).map((k) => k.trim()).filter(Boolean))];
  const locations = [...new Set((body.locations ?? []).map((l) => l.trim()).filter(Boolean))];
  if (keywords.length === 0 || locations.length === 0) {
    return NextResponse.json(
      { error: "Podaj co najmniej jedno słowo kluczowe i jedną lokalizację" },
      { status: 400 }
    );
  }

  // Cel kontaktu (Feature 2) — wybrany dla całej paczki, dziedziczą go leady.
  const contactPurpose = (body.contact_purpose ?? "").trim() || null;

  // Kategoria (Feature 1) — rozstrzygamy każde słowo kluczowe z mapowania
  // category_keywords. UI wymusza zmapowanie wszystkich słów przed startem, ale
  // gdyby jakieś było nieznane, zostaje null (widoczne jako „bez kategorii”).
  // Mapowanie trzyma słowa kluczowe pisane małymi literami — dopasowujemy po
  // wersji lowercase, zachowując oryginalną pisownię słowa dla samego scrapera.
  const { data: mappings } = await supabase
    .from("category_keywords")
    .select("keyword, category_key")
    .in("keyword", keywords.map((k) => k.toLowerCase()));
  const categoryByKeyword = new Map<string, string>();
  for (const m of (mappings as { keyword: string; category_key: string }[] | null) ?? []) {
    categoryByKeyword.set(m.keyword, m.category_key);
  }

  const batchId = crypto.randomUUID();
  const rows = keywords.flatMap((keyword) =>
    locations.map((location) => ({
      owner: user.id,
      keyword,
      location,
      batch_id: batchId,
      category: categoryByKeyword.get(keyword.toLowerCase()) ?? null,
      contact_purpose: contactPurpose,
    }))
  );

  // Najpierw paczka — jej wiersz jest nośnikiem statusu (running/paused/stopped/
  // completed) i metadanych nagłówka pokazywanych w zwiniętym wierszu UI.
  const { error: batchErr } = await supabase.from("scrape_batches").insert({
    id: batchId,
    owner: user.id,
    keywords,
    locations,
    total_jobs: rows.length,
    status: "running",
    contact_purpose: contactPurpose,
  });
  if (batchErr) {
    console.error("[scraper/start] Nie udało się utworzyć paczki", batchErr);
    return NextResponse.json({ error: "Nie udało się utworzyć zadań" }, { status: 500 });
  }

  const { data: jobs, error: insertErr } = await supabase
    .from("scrape_jobs")
    .insert(rows)
    .select("id");
  if (insertErr || !jobs) {
    console.error("[scraper/start]", insertErr);
    // Sprzątamy pustą paczkę, żeby nie wisiała w historii bez zadań.
    await supabase.from("scrape_batches").delete().eq("id", batchId);
    return NextResponse.json({ error: "Nie udało się utworzyć zadań" }, { status: 500 });
  }

  const jobIds = jobs.map((j) => j.id as string);

  const result = await dispatchScrapeJobs(supabase, batchId, jobIds);

  return NextResponse.json({
    batch_id: batchId,
    job_ids: jobIds,
    ...(result.warning ? { warning: result.warning } : {}),
  });
}
