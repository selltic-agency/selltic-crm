-- ════════════════════════════════════════════════════════════════════════
-- Wyszukiwanie telefonu odporne na formatowanie (globalna wyszukiwarka).
-- Denormalizowana, generowana kolumna „phone_digits” (same cyfry) na dealach
-- i prospektach + indeksy trigramowe (pg_trgm) dla szybkiego LIKE/ILIKE
-- z wiodącym znakiem wieloznacznym (%digits%).
-- Wklej w Supabase → SQL Editor → Run (bezpieczne do wielokrotnego uruchomienia).
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

-- DEALE
alter table deals add column if not exists phone_digits text
  generated always as (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) stored;
create index if not exists idx_deals_phone_digits_trgm
  on deals using gin (phone_digits gin_trgm_ops);

-- PROSPEKTY
alter table prospects add column if not exists phone_digits text
  generated always as (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) stored;
create index if not exists idx_prospects_phone_digits_trgm
  on prospects using gin (phone_digits gin_trgm_ops);
