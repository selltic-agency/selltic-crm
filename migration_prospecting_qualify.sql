-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — MIGRACJA: kwalifikacja prospektów → kontakt + deal
-- ────────────────────────────────────────────────────────────────────────
-- Uruchom raz na istniejącej bazie (po schema.sql i migration_prospecting_deals.sql):
-- Supabase → SQL Editor. Idempotentny — można odpalić wielokrotnie bez błędów.
--
-- Co się dzieje:
--   1. Nowa tabela `contacts` — lekka tożsamość (imię/telefon/firma), używana
--      WYŁĄCZNIE do grupowania deali powstałych z kwalifikacji prospektów
--      (dedup po telefonie). Nie zastępuje modelu deali z Fazy 10 — to
--      dodatkowe, opcjonalne powiązanie (deals.contact_id, nullable).
--   2. `prospects` dostaje `converted_contact_id`, `priority_label`,
--      `score_reasons` — pola z rozszerzonego payloadu scrapera.
--   3. `website_status` przestaje być ograniczony sztywną listą wartości —
--      scraper może przysyłać nowe etykiety (np. 'outdated') bez migracji.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Kontakty (tożsamość powiązana z deal przy kwalifikacji prospektu).
create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  name        text,
  phone       text,
  company     text,
  props       jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists idx_contacts_owner_phone
  on contacts (owner, phone) where phone is not null;

alter table contacts enable row level security;
drop policy if exists "own contacts" on contacts;
create policy "own contacts" on contacts for all using (auth.uid() = owner) with check (auth.uid() = owner);

drop trigger if exists t_contacts_touch on contacts;
create trigger t_contacts_touch before update on contacts for each row execute function touch_updated_at();

-- 2. deals → opcjonalne powiązanie z kontaktem.
alter table deals add column if not exists contact_id uuid references contacts on delete set null;
create index if not exists idx_deals_contact on deals (contact_id);

-- 3. prospects → wynik kwalifikacji + rozszerzone pola scrapera.
alter table prospects add column if not exists converted_contact_id uuid references contacts on delete set null;
alter table prospects add column if not exists priority_label text;
alter table prospects add column if not exists score_reasons jsonb;

-- website_status: uwolnij od sztywnej listy — scraper przysyła własne etykiety.
alter table prospects drop constraint if exists prospects_website_status_check;
