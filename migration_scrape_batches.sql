-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — sterowanie zadaniami scrapera (pauza / stop / wznów) + historia.
--
-- Wprowadza pojęcie PACZKI (scrape_batches) jako jednostki, którą użytkownik
-- uruchamia jednym kliknięciem "Rozpocznij scrapowanie". Dotąd paczka istniała
-- tylko jako scrape_jobs.batch_id (UUID bez własnego wiersza), więc nie było
-- gdzie trzymać jej statusu ani sygnału sterującego. Teraz:
--
--   • scrape_batches trzyma status paczki: running | paused | stopped | completed
--     oraz metadane nagłówka (keywords, locations, created_at) dla zwiniętego
--     wiersza w UI i dla paginowanej historii — bez ładowania wszystkich zadań.
--   • backend (webhook_server.py) sprawdza scrape_batches.status PRZED każdym
--     zadaniem: 'paused' → przerywa (pozostawia pending), 'stopped' → anuluje
--     pozostałe pending. Dzięki temu pauza realnie wstrzymuje pracę, a nie tylko
--     chowa ją w UI.
--   • scrape_jobs zyskuje status 'canceled' — dla zadań pending anulowanych
--     przez STOP (nieodwracalnie; leady już znalezione zostają).
--
-- Uruchom raz w Supabase SQL editor (po migration_scraper.sql). Idempotentny.
-- ════════════════════════════════════════════════════════════════════════

-- ── PACZKI SCRAPOWANIA ──────────────────────────────────────────────────
create table if not exists scrape_batches (
  id          uuid primary key,          -- == scrape_jobs.batch_id (nadawany przez CRM)
  owner       uuid not null references auth.users on delete cascade,
  keywords    text[] not null default '{}',
  locations   text[] not null default '{}',
  total_jobs  int not null default 0,    -- liczba zadań keyword×location w paczce
  status      text not null default 'running'
                check (status in ('running', 'paused', 'stopped', 'completed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_scrape_batches_owner   on scrape_batches (owner);
create index if not exists idx_scrape_batches_created on scrape_batches (created_at desc);

-- ── BACKFILL — odtwórz paczki dla zadań sprzed tej migracji ─────────────
-- Bez tego historyczne scrape_jobs (mające batch_id, ale bez wiersza paczki)
-- zniknęłyby z nowego UI, które listuje po scrape_batches. Odtwarzamy jeden
-- wiersz na batch_id: metadane z zadań, status 'completed' gdy nic już nie
-- czeka/nie trwa, inaczej 'running' (watchdog/backend je domknie).
insert into scrape_batches (id, owner, keywords, locations, total_jobs, status, created_at, updated_at)
select
  j.batch_id,
  (array_agg(j.owner))[1]                                    as owner,
  array(select distinct keyword  from scrape_jobs where batch_id = j.batch_id order by 1) as keywords,
  array(select distinct location from scrape_jobs where batch_id = j.batch_id order by 1) as locations,
  count(*)                                                   as total_jobs,
  case when count(*) filter (where j.status in ('pending', 'running')) = 0
       then 'completed' else 'running' end                  as status,
  min(j.created_at)                                          as created_at,
  now()                                                      as updated_at
from scrape_jobs j
where not exists (select 1 from scrape_batches b where b.id = j.batch_id)
group by j.batch_id;

-- ── scrape_jobs.status: dodaj 'canceled' (STOP anuluje pozostałe pending) ─
-- Check constraint przepisujemy, bo Postgres nie ma "alter check in place".
alter table scrape_jobs drop constraint if exists scrape_jobs_status_check;
alter table scrape_jobs
  add constraint scrape_jobs_status_check
  check (status in ('pending', 'running', 'done', 'error', 'canceled'));

-- ── RLS — tylko właściciel. Backend pisze przez SERVICE_ROLE (omija RLS). ─
alter table scrape_batches enable row level security;
drop policy if exists "own scrape batches" on scrape_batches;
create policy "own scrape batches" on scrape_batches
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- ── REALTIME — status paczki (pauza/stop/wznów/zakończono) na żywo w UI. ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'scrape_batches'
  ) then
    alter publication supabase_realtime add table scrape_batches;
  end if;
end $$;
