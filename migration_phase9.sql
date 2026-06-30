-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — MIGRACJA do Fazy 9 (rozdział contacts → contacts + leads)
-- ────────────────────────────────────────────────────────────────────────
-- schema.sql używa `create table if not exists`, więc PONOWNE uruchomienie go
-- NIE zmieni istniejących tabel (z faz 1-8). Ten plik dorabia brakujące
-- kolumny/tabele na ISTNIEJĄCEJ bazie. Uruchom raz: Supabase → SQL Editor.
-- Brak danych produkcyjnych → usuwamy przeniesione kolumny wprost (bez backfill).
-- Idempotentny — można odpalić wielokrotnie bez błędów.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Tabela leadów (szansa sprzedaży przypięta do kontaktu).
create table if not exists leads (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  contact_id  uuid not null references contacts on delete cascade,
  stage       text not null default 'new',
  value       numeric not null default 0,
  source      text,
  form_id     uuid references forms on delete set null,
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_leads_owner_stage on leads (owner, stage);
create index if not exists idx_leads_contact      on leads (contact_id, opened_at desc);

-- 2. activities.lead_id (oś czasu leada). TO naprawia zapis notatek z lead_id.
alter table activities add column if not exists lead_id uuid references leads on delete set null;
create index if not exists idx_activities_lead on activities (lead_id, created_at desc);

-- 3. Flagi duplikatów (Faza 9.2).
create table if not exists duplicate_flags (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  contact_a   uuid not null references contacts on delete cascade,
  contact_b   uuid not null references contacts on delete cascade,
  reason      text not null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 4. Usuń kolumny przeniesione z contacts na leads (bez danych do zachowania).
drop index if exists idx_contacts_owner_stage;
alter table contacts drop column if exists stage;
alter table contacts drop column if exists value;
alter table contacts drop column if exists source;
alter table contacts drop column if exists form_id;

-- 5. Trigger updated_at dla leads (funkcja touch_updated_at() już istnieje).
drop trigger if exists t_leads_touch on leads;
create trigger t_leads_touch before update on leads for each row execute function touch_updated_at();

-- 6. RLS — właściciel ma pełny dostęp (spójnie z resztą tabel).
alter table leads           enable row level security;
alter table duplicate_flags enable row level security;

drop policy if exists "own leads" on leads;
create policy "own leads" on leads for all using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists "own dup flags" on duplicate_flags;
create policy "own dup flags" on duplicate_flags for all using (auth.uid() = owner) with check (auth.uid() = owner);
