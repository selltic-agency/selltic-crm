-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — Feature 1: KATEGORIA BRANŻY dla leadów.
--
-- Wprowadza kuratorowaną klasyfikację leadów wg 13 stałych kategorii
-- medyczno-okołozdrowotnych oraz mapowanie „słowo kluczowe scrapera → kategoria”
-- (wiele słów → jedna kategoria), zarządzane w Ustawieniach.
--
-- Propagacja (żaden lead nie zostaje bez kategorii po cichu):
--   scrape_jobs.category   ← rozstrzygane z category_keywords przy tworzeniu
--                             zadania (/api/scraper/start).
--   scraped_leads.category ← kopiowane z zadania TRIGGEREM (backend scrapera na
--                             Cloud Run zostaje NIETKNIĘTY — pisze tylko job_id).
--   prospects.category     ← ustawiane przy „Przenieś do Prospectingu”.
--   deals.category         ← przenoszone przy konwersji prospekt → deal.
--
-- Uruchom raz w Supabase SQL editor (po schema.sql i migration_scraper.sql).
-- Idempotentny (create if not exists, drop policy/trigger if exists).
-- ════════════════════════════════════════════════════════════════════════

-- ── KATEGORIE (zasiewane per-owner w aplikacji, jak pipeline_stages) ──────
create table if not exists lead_categories (
  id        uuid primary key default gen_random_uuid(),
  owner     uuid not null references auth.users on delete cascade,
  key       text not null,             -- stabilny slug trzymany na leadach jako tekst
  label     text not null,
  color     text not null default '#6C5CE7',
  position  int  not null default 0,
  unique (owner, key)
);

-- ── MAPOWANIE słowo kluczowe → kategoria (wiele słów → jedna kategoria) ────
-- `category_key` to lead_categories.key (tekst, bez FK — spójnie z deals.stage).
create table if not exists category_keywords (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null references auth.users on delete cascade,
  keyword       text not null,
  category_key  text not null,
  created_at    timestamptz not null default now(),
  unique (owner, keyword)
);
create index if not exists idx_category_keywords_owner on category_keywords (owner);
create index if not exists idx_category_keywords_cat   on category_keywords (owner, category_key);

-- ── KOLUMNA `category` na całym łańcuchu leada ────────────────────────────
alter table scrape_jobs   add column if not exists category text;
alter table scraped_leads add column if not exists category text;
alter table prospects     add column if not exists category text;
alter table deals         add column if not exists category text;

create index if not exists idx_prospects_category on prospects (category);
create index if not exists idx_deals_category     on deals (category);

-- ── TRIGGER: skopiuj klasyfikację z zadania na świeżo zescrapowany lead ────
-- Backend scrapera wstawia scraped_leads z samym job_id — trigger dolicza
-- category po stronie bazy, więc backend nie musi wiedzieć o kategoriach.
-- (migration_contact_purposes.sql rozszerza tę funkcję o contact_purpose.)
create or replace function copy_scrape_meta_to_lead() returns trigger as $$
begin
  if new.category is null then
    select category into new.category from scrape_jobs where id = new.job_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists t_scraped_leads_meta on scraped_leads;
create trigger t_scraped_leads_meta
  before insert on scraped_leads
  for each row execute function copy_scrape_meta_to_lead();

-- ── RLS — tylko właściciel zarządza swoimi kategoriami i mapowaniem. ──────
alter table lead_categories   enable row level security;
alter table category_keywords enable row level security;

drop policy if exists "own lead categories" on lead_categories;
create policy "own lead categories" on lead_categories
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists "own category keywords" on category_keywords;
create policy "own category keywords" on category_keywords
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
