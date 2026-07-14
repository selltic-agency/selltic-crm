-- migration_email_templates.sql
-- Szablony e-mail (Integracje → Szablony e-mail). Wielokrotnego użytku szablony
-- z placeholderami {{first_name}}, {{company}} itp., podstawianymi danymi leada
-- przy wysyłce z karty leada (/api/email/send). Per-właściciel, chronione RLS.

create table if not exists email_templates (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  name        text not null,                   -- nazwa wewnętrzna (identyfikacja)
  subject     text not null default '',        -- temat (może zawierać {{pola}})
  body        text not null default '',         -- treść HTML (może zawierać {{pola}})
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_email_templates_owner on email_templates (owner, updated_at desc);

alter table email_templates enable row level security;

drop policy if exists "own email templates" on email_templates;
create policy "own email templates" on email_templates
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- Auto-aktualizacja updated_at (funkcja touch_updated_at() z schema.sql).
drop trigger if exists t_email_templates_touch on email_templates;
create trigger t_email_templates_touch before update on email_templates
  for each row execute function touch_updated_at();

notify pgrst, 'reload schema';
