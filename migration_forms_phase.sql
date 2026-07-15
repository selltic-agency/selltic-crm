-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — Faza: Formularze (archiwizacja, analityka, sesje, mapowanie leadów,
--           Meta Conversions). Bezpieczne do wielokrotnego uruchomienia.
-- Wklej całość w Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── §1. ARCHIWIZACJA FORMULARZY ──────────────────────────────────────────
-- Formularz NIGDY nie jest fizycznie usuwany. „Usunięcie” = archiwizacja.
alter table forms add column if not exists archived_at timestamptz;
alter table forms add column if not exists archived_by uuid references auth.users on delete set null;
create index if not exists idx_forms_archived_at on forms (archived_at);

-- ── §1. OCHRONA ZGŁOSZEŃ NA POZIOMIE BAZY ────────────────────────────────
-- Zgłoszenia to dane biznesowe i muszą przeżyć formularz. Baza AKTYWNIE
-- blokuje usunięcie formularza, który ma zgłoszenia (RESTRICT zamiast CASCADE).
-- Dzięki temu utrata danych jest niemożliwa nawet przy błędzie warstwy aplikacji.
alter table submissions drop constraint if exists submissions_form_id_fkey;
alter table submissions
  add constraint submissions_form_id_fkey
  foreign key (form_id) references forms (id) on delete restrict;

-- ── §1. MIGAWKI ZGŁOSZENIA ───────────────────────────────────────────────
-- Każde zgłoszenie przechowuje migawkę tytułu ORAZ opublikowanego schematu
-- z chwili przechwycenia. Render odpowiedzi zawsze używa migawki (fallback do
-- bieżącego published tylko, gdy migawki brak) — zgłoszenie sprzed roku
-- pozostaje czytelne po dowolnej edycji formularza.
alter table submissions add column if not exists title_snapshot text;
alter table submissions add column if not exists schema_snapshot jsonb;
-- Powiązanie zgłoszenia z sesją, która je wygenerowała (§2).
alter table submissions add column if not exists session_id uuid;
-- „Niekompletne” zgłoszenie (porzucone wypełnienie zamienione w lead) — do §6.
alter table submissions add column if not exists incomplete boolean not null default false;

-- Backfill migawek dla istniejących zgłoszeń (§1 — wymagane dla tytułu).
update submissions s
   set title_snapshot = f.title
  from forms f
 where f.id = s.form_id
   and s.title_snapshot is null;
update submissions s
   set schema_snapshot = f.published
  from forms f
 where f.id = s.form_id
   and s.schema_snapshot is null
   and f.published is not null;

-- ── §2. SESJE (jedna próba jednego gościa wypełnienia jednego formularza) ──
create table if not exists form_sessions (
  id            uuid primary key default gen_random_uuid(),
  form_id       uuid not null references forms on delete cascade,
  owner         uuid not null references auth.users on delete cascade,   -- denorm. do RLS
  visitor_id    text not null,                                           -- first-party anon id
  status        text not null default 'viewed'
                  check (status in ('viewed', 'started', 'abandoned', 'completed')),
  started_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  completed_at  timestamptz,
  max_step      int not null default 0,       -- najdalszy osiągnięty krok (index)
  last_step     int not null default 0,       -- krok, na którym stanął
  total_steps   int not null default 0,       -- liczba kroków w chwili sesji
  answers       jsonb not null default '{}',  -- częściowe odpowiedzi (autosave)
  meta          jsonb not null default '{}',  -- referrer, url, utm_*, fbclid, _fbp/_fbc, ua, ip
  consent       boolean not null default false, -- zgoda marketingowa (§9d)
  submission_id uuid references submissions on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_sessions_form_status  on form_sessions (form_id, status);
create index if not exists idx_sessions_owner         on form_sessions (owner, started_at desc);
-- Ciągłość sesji: reużycie sesji tego samego gościa na tym formularzu w oknie 30 min.
create index if not exists idx_sessions_continuity    on form_sessions (form_id, visitor_id, last_seen_at desc);
create index if not exists idx_sessions_abandon       on form_sessions (status, last_seen_at) where status = 'started';

-- Domknięcie FK submissions.session_id (po utworzeniu tabeli sesji).
alter table submissions drop constraint if exists submissions_session_id_fkey;
alter table submissions
  add constraint submissions_session_id_fkey
  foreign key (session_id) references form_sessions (id) on delete set null;

-- ── §2. ZDARZENIA (granularny lejek krokowy) ─────────────────────────────
create table if not exists form_events (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references form_sessions on delete cascade,
  form_id     uuid not null references forms on delete cascade,
  owner       uuid not null references auth.users on delete cascade,   -- denorm. do RLS
  type        text not null,   -- form_viewed | step_viewed | step_completed | submitted | capi
  step_index  int,
  meta        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists idx_events_session on form_events (session_id, created_at);
create index if not exists idx_events_form_type on form_events (form_id, type, step_index);

-- ── §9a. USTAWIENIA META PER-FORMULARZ (server-side, token nigdy do klienta) ──
-- Osobna tabela (NIE w schemacie published, który jest publicznie czytelny),
-- żeby token CAPI nie wyciekł do przeglądarki. RLS: tylko właściciel; brak
-- polityki publicznej. Submit czyta przez service_role.
create table if not exists form_meta_settings (
  form_id           uuid primary key references forms on delete cascade,
  owner             uuid not null references auth.users on delete cascade,
  pixel_id          text,
  capi_token        text,            -- WYŁĄCZNIE server-side, nigdy nie wraca do klienta
  test_event_code   text,
  events_enabled    boolean not null default false,
  webhook_url       text,            -- generyczny webhook (Make/Zapier/GA4)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
drop trigger if exists t_form_meta_touch on form_meta_settings;
create trigger t_form_meta_touch before update on form_meta_settings
  for each row execute function touch_updated_at();

-- ── §2/§9. USTAWIENIA GLOBALNE (fallback dla per-form) + próg porzucenia ──
alter table app_settings add column if not exists form_abandon_minutes int not null default 30;
alter table app_settings add column if not exists meta_pixel_id text;
alter table app_settings add column if not exists meta_capi_token text;        -- server-side only
alter table app_settings add column if not exists meta_test_event_code text;
alter table app_settings add column if not exists meta_events_enabled boolean not null default false;
alter table app_settings add column if not exists webhook_url text;

-- ════════════════════════════════════════════════════════════════════════
-- RLS — §10. Sesje i zdarzenia: odczyt tylko dla właściciela formularza.
-- Zapisy idą WYŁĄCZNIE z endpointów /api/track i /api/submit na service_role
-- (omija RLS) — brak polityk INSERT dla anonimowych.
-- ════════════════════════════════════════════════════════════════════════
alter table form_sessions enable row level security;
alter table form_events enable row level security;
alter table form_meta_settings enable row level security;

drop policy if exists "own sessions read" on form_sessions;
create policy "own sessions read" on form_sessions for select using (auth.uid() = owner);
drop policy if exists "own events read" on form_events;
create policy "own events read" on form_events for select using (auth.uid() = owner);
drop policy if exists "own meta settings" on form_meta_settings;
create policy "own meta settings" on form_meta_settings for all
  using (auth.uid() = owner) with check (auth.uid() = owner);

-- Publiczny odczyt formularzy: opublikowane ORAZ niezarchiwizowane.
-- (Zarchiwizowany formularz jest publicznie nieaktywny — §1.)
drop policy if exists "public reads published" on forms;
create policy "public reads published" on forms for select
  using (status = 'published' and archived_at is null);

-- ════════════════════════════════════════════════════════════════════════
-- §4. METRYKI — pojedyncze złączone zapytanie (bez N+1 na wiersz listy).
-- Widok z security_invoker: RLS tabel bazowych obowiązuje (widzisz tylko swoje).
-- ════════════════════════════════════════════════════════════════════════
drop view if exists form_metrics;
create view form_metrics
with (security_invoker = true) as
select
  f.id,
  f.owner,
  f.title,
  f.slug,
  f.status,
  f.archived_at,
  f.created_at,
  f.updated_at,
  coalesce(m.views, 0)             as views,
  coalesce(m.unique_users, 0)      as unique_users,
  coalesce(m.completions, 0)       as completions,
  coalesce(m.abandoned, 0)         as abandoned,
  m.last_submission                as last_submission,
  case when coalesce(m.unique_users, 0) > 0
       then round((m.completions::numeric / m.unique_users) * 100, 1)
       else null end               as conversion_rate
from forms f
left join (
  select
    form_id,
    count(*)                                             as views,
    count(distinct visitor_id)                           as unique_users,
    count(*) filter (where status = 'completed')         as completions,
    count(*) filter (where status in ('started', 'abandoned')) as abandoned,
    max(completed_at)                                    as last_submission
  from form_sessions
  group by form_id
) m on m.form_id = f.id;

-- ════════════════════════════════════════════════════════════════════════
-- §4/§5. STATYSTYKI POJEDYNCZEGO FORMULARZA (kafelki + lejek + zakres dat).
-- security definer z jawnym sprawdzeniem właściciela.
-- ════════════════════════════════════════════════════════════════════════
create or replace function form_stats(p_form_id uuid, p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_uid   uuid := auth.uid();
  v_tiles jsonb;
  v_funnel jsonb;
begin
  select owner into v_owner from forms where id = p_form_id;
  if v_owner is null or v_owner is distinct from v_uid then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'views',        count(*),
    'unique_users', count(distinct visitor_id),
    'completions',  count(*) filter (where status = 'completed'),
    'abandoned',    count(*) filter (where status in ('started', 'abandoned')),
    'last_submission', max(completed_at)
  )
  into v_tiles
  from form_sessions
  where form_id = p_form_id
    and (p_since is null or started_at >= p_since);

  -- Lejek krokowy: ile RÓŻNYCH sesji osiągnęło krok i ile go ukończyło.
  select coalesce(jsonb_agg(row_to_json(t) order by t.step_index), '[]'::jsonb)
  into v_funnel
  from (
    select
      e.step_index,
      count(distinct e.session_id) filter (where e.type = 'step_viewed')    as reached,
      count(distinct e.session_id) filter (where e.type = 'step_completed') as completed
    from form_events e
    where e.form_id = p_form_id
      and e.step_index is not null
      and (p_since is null or e.created_at >= p_since)
    group by e.step_index
  ) t;

  return coalesce(v_tiles, '{}'::jsonb) || jsonb_build_object('funnel', coalesce(v_funnel, '[]'::jsonb));
end;
$$;

grant execute on function form_stats(uuid, timestamptz) to authenticated;
