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

// Typy właściwości (custom fields). Rozszerzone o multi_select / boolean /
// email; `type` w bazie nie ma CHECK-a, więc kolumna dopuszcza te wartości.
export type PropertyType = "text" | "number" | "date" | "select" | "multi_select" | "boolean" | "email";

// Opcja listy (select / multi_select). `key` jest stabilny (trzymany w props),
// `label` edytowalny. Dane wstecznie mogą być zwykłym string[] — patrz
// normalizeOptions() w lib/properties.ts.
export type PropertyOption = { key: string; label: string; color?: string };

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
  // Wartości właściwości własnych (custom fields) — mieszane typy: string dla
  // tekstu/daty/liczby, boolean, string[] dla multi_select, plus dane z konwersji.
  props: Record<string, unknown>;
  stage: Stage;
  value: number;
  source: string | null;
  form_id: string | null;
  assignee: Assignee | null;
  // Kategoria branży (Feature 1) — przeniesiona z prospektu przy konwersji.
  category?: string | null;
  // Cele kontaktu (Feature 2) — wielowartościowe; kopiowane z prospektu przy
  // konwersji. Dedykowana kolumna (model hybrydowy), jak na prospektach.
  purposes?: string[];
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  // Dane z Google Maps przeniesione przy konwersji prospekt → deal
  // (migration_deals_scraper_fields.sql). Wszystkie opcjonalne — dealy z
  // formularzy ich nie mają.
  place_id?: string | null;
  website?: string | null;
  address?: string | null;
  google_rating?: number | null;
  review_count?: number | null;
  business_status?: string | null;
  industry?: string | null;
  city?: string | null;
  website_status?: WebsiteStatus | null;
  lead_score?: number | null;
  lead_score_breakdown?: Record<string, unknown> | null;
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
  archived_at: string | null;
  props: Record<string, unknown>;
  // Kategoria branży (Feature 1) — dziedziczona z zadania scrapowania.
  category?: string | null;
  // Cele kontaktu (Feature 2) — zdenormalizowany bieżący zbiór (pełna
  // historia w tabeli prospect_purposes). Wielowartościowe, nienadpisywane.
  purposes?: string[];
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
  // Nazwa wyświetlana; gdy brak — używamy `key` (patrz propLabel()).
  label?: string | null;
  type: PropertyType;
  // Dla list: PropertyOption[] lub (wstecznie) string[]. Normalizuj przez
  // normalizeOptions() zanim użyjesz.
  options: PropertyOption[] | string[] | null;
  position: number;
  // Miękkie usunięcie — właściwość z danymi archiwizujemy, nie kasujemy.
  archived_at?: string | null;
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
  // Integracje → wysyłka e-mail (item 9). Klucz trzymany server-side; do
  // klienta wraca tylko zamaskowany (patrz zakładka Integracje).
  resend_api_key?: string | null;
  resend_from?: string | null;
  // Adres, na który trafiają ODPOWIEDZI na wysłane maile (nagłówek Reply-To).
  // Pozwala kierować odpowiedzi np. na Gmaila zespołu, mimo wysyłki z domeny.
  resend_reply_to?: string | null;
};

// Szablon e-mail (Integracje → Szablony e-mail). Body to HTML; subject i body
// mogą zawierać placeholdery {{first_name}} itd. podstawiane danymi leada.
export type EmailTemplate = {
  id: string;
  owner: string;
  name: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
};

// ── Scraper headless (zakładka "Scraper") ───────────────────────────────
export type ScrapeJobStatus = "pending" | "running" | "done" | "error" | "canceled";

// Status całej paczki (jedno kliknięcie "Rozpocznij scrapowanie"). Sterowany
// przyciskami Pauza / Stop / Wznów; 'completed' ustawia backend po zakończeniu.
export type ScrapeBatchStatus = "running" | "paused" | "stopped" | "completed";

export type ScrapeBatch = {
  id: string;
  owner: string;
  keywords: string[];
  locations: string[];
  total_jobs: number;
  status: ScrapeBatchStatus;
  created_at: string;
  updated_at: string;
  // Cel kontaktu wybrany dla całej paczki (Feature 2) — dziedziczą go leady.
  contact_purpose?: string | null;
  // Scoring opcjonalny per paczka: wyłączony → leady bez wyniku (score = NULL).
  scoring_enabled?: boolean;
};

export type ScrapeJob = {
  id: string;
  owner: string;
  keyword: string;
  location: string;
  status: ScrapeJobStatus;
  results_count: number;
  new_count: number;
  existing_count: number;
  current_step: string | null;
  error_message: string | null;
  batch_id: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  // Klasyfikacja (Feature 1 + 2) — rozstrzygana przy tworzeniu zadania,
  // kopiowana na scraped_leads triggerem, więc backend scrapera jej nie dotyka.
  category?: string | null;
  contact_purpose?: string | null;
  // Scoring opcjonalny per paczka: wyłączony → to zadanie nie liczy wyniku.
  scoring_enabled?: boolean;
};

export type ScrapedLeadStatus = "new" | "moved" | "duplicate" | "rejected";

export type ScrapedLead = {
  id: string;
  owner: string;
  job_id: string;
  place_id: string;
  business_name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  business_status: string | null;
  score: number | null;
  score_breakdown: Record<string, unknown> | null;
  website_status: WebsiteStatus2 | null;
  source_keyword: string;
  source_location: string;
  status: ScrapedLeadStatus;
  moved_to_prospect_id: string | null;
  scraped_at: string;
  // Klasyfikacja skopiowana z zadania scrapowania triggerem (Feature 1 + 2).
  category?: string | null;
  contact_purpose?: string | null;
};

// Nazwa WebsiteStatus już zajęta przez prospects (inny zestaw wartości: 'none'|'active'|'broken'|'slow').
// scraped_leads.website_status pochodzi bezpośrednio z score_website() w scraperze: 'brak'|'nie_dziala'|'dziala'.
export type WebsiteStatus2 = "brak" | "nie_dziala" | "dziala";

// scraper_config: jeden wiersz per (owner, key). `value` jest jsonb więc
// kształt zależy od klucza — poniżej kształty faktycznie używanych kluczy.
export type ScraperConfigScoringWeights = {
  brak_strony: number;
  strona_nie_dziala: number;
  strona_dziala: number;
  niemobilna_bonus: number;
};

export type ScraperConfigRule = { min_count?: number; min_rating?: number; points: number };

export type ScraperConfig = {
  google_places_api_key: string;
  max_results_per_query: number;
  request_delay_ms: number;
  scoring_weights: ScraperConfigScoringWeights;
  scoring_rules_reviews: ScraperConfigRule[];
  scoring_rules_rating: ScraperConfigRule[];
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

// ── Klasyfikacja leadów: KATEGORIA BRANŻY (Feature 1) ────────────────────
// Stała lista 13 kategorii medyczno-okołozdrowotnych. Zasiewana per-owner
// (jak pipeline_stages) — edytowalna kolorystycznie i rozszerzalna, ale
// `key` jest stabilnym identyfikatorem trzymanym jako tekst na leadach.
export type LeadCategory = {
  id: string;
  owner: string;
  key: string;
  label: string;
  color: string;
  position: number;
};

export type CategorySeed = { key: string; label: string; color: string };

export const DEFAULT_CATEGORIES: CategorySeed[] = [
  { key: "psychologia", label: "Psychologia / terapia / psychiatria", color: "#6C5CE7" },
  { key: "fizjoterapia", label: "Fizjoterapia / trening / masaż", color: "#1A73E7" },
  { key: "medycyna_estetyczna", label: "Medycyna estetyczna", color: "#E84393" },
  { key: "beauty", label: "Branża beauty", color: "#E17055" },
  { key: "stomatologia", label: "Stomatologia", color: "#00A3A3" },
  { key: "dermatologia", label: "Dermatologia", color: "#F2994A" },
  { key: "ginekologia", label: "Ginekologia / położnictwo", color: "#EB5286" },
  { key: "lekarze", label: "Lekarze specjaliści (ogólne)", color: "#2D9CDB" },
  { key: "dietetyka", label: "Dietetyka / żywienie", color: "#18A957" },
  { key: "logopedia", label: "Logopedia", color: "#9B51E0" },
  { key: "weterynaria", label: "Weterynaria", color: "#6D4C41" },
  { key: "optyka", label: "Optyka / okulistyka", color: "#0984E3" },
  { key: "podologia", label: "Podologia / kosmetologia lecznicza", color: "#00B894" },
];

// Mapowanie słowo kluczowe scrapera → kategoria (wiele słów → jedna kategoria).
// Zarządzane w Ustawieniach → „Kategorie branż”. unique(owner, keyword).
export type CategoryKeyword = {
  id: string;
  owner: string;
  keyword: string;
  category_key: string;
  created_at: string;
};

// ── Klasyfikacja leadów: CEL KONTAKTU (Feature 2) ────────────────────────
// Słownik wartości (ads/website/both), rozszerzalny bez zmiany schematu.
export type ContactPurpose = {
  id: string;
  owner: string;
  key: string;
  label: string;
  color: string;
  position: number;
};

export type PurposeSeed = { key: string; label: string; color: string };

export const DEFAULT_PURPOSES: PurposeSeed[] = [
  { key: "ads", label: "Reklama", color: "#1A73E7" },
  { key: "website", label: "Strona WWW", color: "#00A3A3" },
  { key: "both", label: "Reklama + strona", color: "#6C5CE7" },
];

// Wpis historii celu kontaktu (append-only) — lead może być kontaktowany o
// wiele celów w czasie; nic nie jest nadpisywane.
export type ProspectPurpose = {
  id: string;
  owner: string;
  prospect_id: string;
  purpose: string;
  source: string; // 'job' | 'bulk' | 'manual'
  created_at: string;
};

// Minimalny kształt etapu używany w UI (wystarcza do etykiety/koloru).
export type StageLike = { key: string; label: string; color: string };

// Znajdź metadane etapu po kluczu na podanej liście (z fallbackiem).
export function stageMetaFrom<T extends StageLike>(stages: T[], key: Stage): T | StageLike {
  return stages.find((s) => s.key === key) ?? stages[0] ?? DEFAULT_STAGES[0];
}
