-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — architektura headless scrapera (Faza: Scraper tab).
-- Dodaje scrape_jobs / scraped_leads / scraper_config. Uruchom raz na
-- istniejącej bazie (po schema.sql). Idempotentny (create if not exists,
-- drop policy if exists przed create).
--
-- Przepływ: CRM tworzy jeden wiersz scrape_jobs na kombinację
-- keyword × location, woła webhook na Cloud Run z samymi job_id (bez danych
-- leadów). Cloud Run (selltic-scraper, webhook_server.py) czyta zadanie,
-- scrapuje, zapisuje wynik do scraped_leads i aktualizuje status zadania.
-- scraped_leads to STAGING — osobne od `prospects`, aż użytkownik ręcznie
-- kliknie "Przenieś do Prospectingu".
-- ════════════════════════════════════════════════════════════════════════

-- ── ZADANIA SCRAPOWANIA ─────────────────────────────────────────────────
create table if not exists scrape_jobs (
  id              uuid primary key default gen_random_uuid(),
  owner           uuid not null references auth.users on delete cascade,
  keyword         text not null,
  location        text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'running', 'done', 'error')),
  results_count   int not null default 0,
  error_message   text,
  batch_id        uuid not null,     -- grupuje zadania z jednego kliknięcia "Rozpocznij scrapowanie"
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz
);

-- ── SUROWE WYNIKI SCRAPERA (staging, oddzielone od prospects) ───────────
create table if not exists scraped_leads (
  id                   uuid primary key default gen_random_uuid(),
  owner                uuid not null references auth.users on delete cascade,
  job_id               uuid not null references scrape_jobs on delete cascade,
  place_id             text not null,
  business_name        text not null,
  phone                text,
  address              text,
  website              text,
  rating               numeric,
  review_count         int,
  business_status      text,
  score                int,
  score_breakdown      jsonb,
  website_status       text check (website_status is null or website_status in ('brak', 'nie_dziala', 'dziala')),
  source_keyword       text not null,
  source_location      text not null,
  status               text not null default 'new'
                         check (status in ('new', 'moved', 'duplicate')),
  moved_to_prospect_id uuid references prospects on delete set null,
  scraped_at           timestamptz not null default now()
);

-- ── KONFIGURACJA SCRAPERA (edytowalna z CRM, czytana przez Cloud Run) ───
create table if not exists scraper_config (
  owner       uuid not null references auth.users on delete cascade,
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (owner, key)
);

-- ── INDEKSY ─────────────────────────────────────────────────────────────
create index if not exists idx_scrape_jobs_batch    on scrape_jobs (batch_id);
create index if not exists idx_scrape_jobs_status   on scrape_jobs (status);
create index if not exists idx_scrape_jobs_owner    on scrape_jobs (owner);
create index if not exists idx_scraped_leads_job    on scraped_leads (job_id);
create index if not exists idx_scraped_leads_score  on scraped_leads (score desc);
create index if not exists idx_scraped_leads_status on scraped_leads (status);
create unique index if not exists idx_scraped_leads_place_dedup on scraped_leads (owner, place_id);

-- ════════════════════════════════════════════════════════════════════════
-- RLS — tylko właściciel zarządza. Webhook Cloud Run pisze przez
-- SUPABASE_SERVICE_ROLE_KEY (omija RLS, autoryzacja przez bearer token
-- SCRAPER_WEBHOOK_SECRET na poziomie aplikacji, nie Supabase).
-- ════════════════════════════════════════════════════════════════════════
alter table scrape_jobs    enable row level security;
alter table scraped_leads  enable row level security;
alter table scraper_config enable row level security;

drop policy if exists "own scrape jobs" on scrape_jobs;
create policy "own scrape jobs" on scrape_jobs for all using (auth.uid() = owner) with check (auth.uid() = owner);
drop policy if exists "own scraped leads" on scraped_leads;
create policy "own scraped leads" on scraped_leads for all using (auth.uid() = owner) with check (auth.uid() = owner);
drop policy if exists "own scraper config" on scraper_config;
create policy "own scraper config" on scraper_config for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- ════════════════════════════════════════════════════════════════════════
-- REALTIME — Scraper tab w CRM subskrybuje zmiany na żywo (statusy zadań,
-- nowe/zmienione leady) zamiast pollingu.
-- ════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'scrape_jobs'
  ) then
    alter publication supabase_realtime add table scrape_jobs;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'scraped_leads'
  ) then
    alter publication supabase_realtime add table scraped_leads;
  end if;
end $$;
