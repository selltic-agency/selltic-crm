-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — pełny transfer danych scrapera przy konwersji prospekt → deal.
-- ────────────────────────────────────────────────────────────────────────
-- Dotąd konwersja "Konwertuj na lead" wrzucała dane z Google Maps wyłącznie
-- do deals.props (jsonb) i mapowała tylko część pól. Ta migracja dodaje
-- dedykowane kolumny na deals, żeby KAŻDA właściwość zebrana podczas scrapowania
-- (ta sama, którą ma prospects) miała trwałe, odpytywalne miejsce także na
-- rekordzie deala. Idempotentna — można odpalić wielokrotnie.
--
-- Uruchom raz na istniejącej bazie (Supabase → SQL Editor), po
-- migration_prospecting_deals.sql.
-- ════════════════════════════════════════════════════════════════════════

alter table deals add column if not exists place_id              text;
alter table deals add column if not exists website               text;
alter table deals add column if not exists address               text;
alter table deals add column if not exists google_rating         numeric;   -- Google Maps rating (0–5)
alter table deals add column if not exists review_count          int;
alter table deals add column if not exists business_status       text;      -- np. 'OPERATIONAL'
alter table deals add column if not exists industry              text;
alter table deals add column if not exists city                  text;
alter table deals add column if not exists website_status        text;      -- 'none'|'active'|'broken'|'slow'
alter table deals add column if not exists lead_score            int;
alter table deals add column if not exists lead_score_breakdown  jsonb;

alter table deals drop constraint if exists deals_lead_score_check;
alter table deals add constraint deals_lead_score_check
  check (lead_score is null or (lead_score >= 0 and lead_score <= 100));

alter table deals drop constraint if exists deals_website_status_check;
alter table deals add constraint deals_website_status_check
  check (website_status is null or website_status in ('none', 'active', 'broken', 'slow'));

-- Odpytywanie/dedup po firmie z Google Maps również na poziomie dealów.
create index if not exists idx_deals_place_id on deals (place_id);
