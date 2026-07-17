-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — MIGRACJA: Automatyzacja SMS przy zgłoszeniu formularza.
-- Osobna tabela (NIE w forms.published/schema, który jest publicznie czytelny),
-- bo zawiera wewnętrzne numery odbiorców. Wzorzec jak form_meta_settings.
-- Wymaga wcześniejszego uruchomienia migration_sms.sql (referencje sms_templates).
-- ════════════════════════════════════════════════════════════════════════
create table if not exists form_sms_settings (
  form_id                    uuid primary key references forms on delete cascade,
  owner                      uuid not null references auth.users on delete cascade,
  enabled                    boolean not null default false,
  -- Potwierdzenie do zgłaszającego.
  confirmation_enabled       boolean not null default false,
  confirmation_template_id   uuid references sms_templates on delete set null,
  confirmation_delay_seconds int not null default 0,
  -- Powiadomienie wewnętrzne (Dominik + Jakub domyślnie, konfigurowalne).
  internal_enabled           boolean not null default false,
  internal_template_id       uuid references sms_templates on delete set null,
  internal_recipients        text[] not null default '{}',   -- E.164, walidowane przy zapisie
  -- Mapowanie pól formularza.
  phone_field_id             text,
  consent_field_id           text,                            -- nullable
  -- Limit nadużyć: max SMS na formularz na godzinę.
  hourly_cap                 int not null default 50,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
drop trigger if exists t_form_sms_touch on form_sms_settings;
create trigger t_form_sms_touch before update on form_sms_settings
  for each row execute function touch_updated_at();

alter table form_sms_settings enable row level security;
drop policy if exists "own form sms settings" on form_sms_settings;
create policy "own form sms settings" on form_sms_settings for all
  using (auth.uid() = owner) with check (auth.uid() = owner);
-- Brak polityki publicznej — /api/submit czyta przez service_role.

notify pgrst, 'reload schema';
