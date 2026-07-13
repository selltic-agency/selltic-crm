// app/api/scraper/move-to-prospecting/route.ts
// "Przenieś do Prospectingu": kopiuje zaznaczone scraped_leads do prospects,
// respektując dedup po place_id. Zasada (celowa, nieautomatyczna): jeśli
// place_id JUŻ istnieje w prospects jako AKTYWNY prospekt, NIE nadpisujemy
// go — oznaczamy wiersz scraped_leads jako 'duplicate' do ręcznego przeglądu
// (zakładka Duplikaty), zamiast cichej aktualizacji. Prospekt ZARCHIWIZOWANY
// (archived_at != null) nie ma aktywnego workflow, który moglibyśmy zepsuć —
// przywracamy go (archived_at = null) i odświeżamy danymi ze scrapera; unikat
// na place_id i tak nie pozwoliłby wstawić drugiego wiersza. scraped_leads
// nigdy nie jest usuwane — to trwała historia scrapowania.
//
// Skala: "Zaznacz wszystkie" potrafi wysłać kilkaset id naraz. PostgREST
// koduje filtry .in() w URL-u zapytania, więc listy id/place_id MUSZĄ być
// dzielone na paczki (inaczej 500 przy dużym zaznaczeniu), a zapisy robimy
// zbiorczo (upsert/update per paczka), nie wiersz po wierszu — inaczej
// funkcja serverless nie zmieści się w limicie czasu.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { ScrapedLead, WebsiteStatus } from "@/lib/types";

// Bulk-move kilkuset leadów to dziesiątki zapytań do Supabase — domyślny
// limit czasu funkcji może nie wystarczyć.
export const maxDuration = 60;

const WEBSITE_STATUS_MAP: Record<string, WebsiteStatus> = {
  brak: "none",
  dziala: "active",
  nie_dziala: "broken",
};

// Paczka bezpieczna dla długości URL-a: 100 UUID-ów ≈ 4 KB parametru filtra.
const CHUNK_SIZE = 100;

function chunk<T>(arr: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Pola prospekta pochodzące ze scrapowania — wspólne dla insertu nowego
// prospekta i odświeżenia przywracanego z Archiwum.
function prospectFields(lead: ScrapedLead) {
  return {
    name: lead.business_name,
    phone: lead.phone,
    website: lead.website,
    address: lead.address,
    rating: lead.rating,
    review_count: lead.review_count,
    business_status: lead.business_status,
    industry: lead.source_keyword,
    city: lead.source_location,
    // Kuratorowana kategoria branży (Feature 1) — jednowartościowa, więc
    // przy przywróceniu z Archiwum odświeżamy ją danymi z nowego scrapowania.
    category: lead.category ?? null,
    lead_score: lead.score,
    lead_score_breakdown: lead.score_breakdown,
    website_status: lead.website_status ? WEBSITE_STATUS_MAP[lead.website_status] ?? null : null,
    website_last_checked_at: lead.website_status ? lead.scraped_at : null,
  };
}

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

  // 1. Wczytaj zaznaczone leady (paczkami — patrz komentarz o URL-u wyżej).
  const leads: ScrapedLead[] = [];
  for (const part of chunk(ids)) {
    const { data, error } = await supabase
      .from("scraped_leads")
      .select("*")
      .in("id", part)
      .eq("status", "new");
    if (error) {
      console.error("[scraper/move-to-prospecting] load leads", error);
      return NextResponse.json({ error: "Nie udało się wczytać leadów" }, { status: 500 });
    }
    leads.push(...((data ?? []) as ScrapedLead[]));
  }

  // 2. Istniejące prospekty dla tych place_id (też paczkami).
  const placeIds = [...new Set(leads.map((l) => l.place_id))];
  const existingByPlaceId = new Map<string, { id: string; archived: boolean }>();
  for (const part of chunk(placeIds)) {
    const { data, error } = await supabase
      .from("prospects")
      .select("id, place_id, archived_at")
      .in("place_id", part);
    if (error) {
      console.error("[scraper/move-to-prospecting] load prospects", error);
      return NextResponse.json({ error: "Nie udało się wczytać prospektów" }, { status: 500 });
    }
    for (const p of data ?? []) {
      existingByPlaceId.set(p.place_id as string, {
        id: p.id as string,
        archived: p.archived_at != null,
      });
    }
  }

  let moved = 0;
  let restored = 0;
  let duplicates = 0;
  const errors: { id: string; error: string }[] = [];

  async function markDuplicates(leadIds: string[]) {
    for (const part of chunk(leadIds)) {
      const { error } = await supabase
        .from("scraped_leads")
        .update({ status: "duplicate" })
        .in("id", part);
      if (error) {
        for (const id of part) errors.push({ id, error: error.message });
      } else {
        duplicates += part.length;
      }
    }
  }

  // 3. Podział: aktywny duplikat / przywrócenie z Archiwum / nowy insert.
  //    Powtórzony place_id wewnątrz zaznaczenia (ta sama firma z dwóch zadań)
  //    — pierwszy wygrywa, kolejne to duplikaty.
  const duplicateLeadIds: string[] = [];
  const toRestore: { lead: ScrapedLead; prospectId: string }[] = [];
  const toInsert: ScrapedLead[] = [];
  const seenInBatch = new Set<string>();

  for (const lead of leads) {
    const existing = existingByPlaceId.get(lead.place_id);
    if (seenInBatch.has(lead.place_id) || (existing && !existing.archived)) {
      duplicateLeadIds.push(lead.id);
      continue;
    }
    seenInBatch.add(lead.place_id);
    if (existing) toRestore.push({ lead, prospectId: existing.id });
    else toInsert.push(lead);
  }

  // Leady, których prospekt powstał/został przywrócony — do zbiorczego
  // oznaczenia 'moved' w kroku 6.
  const movedRows: { lead: ScrapedLead; prospectId: string; wasRestored: boolean }[] = [];

  // 4. Przywrócenia z Archiwum: wartości różnią się per wiersz, więc update
  //    per prospekt, ale równolegle w małych grupach.
  for (const part of chunk(toRestore, 10)) {
    const results = await Promise.all(
      part.map(async ({ lead, prospectId }) => {
        const { error } = await supabase
          .from("prospects")
          .update({ archived_at: null, ...prospectFields(lead) })
          .eq("id", prospectId);
        return { lead, prospectId, error };
      })
    );
    for (const r of results) {
      if (r.error) {
        console.error("[scraper/move-to-prospecting] restore", r.lead.id, r.error);
        errors.push({ id: r.lead.id, error: r.error.message });
      } else {
        movedRows.push({ lead: r.lead, prospectId: r.prospectId, wasRestored: true });
      }
    }
  }

  // 5. Nowe prospekty: zbiorczy upsert z ignoreDuplicates — wiersz kolidujący
  //    na place_id (wyścig albo prospekt innego użytkownika, niewidoczny przez
  //    RLS przy globalnym unikacie) jest pomijany zamiast wywracać całą paczkę;
  //    zwrotka zawiera tylko faktycznie wstawione wiersze.
  for (const part of chunk(toInsert)) {
    const { data, error } = await supabase
      .from("prospects")
      .upsert(
        part.map((lead) => ({
          owner: user.id,
          place_id: lead.place_id,
          source: "google_maps_scraper",
          ...prospectFields(lead),
          // Cel kontaktu (Feature 2): świeży prospekt startuje z celem paczki
          // (jeśli wybrano). Zbiór wielowartościowy — historia w prospect_purposes.
          purposes: lead.contact_purpose ? [lead.contact_purpose] : [],
        })),
        { onConflict: "place_id", ignoreDuplicates: true }
      )
      .select("id, place_id");
    if (error) {
      console.error("[scraper/move-to-prospecting] insert", error);
      for (const lead of part) errors.push({ id: lead.id, error: error.message });
      continue;
    }
    const insertedByPlaceId = new Map((data ?? []).map((p) => [p.place_id as string, p.id as string]));
    for (const lead of part) {
      const prospectId = insertedByPlaceId.get(lead.place_id);
      if (prospectId) movedRows.push({ lead, prospectId, wasRestored: false });
      else duplicateLeadIds.push(lead.id); // pominięty przez ignoreDuplicates
    }
  }

  await markDuplicates(duplicateLeadIds);

  // 6. Zbiorcze oznaczenie 'moved' + moved_to_prospect_id. Wartości różnią się
  //    per wiersz, więc upsert pełnych wierszy po kluczu głównym (insert…on
  //    conflict do update) — jedna paczka to jedno zapytanie.
  for (const part of chunk(movedRows)) {
    const { error } = await supabase.from("scraped_leads").upsert(
      part.map(({ lead, prospectId }) => ({
        ...lead,
        status: "moved",
        moved_to_prospect_id: prospectId,
      }))
    );
    if (error) {
      console.error("[scraper/move-to-prospecting] mark moved", error);
      for (const { lead } of part) errors.push({ id: lead.id, error: error.message });
    } else {
      moved += part.length;
      restored += part.filter((r) => r.wasRestored).length;
    }
  }

  // 7. Cele kontaktu (Feature 2): dopisz historię (append-only) i uzupełnij
  //    zdenormalizowany zbiór na prospekcie. Nowo wstawione mają cel ustawiony
  //    już przy insercie (krok 5); przywrócone z Archiwum mogły mieć wcześniejsze
  //    cele — dokładamy nowy bez nadpisywania (wielowartościowość z historią).
  const purposeRows = movedRows.filter((r) => !!r.lead.contact_purpose);
  if (purposeRows.length > 0) {
    for (const part of chunk(purposeRows)) {
      const { error } = await supabase.from("prospect_purposes").insert(
        part.map((r) => ({
          owner: user.id,
          prospect_id: r.prospectId,
          purpose: r.lead.contact_purpose as string,
          source: "job",
        }))
      );
      if (error) console.error("[scraper/move-to-prospecting] purpose history", error);
    }

    const restoredWithPurpose = purposeRows.filter((r) => r.wasRestored);
    for (const part of chunk(restoredWithPurpose, 10)) {
      await Promise.all(
        part.map(async (r) => {
          const purpose = r.lead.contact_purpose as string;
          const { data } = await supabase.from("prospects").select("purposes").eq("id", r.prospectId).maybeSingle();
          const current: string[] = ((data?.purposes as string[] | null) ?? []).filter(Boolean);
          if (!current.includes(purpose)) {
            await supabase.from("prospects").update({ purposes: [...current, purpose] }).eq("id", r.prospectId);
          }
        })
      );
    }
  }

  return NextResponse.json({ moved, restored, duplicates, errors });
}
