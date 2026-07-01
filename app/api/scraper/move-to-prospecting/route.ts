// app/api/scraper/move-to-prospecting/route.ts
// "Przenieś do Prospectingu": kopiuje zaznaczone scraped_leads do prospects,
// respektując dedup po place_id. Zasada (celowa, nieautomatyczna): jeśli
// place_id JUŻ istnieje w prospects, NIE nadpisujemy go — oznaczamy wiersz
// scraped_leads jako 'duplicate' do ręcznego przeglądu (zakładka Duplikaty),
// zamiast cichej aktualizacji. scraped_leads nigdy nie jest usuwane — to
// trwała historia scrapowania.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { ScrapedLead, WebsiteStatus } from "@/lib/types";

const WEBSITE_STATUS_MAP: Record<string, WebsiteStatus> = {
  brak: "none",
  dziala: "active",
  nie_dziala: "broken",
};

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  let body: { scraped_lead_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  const ids = [...new Set(body.scraped_lead_ids ?? [])];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Nie wybrano żadnych leadów" }, { status: 400 });
  }

  const { data: leadsData, error: leadsErr } = await supabase
    .from("scraped_leads")
    .select("*")
    .in("id", ids)
    .eq("status", "new");
  if (leadsErr) {
    console.error("[scraper/move-to-prospecting]", leadsErr);
    return NextResponse.json({ error: "Nie udało się wczytać leadów" }, { status: 500 });
  }
  const leads = (leadsData ?? []) as ScrapedLead[];

  const placeIds = leads.map((l) => l.place_id);
  const { data: existingData } = await supabase
    .from("prospects")
    .select("place_id")
    .in("place_id", placeIds.length > 0 ? placeIds : [""]);
  const existingSet = new Set((existingData ?? []).map((p) => p.place_id as string));

  let moved = 0;
  let duplicates = 0;
  const errors: { id: string; error: string }[] = [];

  for (const lead of leads) {
    if (existingSet.has(lead.place_id)) {
      const { error } = await supabase
        .from("scraped_leads")
        .update({ status: "duplicate" })
        .eq("id", lead.id);
      if (error) {
        errors.push({ id: lead.id, error: error.message });
      } else {
        duplicates++;
      }
      continue;
    }

    const { data: prospect, error: insertErr } = await supabase
      .from("prospects")
      .insert({
        owner: user.id,
        place_id: lead.place_id,
        name: lead.business_name,
        phone: lead.phone,
        website: lead.website,
        address: lead.address,
        rating: lead.rating,
        review_count: lead.review_count,
        business_status: lead.business_status,
        industry: lead.source_keyword,
        city: lead.source_location,
        source: "google_maps_scraper",
        lead_score: lead.score,
        lead_score_breakdown: lead.score_breakdown,
        website_status: lead.website_status ? WEBSITE_STATUS_MAP[lead.website_status] ?? null : null,
        website_last_checked_at: lead.website_status ? lead.scraped_at : null,
      })
      .select("id")
      .single();

    if (insertErr || !prospect) {
      console.error("[scraper/move-to-prospecting]", lead.id, insertErr);
      errors.push({ id: lead.id, error: insertErr?.message ?? "Błąd zapisu" });
      continue;
    }

    // Zapobiega wyścigowi: gdyby ten sam place_id pojawił się dwa razy w tym
    // samym batchu (dwa różne zadania trafiły na tę samą firmę).
    existingSet.add(lead.place_id);

    const { error: updateErr } = await supabase
      .from("scraped_leads")
      .update({ status: "moved", moved_to_prospect_id: prospect.id })
      .eq("id", lead.id);
    if (updateErr) {
      errors.push({ id: lead.id, error: updateErr.message });
      continue;
    }
    moved++;
  }

  return NextResponse.json({ moved, duplicates, errors });
}
