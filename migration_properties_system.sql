-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — Uogólniony system WŁAŚCIWOŚCI (custom fields, HubSpot/Notion-style)
--
-- Rozszerza istniejącą tabelę property_defs o:
--   • label      — nazwa wyświetlana (klucz `key` pozostaje stabilnym slugiem),
--   • archived_at — miękkie usunięcie (nie kasujemy danych właściwości),
--   • nowe typy   — kolumna `type` nie ma CHECK-a, więc dopuszcza dodatkowe
--                   wartości: 'multi_select' | 'boolean' | 'email' obok
--                   dotychczasowych 'text' | 'number' | 'date' | 'select'.
--   • options     — pozostaje jsonb; dla list trzymamy [{key,label,color?}] lub
--                   (wstecznie) ["opcja", ...]; kod normalizuje oba kształty.
--
-- Model HYBRYDOWY: „Kategoria" i „Cel kontaktu" pozostają w swoich dedykowanych
-- kolumnach/tabelach (lead_categories, contact_purposes, deals.category,
-- prospects.category, prospects.purposes) i są prezentowane jako WBUDOWANE
-- właściwości systemowe. Dzięki temu potok scrapera i triggery są nietknięte,
-- a istniejące dane zachowane bez migracji.
--
-- Nowość: deals.purposes — żeby „Cel kontaktu" (multi-select) działał także na
-- liście Leadów (dotąd istniał tylko na prospektach). Kolumna addytywna,
-- domyślnie pusta; przy konwersji prospekt → deal cele są kopiowane.
--
-- Uruchom raz w Supabase → SQL Editor. Idempotentny.
-- ════════════════════════════════════════════════════════════════════════

-- ── Rozszerzenie definicji właściwości ────────────────────────────────────
alter table property_defs add column if not exists label       text;
alter table property_defs add column if not exists archived_at timestamptz;

-- ── „Cel kontaktu" także na deals (wielowartościowy, jak na prospektach) ───
alter table deals add column if not exists purposes text[] not null default '{}';
create index if not exists idx_deals_purposes on deals using gin (purposes);

-- ── Historia celów kontaktu dla deali (append-only, spójne z prospektami) ─
create table if not exists deal_purposes (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  deal_id     uuid not null references deals on delete cascade,
  purpose     text not null,                    -- contact_purposes.key
  source      text not null default 'manual',   -- 'convert' | 'bulk' | 'manual'
  created_at  timestamptz not null default now()
);
create index if not exists idx_deal_purposes_deal on deal_purposes (deal_id, created_at desc);

alter table deal_purposes enable row level security;
drop policy if exists "own deal purposes" on deal_purposes;
create policy "own deal purposes" on deal_purposes
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
