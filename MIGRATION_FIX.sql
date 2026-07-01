-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — MIGRACJA NAPRAWCZA: leads → deals (Faza 10)
-- ────────────────────────────────────────────────────────────────────────
-- Jeśli widzisz błąd "Could not find the table 'public.deals'", uruchom
-- ten skrypt w Supabase SQL Editor. Jest idempotentny.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Zmiana nazwy leads → deals (jeśli jeszcze istnieje stary model)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'leads')
     and not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'deals') then
    alter table public.leads rename to deals;
  end if;
end $$;

-- 2. Upewnij się, że tabela deals istnieje (gdyby nie było ani leads ani deals)
create table if not exists public.deals (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  name        text,
  email       text,
  phone       text,
  company     text,
  props       jsonb not null default '{}',
  stage       text not null default 'new',
  value       numeric not null default 0,
  source      text,
  opened_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3. Upewnij się, że tabela deals ma wszystkie kolumny z Fazy 10
alter table public.deals add column if not exists name    text;
alter table public.deals add column if not exists email   text;
alter table public.deals add column if not exists phone   text;
alter table public.deals add column if not exists company text;
alter table public.deals add column if not exists props   jsonb not null default '{}';
alter table public.deals add column if not exists form_id uuid references public.forms on delete set null;
alter table public.deals add column if not exists assignee text check (assignee is null or assignee in ('dominik', 'kuba'));
alter table public.deals add column if not exists closed_at timestamptz;
alter table public.deals drop column if exists contact_id;

-- 4. Aktualizacja powiązań w innych tabelach
-- activities
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activities' and column_name = 'lead_id') then
    alter table public.activities rename column lead_id to deal_id;
  end if;
end $$;

-- Jeśli deal_id nie istnieje (nawet po rename), dodaj go
alter table public.activities add column if not exists deal_id uuid references public.deals (id) on delete cascade;
-- Jeśli są rekordy bez deal_id, usuwamy je (activities wymagają deal_id w Fazie 10)
delete from public.activities where deal_id is null;
alter table public.activities alter column deal_id set not null;

alter table public.activities drop constraint if exists activities_lead_id_fkey;
alter table public.activities drop constraint if exists activities_deal_id_fkey;
alter table public.activities add constraint activities_deal_id_fkey
  foreign key (deal_id) references public.deals (id) on delete cascade;

-- tasks
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'contact_id') then
    alter table public.tasks rename column contact_id to deal_id;
  end if;
end $$;
alter table public.tasks add column if not exists deal_id uuid references public.deals (id) on delete set null;
alter table public.tasks drop constraint if exists tasks_contact_id_fkey;
alter table public.tasks drop constraint if exists tasks_deal_id_fkey;
alter table public.tasks add constraint tasks_deal_id_fkey
  foreign key (deal_id) references public.deals (id) on delete set null;

-- submissions
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'submissions' and column_name = 'lead_id') then
    alter table public.submissions rename column lead_id to deal_id;
  end if;
end $$;
alter table public.submissions add column if not exists deal_id uuid references public.deals (id) on delete set null;
alter table public.submissions drop column if exists contact_id;

-- notifications
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'contact_id') then
    alter table public.notifications rename column contact_id to deal_id;
  end if;
end $$;
alter table public.notifications add column if not exists deal_id uuid references public.deals (id) on delete cascade;
alter table public.notifications drop constraint if exists notifications_contact_id_fkey;
alter table public.notifications drop constraint if exists notifications_deal_id_fkey;
alter table public.notifications add constraint notifications_deal_id_fkey
  foreign key (deal_id) references public.deals (id) on delete cascade;

-- duplicate_flags
alter table public.duplicate_flags drop column if exists contact_a;
alter table public.duplicate_flags drop column if exists contact_b;
alter table public.duplicate_flags add column if not exists deal_a uuid references public.deals on delete cascade;
alter table public.duplicate_flags add column if not exists deal_b uuid references public.deals on delete cascade;

-- 5. contacts → prospects (jeśli jeszcze nie zmieniono)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'contacts')
     and not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'prospects') then
    alter table public.contacts rename to prospects;
  end if;
end $$;

-- 6. Indeksy i RLS
drop index if exists public.idx_leads_owner_stage;
create index if not exists idx_deals_owner_stage on public.deals (owner, stage);
create index if not exists idx_deals_email       on public.deals (owner, email);
create index if not exists idx_activities_deal   on public.activities (deal_id, created_at desc);
create index if not exists idx_submissions_deal  on public.submissions (deal_id);

alter table public.deals enable row level security;
drop policy if exists "own leads" on public.deals;
drop policy if exists "own deals" on public.deals;
create policy "own deals" on public.deals for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- 7. Trigger updated_at
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists t_deals_touch on public.deals;
create trigger t_deals_touch before update on public.deals for each row execute function public.touch_updated_at();

-- Wymuszenie odświeżenia cache PostgREST
notify pgrst, 'reload schema';
