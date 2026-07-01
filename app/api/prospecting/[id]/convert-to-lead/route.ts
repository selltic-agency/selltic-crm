// app/api/prospecting/[id]/convert-to-lead/route.ts
// Kwalifikuje prospekt (zalogowany user, RLS po owner):
//   1. znajduje/tworzy kontakt (dedup po telefonie),
//   2. tworzy deal na pierwszym etapie lejka, powiązany z tym kontaktem,
//   3. dopisuje aktywność podsumowującą dane ze scrapera,
//   4. oznacza prospekt jako skonwertowany (deal + kontakt).
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

  // 1. Kontakt: dedup po telefonie (w ramach właściciela). Bez telefonu —
  //    zawsze nowy kontakt (brak klucza do bezpiecznego dopasowania).
  let contactId: string;
  const { data: existingContact } = p.phone
    ? await supabase.from("contacts").select("id").eq("owner", user.id).eq("phone", p.phone).maybeSingle()
    : { data: null };

  if (existingContact) {
    contactId = existingContact.id;
  } else {
    const { data: newContact, error: cErr } = await supabase
      .from("contacts")
      .insert({
        owner: user.id,
        name: p.name,
        phone: p.phone,
        props: { address: p.address, industry: p.industry, city: p.city, place_id: p.place_id },
      })
      .select("id")
      .single();
    if (cErr || !newContact) {
      return NextResponse.json({ error: "Nie udało się utworzyć kontaktu" }, { status: 500 });
    }
    contactId = newContact.id;
  }

  // 2. Deal na pierwszym etapie lejka, powiązany z kontaktem.
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
      contact_id: contactId,
      stage: firstStage?.key ?? "new",
      value: 0,
      source: "prospecting",
      props: {
        address: p.address,
        industry: p.industry,
        city: p.city,
        place_id: p.place_id,
        website: p.website,
        website_status: p.website_status,
        priority_label: p.priority_label,
        lead_score: p.lead_score,
      },
    })
    .select("id")
    .single();
  if (dErr || !deal) {
    return NextResponse.json({ error: "Nie udało się utworzyć deala" }, { status: 500 });
  }

  // 3. Aktywność podsumowująca dane ze scrapera (kopiuje historię prospektu
  //    na oś czasu nowego deala).
  const parts = [
    `Zakwalifikowano z prospectingu (${p.industry ?? "brak branży"}, ${p.city ?? "brak miasta"}).`,
  ];
  if (p.website_status) parts.push(`Stan strony: ${p.website_status}.`);
  if (p.lead_score != null) parts.push(`Wynik: ${p.lead_score}/100${p.priority_label ? ` (${p.priority_label})` : ""}.`);
  if (p.score_reasons?.length) parts.push(`Powody: ${p.score_reasons.join(", ")}.`);
  await supabase.from("activities").insert({
    owner: user.id,
    deal_id: deal.id,
    type: "note",
    body: parts.join(" "),
    meta: { source: "prospecting", prospect_id: p.id },
  });

  // 4. Prospekt → skonwertowany, z linkami do wynikowego deala i kontaktu.
  const { error: upErr } = await supabase
    .from("prospects")
    .update({ prospecting_status: "converted", converted_deal_id: deal.id, converted_contact_id: contactId })
    .eq("id", id);
  if (upErr) {
    return NextResponse.json({ error: "Deal utworzony, ale nie udało się zaktualizować prospektu" }, { status: 500 });
  }

  return NextResponse.json({ deal_id: deal.id, contact_id: contactId });
}
