// app/api/prospecting/[id]/convert-to-lead/route.ts
// Tworzy deal na podstawie prospektu (zalogowany user, RLS po owner) i
// oznacza prospekt jako skonwertowany.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { Prospect } from "@/lib/types";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
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

  const props = p.props ?? {};
  const googleMapsUrl =
    (props.google_maps_url as string | undefined) ??
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.city ?? ""}`.trim())}`;

  const { data: deal, error: dErr } = await supabase
    .from("deals")
    .insert({
      owner: user.id,
      name: p.name,
      phone: p.phone,
      company: p.name,
      stage: firstStage?.key ?? "new",
      value: 0,
      source: "prospecting",
      props: {
        website: p.website,
        address: p.address,
        industry: p.industry,
        category: p.industry,
        city: p.city,
        place_id: p.place_id,
        rating: p.rating,
        review_count: p.review_count,
        lead_score: p.lead_score,
        website_status: p.website_status,
        google_maps_url: googleMapsUrl,
        score_reasons: props.score_reasons ?? null,
      },
    })
    .select("id")
    .single();
  if (dErr || !deal) {
    return NextResponse.json({ error: "Nie udało się utworzyć deala" }, { status: 500 });
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
