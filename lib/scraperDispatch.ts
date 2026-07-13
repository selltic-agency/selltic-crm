// lib/scraperDispatch.ts — wspólna logika wywołania webhooka Cloud Run z listą
// job_id do przetworzenia. Używana przez /api/scraper/start (nowa paczka) oraz
// /api/scraper/resume (wznowienie — dosyła pozostałe zadania 'pending').
//
// Backend (webhook_server.py) przetwarza zadania w pętli i sprawdza status
// paczki (scrape_batches.status) PRZED każdym zadaniem, więc bezpiecznie jest
// dosłać te same job_id ponownie — anulowane/zakończone i tak zostaną odrzucone
// po stronie backendu (akceptuje tylko 'pending').
import type { SupabaseClient } from "@supabase/supabase-js";

// Cloud Run może mieć min-instances=0 → pierwszy webhook po bezczynności
// wywołuje zimny start. Dajemy sobie hojny, ale własny limit (krótszy niż
// maxDuration funkcji), żeby przy zawieszeniu przerwać samodzielnie i zalogować.
const WEBHOOK_TIMEOUT_MS = 45_000;

export type DispatchResult = {
  ok: boolean;
  warning?: string;
};

/**
 * Woła POST {SCRAPER_WEBHOOK_URL}/webhook/scrape z {batch_id, job_ids}.
 * Loguje każdą próbę (Vercel). Przy definitywnym odrzuceniu (HTTP błąd)
 * oznacza podane zadania jako 'error'. Timeout/błąd sieci NIE oznacza błędu —
 * backend mógł przyjąć zlecenie mimo zerwanego połączenia (watchdog dosprząta).
 */
export async function dispatchScrapeJobs(
  supabase: SupabaseClient,
  batchId: string,
  jobIds: string[]
): Promise<DispatchResult> {
  const webhookUrl = process.env.SCRAPER_WEBHOOK_URL;
  const webhookSecret = process.env.SCRAPER_WEBHOOK_SECRET;
  if (!webhookUrl || !webhookSecret) {
    console.error(
      "[scraperDispatch] Brak SCRAPER_WEBHOOK_URL/SCRAPER_WEBHOOK_SECRET — zadania czekają jako 'pending'."
    );
    return {
      ok: false,
      warning: "Webhook scrapera nieskonfigurowany — zadania czekają jako 'pending'.",
    };
  }

  const target = `${webhookUrl.replace(/\/$/, "")}/webhook/scrape`;
  const startedAt = Date.now();
  console.log(
    `[scraperDispatch] Wywołuję webhook batch=${batchId} jobs=${jobIds.length} → POST ${target}`
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
    console.log(
      `[scraperDispatch] Webhook batch=${batchId} → HTTP ${resp.status} w ${ms}ms; body=${text.slice(0, 500)}`
    );
    if (!resp.ok) {
      console.error("[scraperDispatch] Webhook odpowiedział błędem", resp.status, text);
      await supabase
        .from("scrape_jobs")
        .update({
          status: "error",
          error_message: `Backend scrapera odrzucił zlecenie (HTTP ${resp.status}). Sprawdź konfigurację usługi webhooka (adres, sekret) i spróbuj ponownie.`,
          completed_at: new Date().toISOString(),
        })
        .in("id", jobIds)
        .eq("status", "pending");
      return {
        ok: false,
        warning: `Webhook scrapera odpowiedział błędem ${resp.status}. Zadania oznaczono jako błąd.`,
      };
    }
    return { ok: true };
  } catch (e) {
    const ms = Date.now() - startedAt;
    const isTimeout = e instanceof Error && e.name === "AbortError";
    console.error(
      `[scraperDispatch] Webhook batch=${batchId} nieudany po ${ms}ms (${isTimeout ? "TIMEOUT/abort" : "błąd sieci"}):`,
      e
    );
    return {
      ok: false,
      warning: isTimeout
        ? "Backend scrapera nie odpowiedział w wyznaczonym czasie (możliwy zimny start). Zadania czekają jako 'pending' — jeśli backend je odebrał, ruszą; w przeciwnym razie zostaną oznaczone jako błąd po upływie limitu czasu."
        : "Nie udało się połączyć z webhookiem scrapera. Zadania zostały utworzone jako 'pending'.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
