// app/api/prospecting/import/route.ts
// Przyjmuje partię leadów z Google Maps od zewnętrznego scrapera (Cloud Run).
// Auth: nagłówek X-API-Key == SCRAPER_IMPORT_KEY. Działa na service_role
// (omija RLS), więc trzyma się WYŁĄCZNIE serwera.
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { checkScraperApiKey } from "@/lib/prospectingAuth";

type ImportRow = {
  place_id?: string | null;
  name?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  rating?: number | null;
  review_count?: number | null;
  business_status?: string | null;
  category?: string | null;
  industry?: string | null; // alias legacy dla category
  city?: string | null;
  google_maps_url?: string | null;
  priority_score?: number | null;
  lead_score?: number | null; // alias legacy dla priority_score
  priority_label?: string | null;
  website_status?: string | null;
  score_reasons?: string[] | null;
  lead_score_breakdown?: Record<string, unknown> | null;
};

type ImportResult = {
  place_id: string;
  name: string;
  status: "created" | "updated" | "error";
  error?: string;
};

export async function POST(req: Request) {
  const authError = checkScraperApiKey(req);
  if (authError) return authError;

  let rows: ImportRow[];
  try {
    rows = await req.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "Oczekiwano tablicy leadów" }, { status: 400 });
  }

  const db = createSupabaseAdmin();

  // Solo-admin: wszystkie dane należą do jedynego konta w auth.users.
  const { data: usersRes, error: usersErr } = await db.auth.admin.listUsers();
  const owner = usersRes?.users?.[0]?.id;
  if (usersErr || !owner) {
    console.error("[prospecting/import] Nie znaleziono właściciela", usersErr);
    return NextResponse.json({ error: "Błąd serwera" }, { status: 500 });
  }

  const validPlaceIds = rows.map((r) => r.place_id).filter((id): id is string => !!id);
  const { data: existing } = await db
    .from("prospects")
    .select("place_id")
    .in("place_id", validPlaceIds.length > 0 ? validPlaceIds : [""]);
  const existingSet = new Set((existing ?? []).map((p) => p.place_id));

  // Przetwarzamy każdy wiersz osobno — błąd jednego leada nie może
  // przerwać całej partii.
  const results: ImportResult[] = [];
  for (const r of rows) {
    const placeId = r.place_id ?? "";
    const name = r.name ?? "";
    if (!placeId || !name) {
      results.push({ place_id: placeId, name, status: "error", error: "Brak wymaganego pola place_id lub name" });
      continue;
    }

    const isNew = !existingSet.has(placeId);

    const props: Record<string, unknown> = {};
    if (r.google_maps_url != null) props.google_maps_url = r.google_maps_url;
    if (r.priority_label != null) props.priority_label = r.priority_label;
    if (r.score_reasons != null) props.score_reasons = r.score_reasons;

    // Tylko „twarde” pola scrapera — celowo NIE wysyłamy prospecting_status/
    // note/last_contact_attempt_at, więc upsert ich nie nadpisze (ustawiane
    // ręcznie w CRM). Na insert prospecting_status dostaje wartość domyślną 'new'.
    const upsertRow = {
      owner,
      place_id: placeId,
      name,
      phone: r.phone ?? null,
      website: r.website ?? null,
      address: r.address ?? null,
      rating: r.rating ?? null,
      review_count: r.review_count ?? null,
      business_status: r.business_status ?? null,
      industry: r.category ?? r.industry ?? null,
      city: r.city ?? null,
      lead_score: r.priority_score ?? r.lead_score ?? null,
      lead_score_breakdown: r.lead_score_breakdown ?? null,
      website_status: r.website_status ?? null,
      website_last_checked_at: r.website_status != null ? new Date().toISOString() : undefined,
      props,
    };

    const { error } = await db.from("prospects").upsert(upsertRow, { onConflict: "place_id" });
    if (error) {
      console.error("[prospecting/import]", placeId, error);
      results.push({ place_id: placeId, name, status: "error", error: error.message });
      continue;
    }
    results.push({ place_id: placeId, name, status: isNew ? "created" : "updated" });
  }

  return NextResponse.json(results);
}
