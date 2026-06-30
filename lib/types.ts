// lib/types.ts — współdzielone typy domeny (CRM + formularze).

// Etap to teraz dowolny klucz zdefiniowany w pipeline_stages (konfigurowalny).
export type Stage = string;

export type PipelineStage = {
  id: string;
  owner: string;
  key: string;
  label: string;
  color: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
};

export type ActivityType = "note" | "call" | "email" | "submission" | "stage" | "task";

export type PropertyType = "text" | "number" | "date" | "select";

// Kontakt = trwała tożsamość osoby/firmy (Faza 9.1). Etap/wartość/źródło/
// formularz przeniesione do `Lead` — jeden kontakt może mieć wiele leadów.
export type Contact = {
  id: string;
  owner: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  props: Record<string, string>;
  created_at: string;
  updated_at: string;
};

// Lead = pojedyncza szansa sprzedaży przypięta do kontaktu (Faza 9.1).
export type Lead = {
  id: string;
  owner: string;
  contact_id: string;
  stage: Stage;
  value: number;
  source: string | null;
  form_id: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Activity = {
  id: string;
  owner: string;
  contact_id: string;
  lead_id: string | null;
  type: ActivityType;
  body: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

export type Task = {
  id: string;
  owner: string;
  contact_id: string | null;
  title: string;
  due_at: string | null;
  done: boolean;
  created_at: string;
  // opcjonalna złączona nazwa kontaktu (z select ... contacts(name))
  contacts?: { id: string; name: string | null } | null;
};

export type PropertyDef = {
  id: string;
  owner: string;
  key: string;
  type: PropertyType;
  options: string[] | null;
  position: number;
};

export type Notification = {
  id: string;
  owner: string;
  contact_id: string | null;
  type: string;
  body: string;
  read: boolean;
  created_at: string;
};

export type AppSettings = {
  owner: string;
  email_new_lead: boolean;
  email_task_due: boolean;
  notify_email: string | null;
};

// Domyślne etapy lejka — używane jako seed (pierwsze wczytanie) oraz jako
// fallback, gdy tabela pipeline_stages jest pusta lub niedostępna.
export type StageSeed = {
  key: string;
  label: string;
  color: string;
  is_won: boolean;
  is_lost: boolean;
};

export const DEFAULT_STAGES: StageSeed[] = [
  { key: "new", label: "Nowy lead", color: "#6C5CE7", is_won: false, is_lost: false },
  { key: "contact", label: "Kontakt", color: "#1A73E7", is_won: false, is_lost: false },
  { key: "offer", label: "Oferta", color: "#F2994A", is_won: false, is_lost: false },
  { key: "won", label: "Wygrane", color: "#18A957", is_won: true, is_lost: false },
  { key: "lost", label: "Przegrane", color: "#8A92A6", is_won: false, is_lost: true },
];

// Minimalny kształt etapu używany w UI (wystarcza do etykiety/koloru).
export type StageLike = { key: string; label: string; color: string };

// Znajdź metadane etapu po kluczu na podanej liście (z fallbackiem).
export function stageMetaFrom<T extends StageLike>(stages: T[], key: Stage): T | StageLike {
  return stages.find((s) => s.key === key) ?? stages[0] ?? DEFAULT_STAGES[0];
}
