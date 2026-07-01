-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — MIGRACJA NAPRAWCZA V2: leads → deals (Faza 10)
-- ────────────────────────────────────────────────────────────────────────
-- Naprawia błędy naruszenia kluczy obcych (foreign key violations)
-- przy migrowaniu zadań i aktywności do nowego modelu "Deal".
-- ════════════════════════════════════════════════════════════════════════

-- 1. Zmiana nazwy leads → deals
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'leads')
     and not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'deals') then
    alter table public.leads rename to deals;
  end if;
end $$;

-- 2. Upewnij się, że tabela deals istnieje
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

-- 3. Rozszerzenie kolumn deals
alter table public.deals add column if not exists name    text;
alter table public.deals add column if not exists email   text;
alter table public.deals add column if not exists phone   text;
alter table public.deals add column if not exists company text;
alter table public.deals add column if not exists props   jsonb not null default '{}';
alter table public.deals add column if not exists form_id uuid references public.forms on delete set null;
alter table public.deals add column if not exists assignee text check (assignee is null or assignee in ('dominik', 'kuba'));
alter table public.deals add column if not exists closed_at timestamptz;
alter table public.deals drop column if exists contact_id;

-- 4. contacts → prospects (zmiana nazwy identyczna jak w Faza 10)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'contacts')
     and not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'prospects') then
    alter table public.contacts rename to prospects;
  end if;
end $$;

-- 5. Naprawa i migracja zadań (tasks)
-- Jeśli mamy starą kolumnę contact_id, spróbujmy ją zmienić na deal_id
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'contact_id') then
    alter table public.tasks rename column contact_id to deal_id;
  end if;
end $$;
alter table public.tasks add column if not exists deal_id uuid;

-- KLUCZOWE: Wyczyść deal_id, które nie wskazują na istniejące deale
-- (Mogły wcześniej wskazywać na kontakty, które nie są leadami/dealami)
update public.tasks set deal_id = null where deal_id is not null and deal_id not in (select id from public.deals);

-- Teraz bezpiecznie nałóż klucz obcy
alter table public.tasks drop constraint if exists tasks_contact_id_fkey;
alter table public.tasks drop constraint if exists tasks_deal_id_fkey;
alter table public.tasks add constraint tasks_deal_id_fkey
  foreign key (deal_id) references public.deals (id) on delete set null;

-- 6. Naprawa i migracja aktywności (activities)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activities' and column_name = 'lead_id') then
    alter table public.activities rename column lead_id to deal_id;
  end if;
end $$;
alter table public.activities add column if not exists deal_id uuid;

-- Activities wymagają deal_id (NOT NULL). Jeśli rekord jest sierotą, usuwamy go.
delete from public.activities where deal_id is not null and deal_id not in (select id from public.deals);
delete from public.activities where deal_id is null;

alter table public.activities alter column deal_id set not null;
alter table public.activities drop constraint if exists activities_lead_id_fkey;
alter table public.activities drop constraint if exists activities_deal_id_fkey;
alter table public.activities add constraint activities_deal_id_fkey
  foreign key (deal_id) references public.deals (id) on delete cascade;

-- 7. Naprawa zgłoszeń (submissions)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'submissions' and column_name = 'lead_id') then
    alter table public.submissions rename column lead_id to deal_id;
  end if;
end $$;
alter table public.submissions add column if not exists deal_id uuid;
update public.submissions set deal_id = null where deal_id is not null and deal_id not in (select id from public.deals);
alter table public.submissions drop column if exists contact_id;
alter table public.submissions drop constraint if exists submissions_lead_id_fkey;
alter table public.submissions drop constraint if exists submissions_deal_id_fkey;
alter table public.submissions add constraint submissions_deal_id_fkey
  foreign key (deal_id) references public.deals (id) on delete set null;

-- 8. Naprawa powiadomień (notifications)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'contact_id') then
    alter table public.notifications rename column contact_id to deal_id;
  end if;
end $$;
alter table public.notifications add column if not exists deal_id uuid;
update public.notifications set deal_id = null where deal_id is not null and deal_id not in (select id from public.deals);
alter table public.notifications drop constraint if exists notifications_contact_id_fkey;
alter table public.notifications drop constraint if exists notifications_deal_id_fkey;
alter table public.notifications add constraint notifications_deal_id_fkey
  foreign key (deal_id) references public.deals (id) on delete cascade;

-- 9. Naprawa flag duplikatów (duplicate_flags)
alter table public.duplicate_flags drop column if exists contact_a;
alter table public.duplicate_flags drop column if exists contact_b;
alter table public.duplicate_flags add column if not exists deal_a uuid;
alter table public.duplicate_flags add column if not exists deal_b uuid;
delete from public.duplicate_flags where deal_a is not null and deal_a not in (select id from public.deals);
delete from public.duplicate_flags where deal_b is not null and deal_b not in (select id from public.deals);
alter table public.duplicate_flags drop constraint if exists duplicate_flags_deal_a_fkey;
alter table public.duplicate_flags drop constraint if exists duplicate_flags_deal_b_fkey;
alter table public.duplicate_flags add constraint duplicate_flags_deal_a_fkey foreign key (deal_a) references public.deals (id) on delete cascade;
alter table public.duplicate_flags add constraint duplicate_flags_deal_b_fkey foreign key (deal_b) references public.deals (id) on delete cascade;

-- 10. Indeksy, RLS i Triggery
drop index if exists public.idx_leads_owner_stage;
create index if not exists idx_deals_owner_stage on public.deals (owner, stage);
create index if not exists idx_deals_email       on public.deals (owner, email);
create index if not exists idx_activities_deal   on public.activities (deal_id, created_at desc);
create index if not exists idx_submissions_deal  on public.submissions (deal_id);

alter table public.deals enable row level security;
drop policy if exists "own deals" on public.deals;
create policy "own deals" on public.deals for all using (auth.uid() = owner) with check (auth.uid() = owner);

create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists t_deals_touch on public.deals;
create trigger t_deals_touch before update on public.deals for each row execute function public.touch_updated_at();

-- Wymuszenie odświeżenia cache PostgREST
notify pgrst, 'reload schema';
