// app/api/prospecting/import/route.ts
// Przyjmuje partię leadów z Google Maps od zewnętrznego scrapera (Cloud Run).
// Auth: nagłówek X-API-Key == SCRAPER_IMPORT_KEY. Działa na service_role
// (omija RLS), więc trzyma się WYŁĄCZNIE serwera.
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { checkScraperApiKey } from "@/lib/prospectingAuth";

type ImportRow = {
  place_id: string;
  name: string;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  rating?: number | null;
  review_count?: number | null;
  business_status?: string | null;
  industry?: string | null;
  city?: string | null;
  // Aliasy nowszej wersji scrapera (Google Maps lead-scoring) — równoważne
  // industry/city, przyjmowane opcjonalnie obok starych nazw pól.
  category?: string | null;
  location?: string | null;
  lead_score?: number | null;
  priority_score?: number | null;
  lead_score_breakdown?: Record<string, unknown> | null;
  priority_label?: string | null;
  score_reasons?: string[] | null;
  website_status?: string | null;
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
  if (rows.some((r) => !r.place_id || !r.name)) {
    return NextResponse.json({ error: "Każdy lead musi mieć place_id i name" }, { status: 400 });
  }

  const db = createSupabaseAdmin();

  // Solo-admin: wszystkie dane należą do jedynego konta w auth.users.
  const { data: usersRes, error: usersErr } = await db.auth.admin.listUsers();
  const owner = usersRes?.users?.[0]?.id;
  if (usersErr || !owner) {
    console.error("[prospecting/import] Nie znaleziono właściciela", usersErr);
    return NextResponse.json({ error: "Błąd serwera" }, { status: 500 });
  }

  const placeIds = rows.map((r) => r.place_id);
  const { data: existing } = await db
    .from("prospects")
    .select("place_id")
    .in("place_id", placeIds);
  const existingSet = new Set((existing ?? []).map((p) => p.place_id));

  // Tylko „twarde” pola scrapera — celowo NIE wysyłamy prospecting_status/
  // note/last_contact_attempt_at, więc upsert ich nie nadpisze (ustawiane
  // ręcznie w CRM). Na insert prospecting_status dostaje wartość domyślną 'new'.
  const upsertRows = rows.map((r) => ({
    owner,
    place_id: r.place_id,
    name: r.name,
    phone: r.phone ?? null,
    website: r.website ?? null,
    address: r.address ?? null,
    rating: r.rating ?? null,
    review_count: r.review_count ?? null,
    business_status: r.business_status ?? null,
    industry: r.industry ?? r.category ?? null,
    city: r.city ?? r.location ?? null,
    lead_score: r.lead_score ?? r.priority_score ?? null,
    lead_score_breakdown: r.lead_score_breakdown ?? null,
    priority_label: r.priority_label ?? null,
    score_reasons: r.score_reasons ?? null,
    website_status: r.website_status ?? null,
    website_last_checked_at: r.website_status !== undefined ? new Date().toISOString() : undefined,
  }));

  const { error } = await db.from("prospects").upsert(upsertRows, { onConflict: "place_id" });
  if (error) {
    console.error("[prospecting/import]", error);
    return NextResponse.json({ error: "Błąd zapisu" }, { status: 500 });
  }

  const added = placeIds.filter((id) => !existingSet.has(id)).length;
  const updated = placeIds.length - added;
  return NextResponse.json({ added, updated });
}
