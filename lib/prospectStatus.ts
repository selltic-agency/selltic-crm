// lib/prospectStatus.ts — mapowanie statusu prospektu na 4 stany widoczne w UI.
// Baza danych wciąż dopuszcza starą wartość `contact_attempted` (constraint w
// schema.sql) — nie robimy migracji. W interfejsie pokazujemy wyłącznie
// cztery statusy: new / no_answer / not_interested / converted. Każda
// nierozpoznana wartość (w tym `contact_attempted`) jest traktowana jak
// `no_answer` — filozofia: jeśli była realna rozmowa i jakiekolwiek
// zainteresowanie, prospekt od razu staje się dealem.
import { tokens } from "@/lib/ui";
import type { Prospect } from "@/lib/types";

export type DisplayStatus = "new" | "no_answer" | "not_interested" | "converted";

// Statusy zapisywalne ręcznie z UI (converted ma osobny, dedykowany endpoint).
export type WritableDisplayStatus = "no_answer" | "not_interested";

// Wartość zapisywana w kolumnie `prospecting_status` dla każdego zapisywalnego statusu UI.
const DB_STATUS_FOR_WRITE: Record<WritableDisplayStatus, "contact_attempted" | "not_interested"> = {
  no_answer: "contact_attempted",
  not_interested: "not_interested",
};

export function dbStatusForWrite(status: WritableDisplayStatus): "contact_attempted" | "not_interested" {
  return DB_STATUS_FOR_WRITE[status];
}

export function toDisplayStatus(dbStatus: string): DisplayStatus {
  if (dbStatus === "new" || dbStatus === "not_interested" || dbStatus === "converted") return dbStatus;
  // "contact_attempted" i wszelkie inne, nierozpoznane wartości.
  return "no_answer";
}

export const DISPLAY_STATUSES: DisplayStatus[] = ["new", "no_answer", "not_interested", "converted"];

// „Nie nasz target" zastąpił dawnego „Niezainteresowanego" — w bazie to wciąż
// wartość 'not_interested' (zero-loss: stare dane mapują się 1:1 na nowy
// status), ale semantyka jest szersza: prospekt jest archiwizowany i znika
// z kolejki dzwonienia.
export const STATUS_LABEL: Record<DisplayStatus, string> = {
  new: "Nowy",
  no_answer: "Nie odbiera",
  not_interested: "Nie nasz target",
  converted: "Skonwertowany",
};

export const STATUS_COLOR: Record<DisplayStatus, string> = {
  new: tokens.accent,
  no_answer: tokens.warning,
  not_interested: tokens.danger,
  converted: tokens.success,
};

// Prospekt jest „aktywny do dzwonienia”, gdy nikt jeszcze nie odmówił i nie skonwertowano.
export function isCallable(p: Prospect): boolean {
  const s = toDisplayStatus(p.prospecting_status);
  return (s === "new" || s === "no_answer") && !isClosedBusiness(p);
}

// Firma zamknięta / niedziałająca wg danych scrapera z Google Maps.
export function isClosedBusiness(p: Prospect): boolean {
  return !!p.business_status && p.business_status !== "OPERATIONAL";
}

export function scoreColor(score: number): string {
  if (score >= 70) return tokens.success;
  if (score >= 35) return tokens.warning;
  return tokens.muted;
}

export function scoreLabel(score: number): string {
  if (score >= 70) return "wysoki";
  if (score >= 35) return "średni";
  return "niski";
}

// Notatka w timeline'ie prospektu — przechowywana w props.notes (jsonb),
// bez migracji schematu.
export type ProspectNote = {
  id: string;
  body: string;
  created_at: string;
};

export function notesFromProps(props: Record<string, unknown> | null | undefined): ProspectNote[] {
  const raw = props?.notes;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (n): n is ProspectNote => !!n && typeof n === "object" && typeof (n as ProspectNote).body === "string"
  );
}

export function googleMapsUrl(p: Prospect): string {
  const fromProps = p.props?.google_maps_url as string | undefined;
  if (fromProps) return fromProps;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.city ?? ""}`.trim())}`;
}

export function scoreReasons(props: Record<string, unknown> | null | undefined): string[] {
  const raw = props?.score_reasons;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is string => typeof r === "string");
}

// Inicjały firmy do awatara: pierwsze litery pierwszych dwóch słów, albo
// pierwsze dwa znaki, gdy nazwa to jedno słowo.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
