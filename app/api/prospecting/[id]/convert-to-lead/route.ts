// app/api/prospecting/[id]/convert-to-lead/route.ts
// Tworzy deal na podstawie prospektu (zalogowany user, RLS po owner) i
// oznacza prospekt jako skonwertowany.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { Prospect } from "@/lib/types";
import { CONTACT_SOURCE_KEY, ensureContactSourceDef } from "@/lib/contactSource";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  // Opcjonalne parametry z modala konwersji: docelowy etap lejka (dowolny,
  // zdefiniowany przez użytkownika), źródło kontaktu, nazwa i wartość deala.
  let body: { stage?: string; contact_source?: string; name?: string; value?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* brak body (stare wywołania) — zostają domyślne */
  }

  const { data: prospect, error: pErr } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", id)
    .single();
  if (pErr || !prospect) {
    return NextResponse.json({ error: "Nie znaleziono prospektu" }, { status: 404 });
  }
  const p = prospect as Prospect;

  if (p.prospecting_status !== "new" && p.prospecting_status !== "contact_attempted") {
    return NextResponse.json({ error: "Ten prospekt nie może zostać skonwertowany" }, { status: 400 });
  }

  const { data: firstStage } = await supabase
    .from("pipeline_stages")
    .select("key")
    .eq("owner", user.id)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Etap z modala (walidowany po kluczach etapów właściciela); fallback: pierwszy.
  let targetStage = firstStage?.key ?? "new";
  if (body.stage) {
    const { data: match } = await supabase
      .from("pipeline_stages")
      .select("key")
      .eq("owner", user.id)
      .eq("key", body.stage)
      .maybeSingle();
    if (match) targetStage = body.stage;
  }

  // Właściwość „Źródło kontaktu" — dosiej definicję (idempotentnie) i ustaw
  // wartość: z modala albo domyślnie 'prospecting' (konwersja z prospectingu).
  await ensureContactSourceDef(supabase, user.id);
  const contactSource = body.contact_source?.trim() || "prospecting";

  const props = p.props ?? {};
  const googleMapsUrl =
    (props.google_maps_url as string | undefined) ??
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.city ?? ""}`.trim())}`;

  // Rdzeń deala + PEŁNY snapshot danych scrapera w props (jsonb bez ograniczeń).
  // props to źródło prawdy dla danych przeniesionych z prospektu — dedykowane
  // kolumny niżej są tylko odpytywalnym duplikatem tego, co i tak jest w props.
  const corePayload = {
    owner: user.id,
    name: body.name?.trim() || p.name,
    phone: p.phone,
    company: p.name,
    stage: targetStage,
    value: typeof body.value === "number" && Number.isFinite(body.value) ? body.value : 0,
    source: "prospecting",
    // props zachowane dla zgodności wstecznej (google_maps_url, score_reasons)
    // oraz komplet danych zdublowany, żeby nic nie zginęło.
    props: {
      website: p.website,
      address: p.address,
      industry: p.industry,
      category: p.category ?? p.industry,
      city: p.city,
      place_id: p.place_id,
      rating: p.rating,
      review_count: p.review_count,
      business_status: p.business_status,
      lead_score: p.lead_score,
      lead_score_breakdown: p.lead_score_breakdown,
      website_status: p.website_status,
      google_maps_url: googleMapsUrl,
      score_reasons: props.score_reasons ?? null,
      // Właściwość „Źródło kontaktu" (select, edytowalna później na dealu).
      [CONTACT_SOURCE_KEY]: contactSource,
    },
  };

  // Pełny transfer danych z Google Maps na dedykowane kolumny deala
  // (migration_deals_scraper_fields.sql, migration_lead_categories.sql,
  // migration_properties_system.sql) — KAŻDA właściwość zebrana przy scrapowaniu
  // ląduje na rekordzie deala, nie tylko podzbiór.
  const extendedPayload = {
    ...corePayload,
    place_id: p.place_id,
    website: p.website,
    address: p.address,
    google_rating: p.rating,
    review_count: p.review_count,
    business_status: p.business_status,
    industry: p.industry,
    city: p.city,
    website_status: p.website_status,
    lead_score: p.lead_score,
    lead_score_breakdown: p.lead_score_breakdown,
    // Kuratorowana kategoria branży (Feature 1) — przeniesiona na deala, żeby
    // klasyfikacja nie ginęła przy konwersji prospekt → deal.
    category: p.category ?? null,
    // Cele kontaktu (Feature 2) — przeniesione na deala (model hybrydowy).
    purposes: p.purposes ?? [],
  };

  let { data: deal, error: dErr } = await supabase
    .from("deals")
    .insert(extendedPayload)
    .select("id")
    .single();

  // Odporność na dryf schematu bazy: jeśli któraś z dedykowanych kolumn scrapera
  // nie istnieje na tej instancji (nieuruchomiona migracja) albo nieaktualny
  // check-constraint odrzuca wartość (np. przywrócony górny limit lead_score),
  // pełny insert się wywraca i „Konwertuj na lead" nic nie robi. W takim wypadku
  // ponawiamy z rdzeniem — deal i tak powstaje, a komplet danych żyje w props.
  if (dErr) {
    console.error("convert-to-lead: full insert failed, retrying core payload", dErr);
    ({ data: deal, error: dErr } = await supabase
      .from("deals")
      .insert(corePayload)
      .select("id")
      .single());
  }

  if (dErr || !deal) {
    return NextResponse.json(
      { error: `Nie udało się utworzyć deala: ${dErr?.message ?? "nieznany błąd"}` },
      { status: 500 }
    );
  }

  // Historia celów kontaktu (append-only) — przenieś na deala przy konwersji.
  if ((p.purposes?.length ?? 0) > 0) {
    await supabase.from("deal_purposes").insert(
      (p.purposes ?? []).map((purpose) => ({ owner: user.id, deal_id: deal.id, purpose, source: "convert" }))
    );
  }

  const reasons = Array.isArray(props.score_reasons) ? (props.score_reasons as string[]).join(", ") : "";
  await supabase.from("activities").insert({
    owner: user.id,
    deal_id: deal.id,
    type: "note",
    body: `Skonwertowano z prospectingu. Oryginalna ocena: ${p.lead_score ?? "—"}/100.${reasons ? ` ${reasons}` : ""}`,
  });

  const { error: upErr } = await supabase
    .from("prospects")
    .update({ prospecting_status: "converted", converted_deal_id: deal.id })
    .eq("id", id);
  if (upErr) {
    return NextResponse.json({ error: "Deal utworzony, ale nie udało się zaktualizować prospektu" }, { status: 500 });
  }

  return NextResponse.json({ deal_id: deal.id });
}
