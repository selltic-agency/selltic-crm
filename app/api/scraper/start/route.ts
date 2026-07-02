// app/api/scraper/start/route.ts
// Wywoływane z zakładki "Scraper" (zalogowany user, RLS po owner). Generuje
// zadania scrape_jobs jako iloczyn kartezjański keywords × locations, po czym
// woła webhook Cloud Run z SAMYMI job_id (nigdy z danymi leadów — te zapisuje
// bezpośrednio do Supabase headless backend na Cloud Run).
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

// Cloud Run może mieć min-instances=0 → pierwszy webhook po bezczynności
// wywołuje zimny start (kilka–kilkanaście s). Domyślny limit czasu funkcji
// Vercel (10 s na Hobby) potrafi ubić żądanie w trakcie tego oczekiwania, ZANIM
// wykona się nasza obsługa błędu — zadania zostają wtedy w "pending" bez śladu.
// Podnosimy limit funkcji, żeby to MY kontrolowali timeout (patrz WEBHOOK_TIMEOUT_MS).
export const maxDuration = 60;

// Twardy limit czasu na uścisk dłoni z webhookiem. Hojny, by przetrwać zimny
// start Cloud Run, ale krótszy niż maxDuration — dzięki temu przy zawieszeniu
// przerywamy sami (AbortError) i logujemy to, zamiast dać platformie ubić funkcję.
const WEBHOOK_TIMEOUT_MS = 45_000;

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  let body: { keywords?: string[]; locations?: string[] };
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

  const batchId = crypto.randomUUID();
  const rows = keywords.flatMap((keyword) =>
    locations.map((location) => ({ owner: user.id, keyword, location, batch_id: batchId }))
  );

  const { data: jobs, error: insertErr } = await supabase
    .from("scrape_jobs")
    .insert(rows)
    .select("id");
  if (insertErr || !jobs) {
    console.error("[scraper/start]", insertErr);
    return NextResponse.json({ error: "Nie udało się utworzyć zadań" }, { status: 500 });
  }

  const jobIds = jobs.map((j) => j.id as string);

  const webhookUrl = process.env.SCRAPER_WEBHOOK_URL;
  const webhookSecret = process.env.SCRAPER_WEBHOOK_SECRET;
  if (!webhookUrl || !webhookSecret) {
    console.error("[scraper/start] Brak SCRAPER_WEBHOOK_URL/SCRAPER_WEBHOOK_SECRET — zadania utworzone, ale webhook nie wywołany.");
    return NextResponse.json({
      batch_id: batchId,
      job_ids: jobIds,
      warning: "Webhook scrapera nieskonfigurowany — zadania czekają jako 'pending'.",
    });
  }

  // Loguj KAŻDĄ próbę wywołania webhooka (sukces i porażka) — w logach Vercel
  // musi być widać, czy dla danej paczki żądanie w ogóle poszło i co odpowiedziało.
  const target = `${webhookUrl.replace(/\/$/, "")}/webhook/scrape`;
  const startedAt = Date.now();
  console.log(
    `[scraper/start] Wywołuję webhook batch=${batchId} jobs=${jobIds.length} → POST ${target}`
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const resp = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${webhookSecret}` },
      body: JSON.stringify({ batch_id: batchId, job_ids: jobIds }),
      signal: controller.signal,
    });
    const text = await resp.text();
    const ms = Date.now() - startedAt;
    // Zawsze logujemy status + treść odpowiedzi (przycięte), żeby dało się w
    // Vercel prześledzić, co dokładnie zwrócił backend dla tej paczki.
    console.log(
      `[scraper/start] Webhook batch=${batchId} → HTTP ${resp.status} w ${ms}ms; body=${text.slice(0, 500)}`
    );
    if (!resp.ok) {
      console.error("[scraper/start] Webhook odpowiedział błędem", resp.status, text);
      // Definitywne odrzucenie: webhook był osiągalny, ale nie zaplanował pracy
      // (np. 401 zły sekret, 400 zła treść, 5xx). Zadania NIE ruszą same, więc
      // oznaczamy je od razu jako "error" z czytelnym komunikatem, zamiast
      // zostawiać w "pending" bez sygnału. (Gdyby backend jednak wystartował,
      // nadpisze status na running/done — pisze wartości absolutne po id.)
      await supabase
        .from("scrape_jobs")
        .update({
          status: "error",
          error_message: `Backend scrapera odrzucił zlecenie (HTTP ${resp.status}). Sprawdź konfigurację usługi webhooka (adres, sekret) i spróbuj ponownie.`,
          completed_at: new Date().toISOString(),
        })
        .in("id", jobIds);
      return NextResponse.json({
        batch_id: batchId,
        job_ids: jobIds,
        warning: `Webhook scrapera odpowiedział błędem ${resp.status}. Zadania oznaczono jako błąd.`,
      });
    }
  } catch (e) {
    const ms = Date.now() - startedAt;
    const isTimeout = e instanceof Error && e.name === "AbortError";
    // Celowo NIE oznaczamy zadań jako "error": timeout/zerwane połączenie NIE
    // oznacza, że backend nie odebrał zlecenia — przy zimnym starcie Cloud Run
    // mógł przyjąć POST i ruszyć w tle mimo że my przerwaliśmy czekanie. Jeśli
    // faktycznie ruszył, nadpisze status na running/done. Jeśli nie — zabezpiecza
    // watchdog (/api/scraper/reap-stale), który po limicie czasu oznaczy je błędem.
    console.error(
      `[scraper/start] Webhook batch=${batchId} nieudany po ${ms}ms (${isTimeout ? "TIMEOUT/abort" : "błąd sieci"}):`,
      e
    );
    return NextResponse.json({
      batch_id: batchId,
      job_ids: jobIds,
      warning: isTimeout
        ? "Backend scrapera nie odpowiedział w wyznaczonym czasie (możliwy zimny start). Zadania czekają jako 'pending' — jeśli backend je odebrał, ruszą; w przeciwnym razie zostaną oznaczone jako błąd po upływie limitu czasu."
        : "Nie udało się połączyć z webhookiem scrapera. Zadania zostały utworzone jako 'pending'.",
    });
  } finally {
    clearTimeout(timeout);
  }

  return NextResponse.json({ batch_id: batchId, job_ids: jobIds });
}
