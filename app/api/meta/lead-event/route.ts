// app/api/meta/lead-event/route.ts — sygnał jakości leada do Meta po zmianie
// etapu w CRM. Wołany z karty leada (fire-and-forget) po UDANYM zapisie etapu.
//
// Auth: sesja zalogowanego właściciela. Sam zapis do meta_lead_events idzie
// przez service_role (tabela ma politykę tylko na odczyt), po wcześniejszym
// sprawdzeniu, że deal należy do użytkownika.
import { NextResponse } from "next/server";
import { createSupabaseAdmin, createSupabaseServer } from "@/lib/supabase/server";
import { sendStageEventForDeal } from "@/lib/server/metaCrm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const { dealId, stage } = (await req.json().catch(() => ({}))) as {
    dealId?: string;
    stage?: string;
  };
  if (!dealId || !stage) return NextResponse.json({ error: "Brak dealId lub stage." }, { status: 400 });

  // Deal musi należeć do użytkownika — sprawdzamy klientem sesyjnym (RLS).
  const { data: deal } = await supabase.from("deals").select("id").eq("id", dealId).maybeSingle();
  if (!deal) return NextResponse.json({ error: "Brak dostępu do leada." }, { status: 403 });

  const outcome = await sendStageEventForDeal(createSupabaseAdmin(), {
    owner: user.id,
    dealId,
    stageKey: stage,
  });

  return NextResponse.json(outcome);
}
