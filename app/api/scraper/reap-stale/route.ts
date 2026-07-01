// app/api/scraper/reap-stale/route.ts
// Watchdog: zadania scrapowania, które utknęły w "pending"/"running", oznaczamy
// jako "error" z czytelnym komunikatem — zamiast zostawiać je w nieskończoność
// bez żadnego sygnału dla użytkownika.
//
// DLACZEGO PO STRONIE CRM, a nie w backendzie scrapera: backend (Cloud Run)
// robi scraping w tle po odpowiedzi 202. Jeśli instancja zostanie uśpiona
// (throttling CPU bez „CPU always allocated”) albo webhook nigdy nie dotarł,
// żaden kod w backendzie się nie wykona i zadanie utknie. CRM na Vercel jest
// wołany niezawodnie przy każdym wejściu w zakładkę Scraper, więc to on jest
// pewnym miejscem na taki bezpiecznik. Zapis idzie przez klienta z RLS
// (auth.uid() = owner), więc użytkownik może ruszyć tylko własne zadania.
//
// WAŻNE (duże paczki): backend przetwarza zadania z jednej paczki SEKWENCYJNIE.
// W dużej paczce późniejsze zadania siedzą w "pending" (liczone od created_at)
// nawet długo, choć backend do nich dojdzie. Dlatego "pending" ubijamy tylko,
// gdy CAŁA paczka nie robi postępu (brak zadania "running" i żadne nie zakończyło
// się w ostatnich STALE_MINUTES). Zadanie "running" powyżej limitu jest ubijane
// wprost — pojedyncze zadanie keyword×location realnie trwa ~1–2 min.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

const STALE_MINUTES = 10;

const STALE_MESSAGE =
  `Zadanie przekroczyło limit czasu (${STALE_MINUTES} min) i zostało oznaczone jako błąd. ` +
  "Najczęstsza przyczyna: backend scrapera (Cloud Run) nie odebrał zlecenia lub został " +
  "uśpiony w trakcie pracy. Sprawdź, czy usługa webhooka działa z opcją „CPU always " +
  "allocated”, i spróbuj ponownie.";

type JobRow = {
  id: string;
  batch_id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export async function POST() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const cutoff = Date.now() - STALE_MINUTES * 60_000;
  const cutoffIso = new Date(cutoff).toISOString();
  const nowIso = new Date().toISOString();
  const errUpdate = { status: "error", error_message: STALE_MESSAGE, completed_at: nowIso, current_step: null };

  // Kandydaci: własne zadania wciąż niezakończone (pending/running). Paczka jako
  // całość jest potrzebna do oceny postępu, więc pobieramy wszystkie zadania
  // z paczek, które mają jakiegokolwiek kandydata.
  const { data: openJobs } = await supabase
    .from("scrape_jobs")
    .select("id, batch_id, status, created_at, started_at, completed_at")
    .in("status", ["pending", "running", "done", "error"])
    .order("created_at", { ascending: false })
    .limit(1000);

  const jobs = (openJobs as JobRow[] | null) ?? [];
  const toReap = new Set<string>();

  // 1. "running" ponad limit — mierzone od started_at (fallback created_at).
  for (const j of jobs) {
    if (j.status !== "running") continue;
    const ref = j.started_at ?? j.created_at;
    if (new Date(ref).getTime() < cutoff) toReap.add(j.id);
  }

  // 2. "pending" — tylko gdy cała paczka nie robi postępu.
  const byBatch = new Map<string, JobRow[]>();
  for (const j of jobs) {
    const arr = byBatch.get(j.batch_id);
    if (arr) arr.push(j);
    else byBatch.set(j.batch_id, [j]);
  }
  for (const [, list] of byBatch) {
    const oldPending = list.filter(
      (j) => j.status === "pending" && new Date(j.created_at).getTime() < cutoff
    );
    if (oldPending.length === 0) continue;

    const batchActive = list.some(
      (j) =>
        // wciąż działa (a nie zostało dopiero co zakwalifikowane do ubicia)…
        (j.status === "running" && !toReap.has(j.id)) ||
        // …albo coś zakończyło się niedawno → backend robi postęp.
        (j.completed_at != null && new Date(j.completed_at).getTime() >= cutoff)
    );
    if (batchActive) continue;

    for (const j of oldPending) toReap.add(j.id);
  }

  if (toReap.size === 0) return NextResponse.json({ reaped: 0 });

  const ids = [...toReap];
  const { data: updated } = await supabase
    .from("scrape_jobs")
    .update(errUpdate)
    // Ponów warunek statusu przy zapisie: gdyby backend właśnie zmienił status
    // na running/done między odczytem a zapisem, NIE nadpisujemy go błędem.
    .in("id", ids)
    .in("status", ["pending", "running"])
    .lt("created_at", cutoffIso)
    .select("id");

  return NextResponse.json({ reaped: updated?.length ?? 0 });
}
