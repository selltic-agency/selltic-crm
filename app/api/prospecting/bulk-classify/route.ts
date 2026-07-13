// app/api/prospecting/bulk-classify/route.ts
// Akcje zbiorcze na liście leadów (Prospecting): ustaw KATEGORIĘ (Feature 1)
// i/lub dodaj CEL KONTAKTU (Feature 2) dla zaznaczonych prospektów.
//
// Kategoria jest jednowartościowa → nadpisujemy. Cel kontaktu jest
// wielowartościowy z historią → DOKŁADAMY (append-only), nigdy nie nadpisujemy:
// dopisujemy wpis do prospect_purposes i uzupełniamy zdenormalizowany zbiór
// prospects.purposes (bez duplikatów).
//
// Duże zaznaczenia: PostgREST koduje .in() w URL-u, więc listy id dzielimy na
// paczki. Zapisy robimy zbiorczo tam, gdzie się da.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export const maxDuration = 60;

const CHUNK_SIZE = 100;

function chunk<T>(arr: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  let body: { ids?: string[]; category?: string | null; purpose?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  const ids = [...new Set(body.ids ?? [])];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Nie wybrano żadnych leadów" }, { status: 400 });
  }
  const category = body.category === undefined ? undefined : (body.category ?? null);
  const purpose = (body.purpose ?? "").trim() || null;
  if (category === undefined && !purpose) {
    return NextResponse.json({ error: "Nie podano kategorii ani celu kontaktu" }, { status: 400 });
  }

  let categorized = 0;
  let purposed = 0;

  // ── Kategoria: nadpisujemy (jednowartościowa). ──────────────────────────
  if (category !== undefined) {
    for (const part of chunk(ids)) {
      const { data, error } = await supabase.from("prospects").update({ category }).in("id", part).select("id");
      if (error) {
        console.error("[bulk-classify] category", error);
        return NextResponse.json({ error: "Nie udało się ustawić kategorii" }, { status: 500 });
      }
      categorized += data?.length ?? 0;
    }
  }

  // ── Cel kontaktu: append-only (historia + zbiór bez duplikatów). ─────────
  if (purpose) {
    // Historia — jeden wpis na lead.
    for (const part of chunk(ids)) {
      const { error } = await supabase.from("prospect_purposes").insert(
        part.map((id) => ({ owner: user.id, prospect_id: id, purpose, source: "bulk" }))
      );
      if (error) console.error("[bulk-classify] purpose history", error);
    }
    // Zbiór na prospekcie — dołóż, jeśli jeszcze nie ma.
    for (const part of chunk(ids)) {
      const { data } = await supabase.from("prospects").select("id, purposes").in("id", part);
      const rows = (data as { id: string; purposes: string[] | null }[] | null) ?? [];
      const needAppend = rows.filter((r) => !((r.purposes ?? []).includes(purpose)));
      for (const sub of chunk(needAppend, 10)) {
        await Promise.all(
          sub.map((r) =>
            supabase
              .from("prospects")
              .update({ purposes: [...((r.purposes ?? []).filter(Boolean)), purpose] })
              .eq("id", r.id)
          )
        );
      }
      purposed += rows.length;
    }
  }

  return NextResponse.json({ categorized, purposed });
}
