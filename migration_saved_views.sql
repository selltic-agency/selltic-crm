-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — dodaje `saved_views` (zapisane widoki, HubSpot-style).
-- Uruchom raz na istniejącej bazie: Supabase → SQL Editor. Idempotentny —
-- można odpalić wielokrotnie bez błędów. Domyślne widoki ("Wszystkie
-- leady", "Wygrane", "Przegrane", "Wszystkie", "Do zadzwonienia",
-- "Wysokie priorytety") są zasiewane leniwie w aplikacji, nie tutaj.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists saved_views (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  page        text not null,                   -- 'deals' | 'prospecting'
  name        text not null,
  view_mode   text not null default 'kanban',  -- kanban | table
  filters     jsonb not null default '[]',
  sort        jsonb,
  position    int not null default 0,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table saved_views enable row level security;

drop policy if exists "own saved views" on saved_views;
create policy "own saved views" on saved_views
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- Wymuszenie odświeżenia cache schematu PostgREST — bez tego świeżo utworzona
-- tabela bywa niewidoczna dla API (błąd PGRST205) i zapis widoków nie działa.
notify pgrst, 'reload schema';
