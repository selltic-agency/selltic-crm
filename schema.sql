-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — schemat bazy (Forms + CRM + Prospecting)
-- Wklej całość w Supabase → SQL Editor → Run.
-- Solo admin: RLS opiera się na owner = auth.uid().
-- ════════════════════════════════════════════════════════════════════════

-- ── FORMULARZE ──────────────────────────────────────────────────────────
create table if not exists forms (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  title       text not null default 'Nowy formularz',
  slug        text unique,
  schema      jsonb not null default '{"steps":[],"theme":{}}',  -- WERSJA ROBOCZA
  published   jsonb,                                              -- WERSJA LIVE (zamrożona)
  status      text not null default 'draft',                      -- draft | published
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── ZGŁOSZENIA (surowe) ─────────────────────────────────────────────────
create table if not exists submissions (
  id          uuid primary key default gen_random_uuid(),
  form_id     uuid not null references forms on delete cascade,
  answers     jsonb not null,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

-- ── DEALE (CRM) — osoba/firma, która już okazała zainteresowanie ───────
-- Faza 10: kontakt i szansa sprzedaży połączone w jeden, samodzielny
-- rekord — każde zgłoszenie formularza tworzy NOWY deal (z własną kopią
-- tożsamości), zamiast dzielić trwałego kontaktu między wiele leadów.
create table if not exists deals (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  name        text,
  email       text,
  phone       text,
  company     text,
  props       jsonb not null default '{}',     -- wartości właściwości globalnych
  stage       text not null default 'new',     -- references pipeline_stages.key
  value       numeric not null default 0,
  source      text,                            -- 'form:wycena' | 'cold-call' | 'prospecting' ...
  form_id     uuid references forms on delete set null,
  assignee    text check (assignee is null or assignee in ('dominik', 'kuba')),  -- „Deal Owner”, ręczny
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,                      -- ustawiane gdy etap = is_won/is_lost
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── PROSPEKTY (CRM) — zimne leady z Google Maps, zanim wykażą zainteresowanie ──
-- Faza 10: zasilane przez zewnętrzny scraper (Google Maps, Cloud Run).
-- `place_id` to klucz Google Places — główny mechanizm odhaczania duplikatów.
create table if not exists prospects (
  id                       uuid primary key default gen_random_uuid(),
  owner                    uuid not null references auth.users on delete cascade,
  place_id                 text not null,
  name                     text not null,
  phone                    text,
  website                  text,                            -- null/puste = brak strony
  address                  text,
  rating                   numeric,
  review_count             int,
  business_status          text,                            -- np. 'OPERATIONAL' z Google Places
  industry                 text,
  city                     text,
  source                   text not null default 'google_maps_scraper',
  prospecting_status       text not null default 'new'
                             check (prospecting_status in ('new', 'contact_attempted', 'not_interested', 'converted')),
  created_at               timestamptz not null default now(),
  last_contact_attempt_at  timestamptz,
  note                     text,
  website_status           text check (website_status is null or website_status in ('none', 'active', 'broken', 'slow')),
  website_last_checked_at  timestamptz,
  lead_score               int check (lead_score is null or (lead_score >= 0 and lead_score <= 100)),
  lead_score_breakdown     jsonb,
  converted_deal_id        uuid references deals on delete set null,
  unique (place_id)
);

-- ── AKTYWNOŚCI (oś czasu deala) ──────────────────────────────────────────
create table if not exists activities (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  deal_id     uuid not null references deals on delete cascade,
  type        text not null,                   -- note|call|email|submission|stage
  body        text,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

-- submissions → deal, które utworzyło (ustawiane przez /api/submit po
-- utworzeniu deala; zasila widok Inbox).
alter table submissions add column if not exists deal_id uuid references deals on delete set null;
create index if not exists idx_submissions_deal on submissions (deal_id);

-- ── FLAGI DUPLIKATÓW ────────────────────────────────────────────────────
-- Faza 9.2: gdy nowe zgłoszenie ma telefon pasujący do INNEGO deala niż
-- ten, który właśnie powstał, odkładamy flagę do ręcznej weryfikacji (bez
-- automatycznego scalania — scalanie to osobna, przyszła faza).
create table if not exists duplicate_flags (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  deal_a      uuid not null references deals on delete cascade,
  deal_b      uuid not null references deals on delete cascade,
  reason      text not null,                 -- np. 'phone match, different email'
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── GLOBALNE DEFINICJE WŁAŚCIWOŚCI ──────────────────────────────────────
create table if not exists property_defs (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  key         text not null,
  type        text not null default 'text',    -- text|number|date|select
  options     jsonb,
  position    int not null default 0,
  unique (owner, key)
);

-- ── ETAPY LEJKA (konfigurowalne) ────────────────────────────────────────
-- Zastępują zaszyte na sztywno etapy. Każdy właściciel ma własny zestaw.
-- `key` jest stabilnym identyfikatorem (deals.stage przechowuje ten klucz
-- jako zwykły tekst — bez FK, dla prostoty). Etapy domyślne są zasiewane
-- leniwie w aplikacji przy pierwszym wczytaniu (po owner).
create table if not exists pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  key         text not null,
  label       text not null,
  color       text not null,
  position    int not null default 0,
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  unique (owner, key)
);

-- ── KONFIGURACJA WIDOKU TABELI ──────────────────────────────────────────
create table if not exists table_view_config (
  owner   uuid primary key references auth.users on delete cascade,
  columns jsonb not null default '[]'  -- [{ key: "name", visible: true, width: 200, position: 0 }, ...]
);

-- ── ZADANIA ─────────────────────────────────────────────────────────────
create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  deal_id     uuid references deals on delete set null,
  title       text not null,
  due_at      timestamptz,
  done        boolean not null default false,
  assignee    text check (assignee is null or assignee in ('dominik', 'kuba')),  -- „Deal Owner”, ręczny
  created_at  timestamptz not null default now()
);

-- ── POWIADOMIENIA (dzwonek w topbarze) ──────────────────────────────────
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  deal_id     uuid references deals on delete cascade,
  type        text not null default 'new_lead',   -- new_lead | ...
  body        text not null,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── USTAWIENIA UŻYTKOWNIKA ──────────────────────────────────────────────
create table if not exists app_settings (
  owner           uuid primary key references auth.users on delete cascade,
  email_new_lead  boolean not null default true,
  email_task_due  boolean not null default false,
  notify_email    text
);

-- ── INDEKSY ─────────────────────────────────────────────────────────────
create index if not exists idx_deals_owner_stage    on deals (owner, stage);
create index if not exists idx_deals_email          on deals (owner, email);
create unique index if not exists idx_prospects_place_id        on prospects (place_id);
create index if not exists idx_prospects_status     on prospects (prospecting_status);
create index if not exists idx_prospects_industry   on prospects (industry);
create index if not exists idx_prospects_city       on prospects (city);
create index if not exists idx_prospects_lead_score on prospects (lead_score);
create index if not exists idx_activities_deal      on activities (deal_id, created_at desc);
create index if not exists idx_submissions_form     on submissions (form_id, created_at desc);
create index if not exists idx_tasks_owner_due      on tasks (owner, due_at) where done = false;
create index if not exists idx_tasks_assignee       on tasks (assignee) where assignee is not null;
create index if not exists idx_notifications_owner  on notifications (owner, created_at desc) where read = false;

-- ── updated_at auto ─────────────────────────────────────────────────────
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists t_forms_touch on forms;
create trigger t_forms_touch before update on forms for each row execute function touch_updated_at();
drop trigger if exists t_deals_touch on deals;
create trigger t_deals_touch before update on deals for each row execute function touch_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- RLS — tylko właściciel zarządza; publiczny świat czyta opublikowane formy.
-- Zapis zgłoszeń idzie przez /api/submit z kluczem service_role (omija RLS),
-- więc NIE dajemy publicznej polityki INSERT na submissions/deals.
-- Import prospektów idzie przez /api/prospecting/* z kluczem service_role
-- (autoryzacja przez X-API-Key, omija RLS) — to samo dotyczy prospects.
-- ════════════════════════════════════════════════════════════════════════
alter table forms         enable row level security;
alter table submissions   enable row level security;
alter table deals         enable row level security;
alter table prospects     enable row level security;
alter table activities    enable row level security;
alter table duplicate_flags enable row level security;
alter table property_defs enable row level security;
alter table tasks         enable row level security;
alter table app_settings  enable row level security;
alter table notifications enable row level security;
alter table pipeline_stages enable row level security;
alter table table_view_config enable row level security;

-- Właściciel: pełny dostęp do swoich danych
create policy "own forms"        on forms         for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own submissions"  on submissions   for select using (auth.uid() = (select owner from forms where forms.id = submissions.form_id));
create policy "own deals"        on deals         for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own prospects"    on prospects     for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own dup flags"    on duplicate_flags for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own activities"   on activities    for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own defs"         on property_defs for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own tasks"        on tasks         for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own settings"     on app_settings  for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own notifications" on notifications for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own stages"        on pipeline_stages for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own table config"  on table_view_config for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- Publiczny: czytanie WYŁĄCZNIE opublikowanych formularzy (do renderu /f/[slug])
create policy "public reads published" on forms for select using (status = 'published');
