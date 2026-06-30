// app/api/prospecting/existing-ids/route.ts
// Pozwala scraperowi sprawdzić, które place_id już istnieją w CRM przed
// pobraniem szczegółów z Google Places (oszczędza limity API).
// Auth: nagłówek X-API-Key == SCRAPER_IMPORT_KEY.
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { checkScraperApiKey } from "@/lib/prospectingAuth";

export async function GET(req: Request) {
  const authError = checkScraperApiKey(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const raw = url.searchParams.get("place_ids") ?? "";
  const placeIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (placeIds.length === 0) {
    return NextResponse.json({ existing: [] });
  }

  const db = createSupabaseAdmin();
  const { data, error } = await db.from("prospects").select("place_id").in("place_id", placeIds);
  if (error) {
    console.error("[prospecting/existing-ids]", error);
    return NextResponse.json({ error: "Błąd serwera" }, { status: 500 });
  }

  return NextResponse.json({ existing: (data ?? []).map((p) => p.place_id) });
}
