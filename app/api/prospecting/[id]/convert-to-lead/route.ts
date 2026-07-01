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

  const { data: firstStage } = await supabase
    .from("pipeline_stages")
    .select("key")
    .eq("owner", user.id)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: deal, error: dErr } = await supabase
    .from("deals")
    .insert({
      owner: user.id,
      name: p.name,
      phone: p.phone,
      stage: firstStage?.key ?? "new",
      value: 0,
      source: "prospecting",
      props: { address: p.address, industry: p.industry, city: p.city, place_id: p.place_id },
    })
    .select("id")
    .single();
  if (dErr || !deal) {
    return NextResponse.json({ error: "Nie udało się utworzyć deala" }, { status: 500 });
  }

  const { error: upErr } = await supabase
    .from("prospects")
    .update({ prospecting_status: "converted", converted_deal_id: deal.id })
    .eq("id", id);
  if (upErr) {
    return NextResponse.json({ error: "Deal utworzony, ale nie udało się zaktualizować prospektu" }, { status: 500 });
  }

  return NextResponse.json({ deal_id: deal.id });
}
