-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — Feature 2: CEL KONTAKTU dla leadów (Reklama / Strona / Oba…).
--
-- Niezależny od kategorii, WIELOWARTOŚCIOWY z historią: lead może być
-- kontaktowany o różne cele w czasie (raz o reklamę, później o stronę) — nic
-- nie jest nadpisywane. Słownik wartości jest rozszerzalny bez zmiany schematu.
--
-- Model:
--   contact_purposes   — słownik wartości (ads/website/both…), zasiewany per-owner.
--   prospect_purposes  — append-only historia otagowań (kto, kiedy, skąd).
--   prospects.purposes — zdenormalizowany BIEŻĄCY zbiór (text[]) do szybkiego
--                        filtrowania (GIN) i badge'y; historia żyje osobno.
--   scrape_batches/jobs/scraped_leads.contact_purpose — cel wybrany dla paczki,
--                        propagowany w dół (tym samym triggerem co kategoria).
--
-- Uruchom raz w Supabase SQL editor (po migration_lead_categories.sql).
-- Idempotentny.
-- ════════════════════════════════════════════════════════════════════════

-- ── SŁOWNIK CELÓW KONTAKTU (zasiewany per-owner w aplikacji) ──────────────
create table if not exists contact_purposes (
  id        uuid primary key default gen_random_uuid(),
  owner     uuid not null references auth.users on delete cascade,
  key       text not null,
  label     text not null,
  color     text not null default '#1A73E7',
  position  int  not null default 0,
  unique (owner, key)
);

-- ── HISTORIA CELÓW (append-only) ──────────────────────────────────────────
create table if not exists prospect_purposes (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null references auth.users on delete cascade,
  prospect_id  uuid not null references prospects on delete cascade,
  purpose      text not null,               -- contact_purposes.key
  source       text not null default 'manual',  -- 'job' | 'bulk' | 'manual'
  created_at   timestamptz not null default now()
);
create index if not exists idx_prospect_purposes_prospect on prospect_purposes (prospect_id, created_at desc);

-- ── ZDENORMALIZOWANY BIEŻĄCY ZBIÓR na prospekcie (do filtra + badge'y) ────
alter table prospects add column if not exists purposes text[] not null default '{}';
create index if not exists idx_prospects_purposes on prospects using gin (purposes);

-- ── CEL wybrany dla paczki, propagowany w dół łańcucha ────────────────────
alter table scrape_batches add column if not exists contact_purpose text;
alter table scrape_jobs     add column if not exists contact_purpose text;
alter table scraped_leads   add column if not exists contact_purpose text;

-- ── Rozszerz trigger klasyfikacji o contact_purpose ───────────────────────
-- (definicja bazowa — z samą kategorią — jest w migration_lead_categories.sql)
create or replace function copy_scrape_meta_to_lead() returns trigger as $$
begin
  if new.category is null then
    select category into new.category from scrape_jobs where id = new.job_id;
  end if;
  if new.contact_purpose is null then
    select contact_purpose into new.contact_purpose from scrape_jobs where id = new.job_id;
  end if;
  return new;
end;
$$ language plpgsql;

-- ── RLS — tylko właściciel. ───────────────────────────────────────────────
alter table contact_purposes  enable row level security;
alter table prospect_purposes enable row level security;

drop policy if exists "own contact purposes" on contact_purposes;
create policy "own contact purposes" on contact_purposes
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists "own prospect purposes" on prospect_purposes;
create policy "own prospect purposes" on prospect_purposes
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
