// app/api/cron/meta-lead-events/route.ts — ponowienie nieudanych wysyłek
// zdarzeń jakości leada do Meta (Conversions API dla CRM).
//
// Dlaczego osobny job: zmiana etapu w CRM nie może czekać na Graph API, więc
// wysyłka jest fire-and-forget. Gdy Meta akurat nie odpowie, wiersz zostaje
// w meta_lead_events z ok=false — ten endpoint jest jego kolejką ponowień.
// Dedup po stronie Meta (event_id = "<lead_id>:<event_name>") sprawia, że
// ponowienie jest bezpieczne nawet gdy poprzednia próba jednak doszła.
//
// Harmonogram: plan Vercel Hobby dopuszcza cron tylko raz dziennie, dlatego
// kadencję godzinową realizuje GitHub Actions
// (.github/workflows/meta-lead-events.yml) — wzorzec jak abandon-sessions.
//
// Ochrona: Authorization: Bearer <CRON_SECRET> (jak pozostałe crony).
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { retryPendingCrmEvents } from "@/lib/server/metaCrm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[cron/meta-lead-events] Brak CRON_SECRET — endpoint zablokowany.");
    return NextResponse.json({ error: "Cron nie skonfigurowany" }, { status: 503 });
  }

  try {
    const { retried, ok } = await retryPendingCrmEvents(createSupabaseAdmin());
    return NextResponse.json({ ok: true, retried, sent: ok });
  } catch (e) {
    console.error("[cron/meta-lead-events]", e);
    return NextResponse.json({ error: "Błąd serwera" }, { status: 500 });
  }
}
