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

// „Deal Owner” — prosty ręczny przydział (bez modelu workspace z Fazy 11).
export type Assignee = "dominik" | "kuba";

// Deal = osoba/firma, która już okazała zainteresowanie (Faza 10) — tożsamość
// i szansa sprzedaży połączone w jeden, samodzielny rekord. Każde zgłoszenie
// formularza tworzy NOWY deal (z własną kopią tożsamości).
export type Deal = {
  id: string;
  owner: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  props: Record<string, string>;
  stage: Stage;
  value: number;
  source: string | null;
  form_id: string | null;
  assignee: Assignee | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

// Prospekt = zimny lead z Google Maps (Faza 10), zanim wykaże zainteresowanie.
// Zasilane przez zewnętrzny scraper; status ustawiany ręcznie w CRM.
export type ProspectingStatus = "new" | "contact_attempted" | "not_interested" | "converted";
export type WebsiteStatus = "none" | "active" | "broken" | "slow";

export type Prospect = {
  id: string;
  owner: string;
  place_id: string;
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  rating: number | null;
  review_count: number | null;
  business_status: string | null;
  industry: string | null;
  city: string | null;
  source: string;
  prospecting_status: ProspectingStatus;
  created_at: string;
  last_contact_attempt_at: string | null;
  note: string | null;
  website_status: WebsiteStatus | null;
  website_last_checked_at: string | null;
  lead_score: number | null;
  lead_score_breakdown: Record<string, unknown> | null;
  converted_deal_id: string | null;
  props: Record<string, unknown>;
};

// Flaga potencjalnego duplikatu deala (Faza 9.2) — surfaced w UI w 9.3.
export type DuplicateFlag = {
  id: string;
  owner: string;
  deal_a: string;
  deal_b: string;
  reason: string;
  resolved: boolean;
  created_at: string;
};

export type Activity = {
  id: string;
  owner: string;
  deal_id: string;
  type: ActivityType;
  body: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

export type Task = {
  id: string;
  owner: string;
  deal_id: string | null;
  title: string;
  due_at: string | null;
  done: boolean;
  assignee: Assignee | null;
  created_at: string;
  // opcjonalna złączona nazwa deala (z select ... deals(name))
  deals?: { id: string; name: string | null } | null;
};

export type PropertyDef = {
  id: string;
  owner: string;
  key: string;
  type: PropertyType;
  options: string[] | null;
  position: number;
};

// Zgłoszenie (surowa odpowiedź formularza) — widok Inbox.
export type Submission = {
  id: string;
  form_id: string;
  answers: Record<string, string | string[]>;
  meta: Record<string, unknown> | null;
  deal_id: string | null;
  created_at: string;
  // opcjonalne złączenia (z select ... forms(title), deals(...))
  forms?: { id: string; title: string } | null;
  deals?: { id: string; name: string | null; email: string | null; stage: string } | null;
};

export type Notification = {
  id: string;
  owner: string;
  deal_id: string | null;
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
