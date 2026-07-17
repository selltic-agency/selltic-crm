-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — MIGRACJA: Moduł SMS (SMSAPI). Idempotentna, wielokrotne uruchomienie OK.
-- Konwencje jak w schema.sql: text+check zamiast enumów, owner=auth.uid() w RLS,
-- publiczne zapisy WYŁĄCZNIE przez service_role (brak polityk INSERT dla anon).
-- ════════════════════════════════════════════════════════════════════════

-- ── SZABLONY SMS ─────────────────────────────────────────────────────────
create table if not exists sms_templates (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  name        text not null,
  body        text not null default '',
  kind        text not null default 'transactional'
                check (kind in ('transactional', 'marketing')),
  is_active   boolean not null default true,
  -- Szablony „automatyczne" (potwierdzenia/powiadomienia z formularzy) MUSZĄ
  -- pozostać na GSM-7 (bez polskich znaków) — patrz polityka diakrytyków.
  automated   boolean not null default false,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_sms_templates_owner on sms_templates (owner, updated_at desc);

-- ── WIADOMOŚCI SMS (log wysyłek) ─────────────────────────────────────────
create table if not exists sms_messages (
  id                  uuid primary key default gen_random_uuid(),
  owner               uuid not null references auth.users on delete cascade,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Polimorficzne powiązanie (jak activities, bez FK — related_type steruje tabelą).
  related_type        text check (related_type in ('lead','prospect','contact','deal')),
  related_id          uuid,
  to_number           text not null,                 -- E.164, np. +48601234567
  body                text not null,
  sender_name         text,
  provider            text not null default 'smsapi',
  provider_message_id text,
  status              text not null default 'queued'
                        check (status in ('queued','sent','delivered','failed','undelivered')),
  segments            int,
  encoding            text check (encoding in ('gsm7','ucs2')),
  cost_points         numeric,
  error_code          text,
  error_message       text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  created_by          uuid references auth.users on delete set null,
  kind                text not null default 'transactional'
                        check (kind in ('transactional','marketing')),
  template_id         uuid references sms_templates on delete set null,
  -- Automatyzacja formularzy (obie kolumny nullable — wysyłki manualne ich nie mają).
  form_id             uuid references forms on delete set null,
  form_submission_id  uuid references submissions on delete set null,
  trigger             text not null default 'manual'
                        check (trigger in ('manual','form_confirmation','form_internal','meeting_reminder')),
  -- Wysyłki opóźnione (delay_seconds > 0) — drenowane przez cron.
  scheduled_at        timestamptz
);
create index if not exists idx_sms_messages_related  on sms_messages (related_type, related_id);
create index if not exists idx_sms_messages_provider on sms_messages (provider_message_id);
create index if not exists idx_sms_messages_owner     on sms_messages (owner, created_at desc);
-- Kolejka wysyłek zaplanowanych (cron bierze status=queued z terminem w przeszłości).
create index if not exists idx_sms_messages_scheduled on sms_messages (scheduled_at)
  where status = 'queued' and scheduled_at is not null;

-- IDEMPOTENCJA: dokładnie jedno POTWIERDZENIE na zgłoszenie (jeden odbiorca).
create unique index if not exists uniq_sms_form_confirmation
  on sms_messages (form_submission_id) where trigger = 'form_confirmation';
-- Alert WEWNĘTRZNY: jeden na (zgłoszenie, odbiorca) — wielu odbiorców (Dominik +
-- Jakub) dostaje po jednym alercie, ale ponowne wywołanie handlera nie dubluje.
create unique index if not exists uniq_sms_form_internal
  on sms_messages (form_submission_id, to_number) where trigger = 'form_internal';

-- ── ZDARZENIA DLR (surowy log raportów doręczeń) ─────────────────────────
create table if not exists sms_events (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null references auth.users on delete cascade,   -- denorm. do RLS
  sms_message_id uuid not null references sms_messages on delete cascade,
  status         text,
  status_name    text,
  raw_payload    jsonb not null default '{}',
  received_at    timestamptz not null default now(),
  -- Klucz deduplikacji DLR: ten sam raport może przyjść wielokrotnie.
  dedupe_key     text not null,
  unique (dedupe_key)
);
create index if not exists idx_sms_events_message on sms_events (sms_message_id, received_at);

-- ── ZGODA MARKETINGOWA na rekordzie leada (deals) ────────────────────────
alter table deals add column if not exists sms_consent boolean not null default false;
alter table deals add column if not exists sms_consent_at timestamptz;
-- Proweniencja zgody (z jakiego formularza/zgłoszenia pochodzi — dowód RODO).
alter table deals add column if not exists sms_consent_form_id uuid references forms on delete set null;
alter table deals add column if not exists sms_consent_submission_id uuid references submissions on delete set null;

-- ── PRZYPOMNIENIA O SPOTKANIACH — znacznik „wysłano" na zadaniu ───────────
alter table tasks add column if not exists sms_reminder_sent_at timestamptz;
-- Szablon używany przez przypomnienia o spotkaniach (cron). Per-właściciel.
alter table app_settings add column if not exists sms_reminder_template_id uuid references sms_templates on delete set null;

-- ── updated_at auto (funkcja touch_updated_at() z schema.sql) ─────────────
drop trigger if exists t_sms_templates_touch on sms_templates;
create trigger t_sms_templates_touch before update on sms_templates
  for each row execute function touch_updated_at();
drop trigger if exists t_sms_messages_touch on sms_messages;
create trigger t_sms_messages_touch before update on sms_messages
  for each row execute function touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table sms_templates enable row level security;
alter table sms_messages  enable row level security;
alter table sms_events    enable row level security;

drop policy if exists "own sms templates" on sms_templates;
create policy "own sms templates" on sms_templates for all
  using (auth.uid() = owner) with check (auth.uid() = owner);
drop policy if exists "own sms messages" on sms_messages;
create policy "own sms messages" on sms_messages for all
  using (auth.uid() = owner) with check (auth.uid() = owner);
drop policy if exists "own sms events" on sms_events;
create policy "own sms events" on sms_events for all
  using (auth.uid() = owner) with check (auth.uid() = owner);

notify pgrst, 'reload schema';
