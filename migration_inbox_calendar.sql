-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — MIGRACJA: Inbox zgłoszeń + Kalendarz zadań / Deal Owner
-- ────────────────────────────────────────────────────────────────────────
-- Uruchom raz na istniejącej bazie (po migration_phase9.sql): Supabase →
-- SQL Editor. Idempotentny — można odpalić wielokrotnie bez błędów.
-- ════════════════════════════════════════════════════════════════════════

-- 1. submissions.contact_id / lead_id — żeby Inbox mógł linkować zgłoszenie
--    do kontaktu/leada, które utworzyło (ustawiane przez /api/submit po
--    rozwiązaniu kontaktu i utworzeniu leada).
alter table submissions add column if not exists contact_id uuid references contacts on delete set null;
alter table submissions add column if not exists lead_id    uuid references leads on delete set null;
create index if not exists idx_submissions_contact on submissions (contact_id);
create index if not exists idx_submissions_lead     on submissions (lead_id);

-- 2. „Deal Owner” — prosty ręczny przydział osoby (Dominik / Kuba), bez
--    pełnego modelu workspace/multi-login z Fazy 11. Nazwane `assignee`,
--    żeby nie kolidować z istniejącą kolumną `owner` (uuid auth.users —
--    właściciel danych w RLS, zawsze ten sam dla obu osób).
alter table tasks add column if not exists assignee text;
alter table leads add column if not exists assignee text;

alter table tasks drop constraint if exists tasks_assignee_check;
alter table tasks add constraint tasks_assignee_check check (assignee is null or assignee in ('dominik', 'kuba'));

alter table leads drop constraint if exists leads_assignee_check;
alter table leads add constraint leads_assignee_check check (assignee is null or assignee in ('dominik', 'kuba'));

create index if not exists idx_tasks_assignee on tasks (assignee) where assignee is not null;
