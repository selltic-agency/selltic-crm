// app/api/scraper/start/route.ts
// Wywoływane z zakładki "Scraper" (zalogowany user, RLS po owner). Generuje
// zadania scrape_jobs jako iloczyn kartezjański keywords × locations, po czym
// woła webhook Cloud Run z SAMYMI job_id (nigdy z danymi leadów — te zapisuje
// bezpośrednio do Supabase headless backend na Cloud Run).
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

  try {
    const resp = await fetch(`${webhookUrl.replace(/\/$/, "")}/webhook/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${webhookSecret}` },
      body: JSON.stringify({ batch_id: batchId, job_ids: jobIds }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("[scraper/start] Webhook odpowiedział błędem", resp.status, text);
      return NextResponse.json({
        batch_id: batchId,
        job_ids: jobIds,
        warning: `Webhook scrapera odpowiedział błędem ${resp.status}.`,
      });
    }
  } catch (e) {
    console.error("[scraper/start] Nie udało się połączyć z webhookiem", e);
    return NextResponse.json({
      batch_id: batchId,
      job_ids: jobIds,
      warning: "Nie udało się połączyć z webhookiem scrapera. Zadania zostały utworzone jako 'pending'.",
    });
  }

  return NextResponse.json({ batch_id: batchId, job_ids: jobIds });
}
