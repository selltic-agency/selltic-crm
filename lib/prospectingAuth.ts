// lib/prospectingAuth.ts — autoryzacja endpointów wołanych przez zewnętrzny
// scraper (Google Maps, Cloud Run) nagłówkiem X-API-Key, na wzór CRON_SECRET
// z app/api/cron/reminders/route.ts.
import { NextResponse } from "next/server";

export function checkScraperApiKey(req: Request): NextResponse | null {
  const key = process.env.SCRAPER_IMPORT_KEY;
  if (!key) {
    console.error("[prospecting] Brak SCRAPER_IMPORT_KEY — endpoint zablokowany.");
    return NextResponse.json({ error: "Endpoint nieskonfigurowany" }, { status: 503 });
  }
  if (req.headers.get("x-api-key") !== key) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  return null;
}
