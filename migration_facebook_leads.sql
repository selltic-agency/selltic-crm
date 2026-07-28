-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — Facebook Lead Ads (formularze błyskawiczne) + Conversions API
-- dla zdarzeń CRM („które leady były dobre”).
--
-- Uruchom w Supabase → SQL Editor. Bezpieczne do wielokrotnego odpalenia.
--
-- Dwa kierunki, które ta migracja obsługuje:
--   IN  — Make.com → /api/leads/facebook → deals (z fb_lead_id).
--   OUT — zmiana etapu w CRM → Conversions API (action_source
--         'system_generated', user_data.lead_id) → Meta wie, który lead
--         okazał się wartościowy.
-- ════════════════════════════════════════════════════════════════════════

-- ── DEALE: tożsamość leada w ekosystemie Meta ───────────────────────────
-- fb_lead_id to `leadgen_id` z Facebooka — JEDYNY klucz, po którym Meta
-- potrafi powiązać nasze zdarzenie zwrotne z konkretnym leadem. Bez niego
-- sygnał jakości nie ma się do czego przypiąć.
alter table deals add column if not exists fb_lead_id     text;
alter table deals add column if not exists fb_form_id     text;
alter table deals add column if not exists fb_form_name   text;
alter table deals add column if not exists fb_page_id     text;
alter table deals add column if not exists fb_ad_id       text;
alter table deals add column if not exists fb_adset_id    text;
alter table deals add column if not exists fb_campaign_id text;
alter table deals add column if not exists fb_platform    text;   -- 'fb' | 'ig'
alter table deals add column if not exists fb_is_organic  boolean;
alter table deals add column if not exists fb_created_at  timestamptz;  -- czas wypełnienia po stronie Meta

-- Idempotencja ingestu: Make ponawia webhooki, a Facebook potrafi wysłać ten
-- sam lead dwa razy. Unikalny indeks zamienia powtórkę w UPDATE zamiast
-- w drugiego deala.
create unique index if not exists idx_deals_fb_lead_id
  on deals (fb_lead_id) where fb_lead_id is not null;
create index if not exists idx_deals_fb_campaign on deals (fb_campaign_id)
  where fb_campaign_id is not null;

-- ── ETAPY LEJKA → ZDARZENIA CAPI ────────────────────────────────────────
-- Mapowanie mieszka przy etapie, bo to ten sam obiekt, który właściciel już
-- edytuje w Ustawieniach → Etapy lejka. Pusta nazwa = etap nic nie wysyła.
alter table pipeline_stages add column if not exists meta_event_name    text;
alter table pipeline_stages add column if not exists meta_event_enabled boolean not null default false;

-- Domyślne mapowanie dla standardowych etapów (tylko tam, gdzie właściciel
-- jeszcze nic nie ustawił — nie nadpisujemy ręcznej konfiguracji).
update pipeline_stages set meta_event_name = 'Qualified'
  where key = 'contact' and meta_event_name is null;
update pipeline_stages set meta_event_name = 'Converted'
  where is_won = true and meta_event_name is null;
update pipeline_stages set meta_event_name = 'Disqualified'
  where is_lost = true and meta_event_name is null;

-- ── MAPOWANIE PÓL FORMULARZY BŁYSKAWICZNYCH ─────────────────────────────
-- Każdy formularz na Facebooku ma własne nazwy pól (`field_data[].name`),
-- w tym pytania własne po polsku. Trzymamy je per formularz, żeby zmiana
-- formularza w Meta nie wymagała deployu.
--
-- field_map: { "<nazwa pola FB>": "<cel>" }, gdzie cel to:
--   'name' | 'email' | 'phone' | 'company' | 'value' | 'ignore'
--   lub 'prop:<klucz właściwości>' (trafia do deals.props).
create table if not exists fb_lead_forms (
  fb_form_id    text primary key,
  owner         uuid not null references auth.users on delete cascade,
  label         text,                              -- nazwa formularza (dla ludzi)
  field_map     jsonb not null default '{}',
  -- Nazwy pól zaobserwowane w dotychczasowych leadach — UI buduje z nich
  -- listę do zmapowania (inaczej właściciel musiałby przepisywać techniczne
  -- nazwy pól z panelu Meta ręcznie).
  known_fields  text[] not null default '{}',
  default_stage text,                              -- klucz etapu startowego (null = pierwszy w lejku)
  lead_title    text,                              -- szablon tytułu leada (jak settings.defaultLeadTitle)
  enabled       boolean not null default true,     -- false = odrzucaj leady z tego formularza
  last_lead_at  timestamptz,
  leads_count   int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
drop trigger if exists t_fb_lead_forms_touch on fb_lead_forms;
create trigger t_fb_lead_forms_touch before update on fb_lead_forms
  for each row execute function touch_updated_at();

-- ── LOG ZDARZEŃ WYSŁANYCH DO META ───────────────────────────────────────
-- Bez logu cisza w Events Managerze jest niediagnozowalna (ta sama zasada,
-- co przy form_events typu 'capi'). Log jest zarazem kolejką ponowień:
-- wiersz z ok=false podnosi cron.
--
-- unique (fb_lead_id, event_name): dany etap lejka raportujemy dla leada
-- RAZ. Powroty na etap nie generują duplikatów, a ponowienie aktualizuje
-- istniejący wiersz.
create table if not exists meta_lead_events (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null references auth.users on delete cascade,
  deal_id      uuid references deals on delete cascade,
  fb_lead_id   text not null,
  event_name   text not null,
  stage_key    text,
  event_time   timestamptz not null default now(),
  ok           boolean not null default false,
  attempts     int not null default 0,
  status       int,                                -- kod HTTP odpowiedzi Graph API
  error        text,
  response     jsonb,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (fb_lead_id, event_name)
);
create index if not exists idx_meta_lead_events_retry
  on meta_lead_events (owner, created_at) where ok = false;
create index if not exists idx_meta_lead_events_deal
  on meta_lead_events (deal_id, created_at desc);

-- ── USTAWIENIA GLOBALNE ─────────────────────────────────────────────────
-- Osobny dataset dla zdarzeń CRM: leady błyskawiczne często idą na inne
-- konto reklamowe niż formularze na stronie. Fallback na meta_pixel_id /
-- meta_capi_token rozwiązuje kod (lib/server/metaCrm.ts), żeby prosty
-- przypadek „jeden pixel na wszystko” nie wymagał podwójnej konfiguracji.
alter table app_settings add column if not exists meta_crm_dataset_id     text;
alter table app_settings add column if not exists meta_crm_token          text;  -- WYŁĄCZNIE server-side
alter table app_settings add column if not exists meta_crm_test_event_code text;
alter table app_settings add column if not exists meta_crm_enabled        boolean not null default false;
-- Czy lead z Facebooka ma wywołać mail „nowy lead” (jak zgłoszenie formularza).
alter table app_settings add column if not exists fb_leads_notify         boolean not null default true;

-- ── WŁAŚCIWOŚĆ „ŹRÓDŁO KONTAKTU” ────────────────────────────────────────
-- Dosiew definicji robi aplikacja (lib/contactSource.ts), ale tylko gdy
-- właściwości jeszcze nie ma. Na istniejącej bazie dokładamy samą opcję,
-- żeby leady z Facebooka miały gdzie wpaść na liście wyboru.
update property_defs
set options = options || '[{"key":"facebook_lead_ads","label":"Facebook Lead Ads","color":"#0866FF"}]'::jsonb
where key = 'zrodlo_kontaktu'
  and jsonb_typeof(options) = 'array'
  and not exists (
    select 1 from jsonb_array_elements(options) o
    where o->>'key' = 'facebook_lead_ads' or o #>> '{}' = 'facebook_lead_ads'
  );

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Zapis idzie WYŁĄCZNIE przez endpointy na service_role (ingest z Make jest
-- autoryzowany nagłówkiem X-API-Key, wysyłka CAPI sesją właściciela) — brak
-- polityk publicznych, spójnie z prospects/submissions.
alter table fb_lead_forms    enable row level security;
alter table meta_lead_events enable row level security;

drop policy if exists "own fb lead forms" on fb_lead_forms;
create policy "own fb lead forms" on fb_lead_forms for all
  using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists "own meta lead events" on meta_lead_events;
create policy "own meta lead events" on meta_lead_events for select
  using (auth.uid() = owner);
