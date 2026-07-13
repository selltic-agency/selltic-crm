// app/api/scraper/reap-stale/route.ts
// Watchdog: zadania scrapowania, które utknęły w "pending"/"running", oznaczamy
// jako "error" z czytelnym komunikatem — zamiast zostawiać je w nieskończoność
// bez żadnego sygnału dla użytkownika. Dodatkowo domykamy paczki (scrape_batches)
// do statusu 'completed', gdy wszystkie ich zadania są już terminalne.
//
// DLACZEGO PO STRONIE CRM, a nie w backendzie scrapera: backend (Cloud Run)
// robi scraping w tle po odpowiedzi 202. Jeśli instancja zostanie uśpiona
// (throttling CPU bez „CPU always allocated”) albo webhook nigdy nie dotarł,
// żaden kod w backendzie się nie wykona i zadanie utknie. CRM na Vercel jest
// wołany niezawodnie przy każdym wejściu w zakładkę Scraper, więc to on jest
// pewnym miejscem na taki bezpiecznik.
//
// WAŻNE (pauza): paczka wstrzymana (status 'paused') CELOWO trzyma zadania w
// 'pending' — NIE wolno ich reapować. Podobnie 'stopped' (pozostałe pending są
// tam już anulowane). Reapujemy tylko paczki wciąż 'running'.
//
// WAŻNE (duże paczki): backend przetwarza zadania z jednej paczki SEKWENCYJNIE.
// W dużej paczce późniejsze zadania siedzą w "pending" długo, choć backend do
// nich dojdzie. Dlatego "pending" ubijamy tylko, gdy CAŁA paczka nie robi
// postępu (brak zadania "running" i żadne nie zakończyło się w ostatnich
// STALE_MINUTES). Zadanie "running" powyżej limitu ubijamy wprost.
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

const TERMINAL = new Set(["done", "error", "canceled"]);

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

  const { data: openJobs } = await supabase
    .from("scrape_jobs")
    .select("id, batch_id, status, created_at, started_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(2000);

  const jobs = (openJobs as JobRow[] | null) ?? [];

  // Statusy paczek — potrzebne, by NIE reapować paczek wstrzymanych/zatrzymanych
  // i by domknąć paczki, których wszystkie zadania są już terminalne.
  const batchIds = [...new Set(jobs.map((j) => j.batch_id))];
  const batchStatus = new Map<string, { status: string; total_jobs: number }>();
  if (batchIds.length > 0) {
    const { data: batches } = await supabase
      .from("scrape_batches")
      .select("id, status, total_jobs")
      .in("id", batchIds);
    for (const b of (batches as { id: string; status: string; total_jobs: number }[] | null) ?? []) {
      batchStatus.set(b.id, { status: b.status, total_jobs: b.total_jobs });
    }
  }

  const isFrozenBatch = (batchId: string) => {
    const s = batchStatus.get(batchId)?.status;
    return s === "paused" || s === "stopped";
  };

  const toReap = new Set<string>();

  // 1. "running" ponad limit — mierzone od started_at (fallback created_at).
  //    Pomijamy paczki wstrzymane/zatrzymane (tam praca jest celowo wygaszana).
  for (const j of jobs) {
    if (j.status !== "running" || isFrozenBatch(j.batch_id)) continue;
    const ref = j.started_at ?? j.created_at;
    if (new Date(ref).getTime() < cutoff) toReap.add(j.id);
  }

  // 2. "pending" — tylko gdy cała paczka (running) nie robi postępu.
  const byBatch = new Map<string, JobRow[]>();
  for (const j of jobs) {
    const arr = byBatch.get(j.batch_id);
    if (arr) arr.push(j);
    else byBatch.set(j.batch_id, [j]);
  }
  for (const [bid, list] of byBatch) {
    if (isFrozenBatch(bid)) continue; // paused/stopped: pending zostaje/anulowane osobno
    const oldPending = list.filter(
      (j) => j.status === "pending" && new Date(j.created_at).getTime() < cutoff
    );
    if (oldPending.length === 0) continue;

    const batchActive = list.some(
      (j) =>
        (j.status === "running" && !toReap.has(j.id)) ||
        (j.completed_at != null && new Date(j.completed_at).getTime() >= cutoff)
    );
    if (batchActive) continue;

    for (const j of oldPending) toReap.add(j.id);
  }

  let reaped = 0;
  if (toReap.size > 0) {
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
    reaped = updated?.length ?? 0;
  }

  // 3. Domknij paczki 'running', których wszystkie zadania są już terminalne
  //    (done/error/canceled). Pokrywa normalne zakończenie oraz przypadek, gdy
  //    backend padł przed ustawieniem 'completed'. Wymagamy, by liczba zadań
  //    terminalnych pokrywała total_jobs paczki — inaczej nie mamy pewności, że
  //    widzimy wszystkie zadania (limit odczytu).
  const toComplete: string[] = [];
  for (const [bid, list] of byBatch) {
    const meta = batchStatus.get(bid);
    if (!meta || meta.status !== "running") continue;
    const terminal = list.filter((j) => TERMINAL.has(j.status) || toReap.has(j.id));
    if (terminal.length >= meta.total_jobs && terminal.length === list.length) {
      toComplete.push(bid);
    }
  }
  if (toComplete.length > 0) {
    await supabase
      .from("scrape_batches")
      .update({ status: "completed", updated_at: nowIso })
      .in("id", toComplete)
      .eq("status", "running");
  }

  return NextResponse.json({ reaped, completed: toComplete.length });
}
