// lib/owners.ts — metadane „Deal Ownerów” (assignee: 'dominik' | 'kuba').
// Model właściciela jest prosty i ręczny (deals.assignee, patrz schema.sql) —
// brak tabeli profili / URL-i awatarów. Awatar renderujemy więc jako kolorowe
// inicjały, spójne (ten sam kolor) dla danego ownera na wszystkich kartach.
// Gdyby w przyszłości pojawiły się zdjęcia profilowe, wystarczy dodać
// avatar_url tutaj — OwnerAvatar użyje go automatycznie.
import type { Assignee } from "@/lib/types";

export type OwnerMeta = {
  label: string;
  initials: string;
  color: string;
  avatar_url?: string | null;
};

export const DEAL_OWNERS: Record<Assignee, OwnerMeta> = {
  dominik: { label: "Dominik", initials: "D", color: "#6C5CE7" },
  kuba: { label: "Kuba", initials: "K", color: "#1A73E7" },
};

export function ownerMeta(assignee: Assignee | null | undefined): OwnerMeta | null {
  if (!assignee) return null;
  return DEAL_OWNERS[assignee] ?? null;
}
