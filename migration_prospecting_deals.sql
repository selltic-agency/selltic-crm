-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — MIGRACJA do Fazy 10 (Prospecting + scalenie contacts → deals)
-- ────────────────────────────────────────────────────────────────────────
-- Uruchom raz na istniejącej bazie (po migration_phase9.sql i
-- migration_inbox_calendar.sql): Supabase → SQL Editor. Idempotentny —
-- można odpalić wielokrotnie bez błędów.
--
-- Co się dzieje:
--   1. `leads` → `deals`, z dopisaną tożsamością (name/email/phone/company/
--      props) bezpośrednio na rekordzie — koniec rozdziału kontakt/lead.
--   2. `contacts` → `prospects`, całkowicie przebudowane pod zimne leady
--      z Google Maps (scraper). Brak danych produkcyjnych w `contacts` →
--      usuwamy stare kolumny wprost (bez backfill), tak jak w poprzednich
--      fazach.
--   3. `activities`/`tasks`/`notifications` wskazują teraz na `deal_id`
--      zamiast `contact_id`. `duplicate_flags` → `deal_a`/`deal_b`.
--      `submissions.contact_id` znika (zbędne — tożsamość żyje w deal).
-- ════════════════════════════════════════════════════════════════════════

-- 1. leads → deals + scalenie tożsamości kontaktu.
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'leads')
     and not exists (select 1 from information_schema.tables where table_name = 'deals') then
    alter table leads rename to deals;
  end if;
end $$;

alter table deals add column if not exists name    text;
alter table deals add column if not exists email   text;
alter table deals add column if not exists phone   text;
alter table deals add column if not exists company text;
alter table deals add column if not exists props   jsonb not null default '{}';
alter table deals drop column if exists contact_id;

drop index if exists idx_leads_owner_stage;
drop index if exists idx_leads_contact;
create index if not exists idx_deals_owner_stage on deals (owner, stage);
create index if not exists idx_deals_email       on deals (owner, email);

-- 2. activities: contact_id + lead_id → deal_id (not null).
alter table activities drop column if exists contact_id;
alter table activities rename column lead_id to deal_id;
delete from activities where deal_id is null;
alter table activities alter column deal_id set not null;
alter table activities drop constraint if exists activities_lead_id_fkey;
alter table activities drop constraint if exists activities_deal_id_fkey;
alter table activities add constraint activities_deal_id_fkey
  foreign key (deal_id) references deals (id) on delete cascade;
drop index if exists idx_activities_contact;
drop index if exists idx_activities_lead;
create index if not exists idx_activities_deal on activities (deal_id, created_at desc);

-- 3. tasks: contact_id → deal_id (nullable). Wiele kontaktów sprzed refaktoru
-- nigdy nie doczekało się leada/deala — ich taski tracą powiązanie (null)
-- zamiast łamać FK do deals.
alter table tasks rename column contact_id to deal_id;
update tasks set deal_id = null where deal_id is not null and deal_id not in (select id from deals);
alter table tasks drop constraint if exists tasks_contact_id_fkey;
alter table tasks drop constraint if exists tasks_deal_id_fkey;
alter table tasks add constraint tasks_deal_id_fkey
  foreign key (deal_id) references deals (id) on delete set null;

-- 4. notifications: contact_id → deal_id (nullable). Ta sama sytuacja co tasks.
alter table notifications rename column contact_id to deal_id;
update notifications set deal_id = null where deal_id is not null and deal_id not in (select id from deals);
alter table notifications drop constraint if exists notifications_contact_id_fkey;
alter table notifications drop constraint if exists notifications_deal_id_fkey;
alter table notifications add constraint notifications_deal_id_fkey
  foreign key (deal_id) references deals (id) on delete cascade;

-- 5. duplicate_flags: contact_a/contact_b → deal_a/deal_b.
alter table duplicate_flags drop column if exists contact_a;
alter table duplicate_flags drop column if exists contact_b;
alter table duplicate_flags add column if not exists deal_a uuid references deals on delete cascade;
alter table duplicate_flags add column if not exists deal_b uuid references deals on delete cascade;
delete from duplicate_flags where deal_a is null or deal_b is null;
alter table duplicate_flags alter column deal_a set not null;
alter table duplicate_flags alter column deal_b set not null;

-- 6. submissions: usuń contact_id (zbędne), lead_id → deal_id.
alter table submissions drop column if exists contact_id;
alter table submissions rename column lead_id to deal_id;
drop index if exists idx_submissions_contact;
drop index if exists idx_submissions_lead;
create index if not exists idx_submissions_deal on submissions (deal_id);

-- 7. contacts → prospects, przebudowane pod scraper Google Maps.
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'contacts')
     and not exists (select 1 from information_schema.tables where table_name = 'prospects') then
    alter table contacts rename to prospects;
  end if;
end $$;

alter table prospects drop constraint if exists contacts_owner_email_key;
alter table prospects drop column if exists email;
alter table prospects drop column if exists company;
alter table prospects drop column if exists props;
alter table prospects drop column if exists updated_at;

alter table prospects add column if not exists place_id                 text;
update prospects set place_id = id::text where place_id is null;
alter table prospects alter column place_id set not null;
alter table prospects alter column name set not null;
alter table prospects add column if not exists website                  text;
alter table prospects add column if not exists address                  text;
alter table prospects add column if not exists rating                   numeric;
alter table prospects add column if not exists review_count             int;
alter table prospects add column if not exists business_status          text;
alter table prospects add column if not exists industry                 text;
alter table prospects add column if not exists city                     text;
alter table prospects add column if not exists source                   text not null default 'google_maps_scraper';
alter table prospects add column if not exists prospecting_status       text not null default 'new';
alter table prospects add column if not exists last_contact_attempt_at  timestamptz;
alter table prospects add column if not exists note                     text;
alter table prospects add column if not exists website_status           text;
alter table prospects add column if not exists website_last_checked_at  timestamptz;
alter table prospects add column if not exists lead_score               int;
alter table prospects add column if not exists lead_score_breakdown     jsonb;
alter table prospects add column if not exists converted_deal_id        uuid references deals on delete set null;

alter table prospects drop constraint if exists prospects_prospecting_status_check;
alter table prospects add constraint prospects_prospecting_status_check
  check (prospecting_status in ('new', 'contact_attempted', 'not_interested', 'converted'));
alter table prospects drop constraint if exists prospects_website_status_check;
alter table prospects add constraint prospects_website_status_check
  check (website_status is null or website_status in ('none', 'active', 'broken', 'slow'));
alter table prospects drop constraint if exists prospects_lead_score_check;
alter table prospects add constraint prospects_lead_score_check
  check (lead_score is null or (lead_score >= 0 and lead_score <= 100));

drop index if exists idx_contacts_owner_stage;
create unique index if not exists idx_prospects_place_id    on prospects (place_id);
create index if not exists idx_prospects_status     on prospects (prospecting_status);
create index if not exists idx_prospects_industry   on prospects (industry);
create index if not exists idx_prospects_city       on prospects (city);
create index if not exists idx_prospects_lead_score on prospects (lead_score);

-- 8. Triggery updated_at.
drop trigger if exists t_contacts_touch on prospects;
drop trigger if exists t_leads_touch on deals;
drop trigger if exists t_deals_touch on deals;
create trigger t_deals_touch before update on deals for each row execute function touch_updated_at();

-- 9. RLS + policy — przemianowanie z contacts/leads na prospects/deals.
alter table deals     enable row level security;
alter table prospects enable row level security;

drop policy if exists "own contacts" on prospects;
drop policy if exists "own leads" on deals;
drop policy if exists "own prospects" on prospects;
drop policy if exists "own deals" on deals;
create policy "own deals" on deals for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own prospects" on prospects for all using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists "own dup flags" on duplicate_flags;
create policy "own dup flags" on duplicate_flags for all using (auth.uid() = owner) with check (auth.uid() = owner);
