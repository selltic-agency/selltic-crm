-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — schemat bazy (Forms + CRM)
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

-- ── KONTAKTY (CRM) — tożsamość osoby/firmy ──────────────────────────────
-- Faza 9.1: kontakt to TRWAŁA tożsamość. Etap/wartość/źródło/formularz
-- przeniesione do tabeli `leads` (jeden kontakt może mieć wiele leadów).
create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  name        text,
  email       text,
  phone       text,
  company     text,
  props       jsonb not null default '{}',     -- wartości właściwości globalnych
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner, email)                         -- pozwala na upsert po emailu
);

-- ── LEADY (CRM) — pojedyncza szansa sprzedaży, przypięta do kontaktu ─────
-- Faza 9.1: to tu żyje etap lejka, wartość, źródło i powiązany formularz.
-- Kontakt może mieć wiele leadów w czasie (osobne szanse sprzedaży).
create table if not exists leads (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  contact_id  uuid not null references contacts on delete cascade,
  stage       text not null default 'new',     -- references pipeline_stages.key
  value       numeric not null default 0,
  source      text,                            -- 'form:wycena' | 'cold-call' ...
  form_id     uuid references forms on delete set null,
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,                      -- ustawiane gdy etap = is_won/is_lost
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── AKTYWNOŚCI (oś czasu) ───────────────────────────────────────────────
-- contact_id zawsze ustawione (oś czasu kontaktu). lead_id ustawiane tylko,
-- gdy aktywność powstała w kontekście konkretnego leada (oś czasu leada).
create table if not exists activities (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  contact_id  uuid not null references contacts on delete cascade,
  lead_id     uuid references leads on delete set null,
  type        text not null,                   -- note|call|email|submission|stage
  body        text,
  meta        jsonb,
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
-- `key` jest stabilnym identyfikatorem (contacts.stage przechowuje ten klucz
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
  contact_id  uuid references contacts on delete set null,
  title       text not null,
  due_at      timestamptz,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── POWIADOMIENIA (dzwonek w topbarze) ──────────────────────────────────
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  contact_id  uuid references contacts on delete cascade,
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
create index if not exists idx_leads_owner_stage    on leads (owner, stage);
create index if not exists idx_leads_contact         on leads (contact_id, opened_at desc);
create index if not exists idx_activities_contact   on activities (contact_id, created_at desc);
create index if not exists idx_activities_lead       on activities (lead_id, created_at desc);
create index if not exists idx_submissions_form      on submissions (form_id, created_at desc);
create index if not exists idx_tasks_owner_due       on tasks (owner, due_at) where done = false;
create index if not exists idx_notifications_owner    on notifications (owner, created_at desc) where read = false;

-- ── updated_at auto ─────────────────────────────────────────────────────
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists t_forms_touch on forms;
create trigger t_forms_touch before update on forms for each row execute function touch_updated_at();
drop trigger if exists t_contacts_touch on contacts;
create trigger t_contacts_touch before update on contacts for each row execute function touch_updated_at();
drop trigger if exists t_leads_touch on leads;
create trigger t_leads_touch before update on leads for each row execute function touch_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- RLS — tylko właściciel zarządza; publiczny świat czyta opublikowane formy.
-- Zapis zgłoszeń idzie przez /api/submit z kluczem service_role (omija RLS),
-- więc NIE dajemy publicznej polityki INSERT na submissions/contacts.
-- ════════════════════════════════════════════════════════════════════════
alter table forms         enable row level security;
alter table submissions   enable row level security;
alter table contacts      enable row level security;
alter table leads         enable row level security;
alter table activities    enable row level security;
alter table property_defs enable row level security;
alter table tasks         enable row level security;
alter table app_settings  enable row level security;
alter table notifications enable row level security;
alter table pipeline_stages enable row level security;
alter table table_view_config enable row level security;

-- Właściciel: pełny dostęp do swoich danych
create policy "own forms"        on forms         for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own submissions"  on submissions   for select using (auth.uid() = (select owner from forms where forms.id = submissions.form_id));
create policy "own contacts"     on contacts      for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own leads"        on leads         for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own activities"   on activities    for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own defs"         on property_defs for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own tasks"        on tasks         for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own settings"     on app_settings  for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own notifications" on notifications for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own stages"        on pipeline_stages for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own table config"  on table_view_config for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- Publiczny: czytanie WYŁĄCZNIE opublikowanych formularzy (do renderu /f/[slug])
create policy "public reads published" on forms for select using (status = 'published');
