// lib/contactSource.ts — właściwość deala „Źródło kontaktu" (select).
// Zaimplementowana jako definicja w property_defs (zakres: Deals) — dzięki
// temu listę opcji edytuje się w Ustawieniach → Właściwości jak każdą inną
// listę, a wartość żyje w deals.props. Auto-ustawiana:
//   • 'prospecting' — deal utworzony konwersją prospektu,
//   • 'formularz'   — deal utworzony ze zgłoszenia formularza.
import type { PropertyOption } from "@/lib/types";

export const CONTACT_SOURCE_KEY = "zrodlo_kontaktu";
export const CONTACT_SOURCE_LABEL = "Źródło kontaktu";

export const CONTACT_SOURCE_SEED: PropertyOption[] = [
  { key: "prospecting", label: "Prospecting", color: "#6C5CE7" },
  { key: "formularz", label: "Formularz", color: "#1A73E7" },
  { key: "polecenie", label: "Polecenie", color: "#18A957" },
  { key: "cold_mail", label: "Cold mail", color: "#F2994A" },
  { key: "inne", label: "Inne", color: "#75798A" },
];

type DbLike = {
  from: (table: string) => any;
};

/**
 * Dosiewa definicję właściwości „Źródło kontaktu" dla właściciela, jeśli
 * jeszcze nie istnieje (idempotentne; działa po stronie klienta i serwera).
 * Kolumna `scopes` może nie istnieć przed migracją — wtedy ponawiamy bez niej.
 */
export async function ensureContactSourceDef(db: DbLike, ownerId: string): Promise<void> {
  const { data } = await db
    .from("property_defs")
    .select("id")
    .eq("owner", ownerId)
    .eq("key", CONTACT_SOURCE_KEY)
    .maybeSingle();
  if (data) return;

  const base = {
    owner: ownerId,
    key: CONTACT_SOURCE_KEY,
    label: CONTACT_SOURCE_LABEL,
    type: "select",
    options: CONTACT_SOURCE_SEED,
    position: 1000,
  };
  const { error } = await db.from("property_defs").insert({ ...base, scopes: ["deals"] });
  if (error) {
    // Brak kolumny scopes (przed migracją) → dosiej bez zakresu.
    await db.from("property_defs").insert(base);
  }
}
