-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — POPRAWKA do migration_sms.sql. Uruchom, jeśli wcześniejszą wersję
-- migration_sms.sql już wykonano (dwie zmiany powstały w trakcie implementacji).
-- Bezpieczna do wielokrotnego uruchomienia. Na ŚWIEŻEJ bazie nie jest potrzebna —
-- migration_sms.sql zawiera już finalny stan.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Indeks idempotencji alertów WEWNĘTRZNYCH: był unikalny po samym
--    form_submission_id (blokowałby wielu odbiorców). Ma być per (zgłoszenie, numer),
--    żeby Dominik i Jakub dostali po jednym alercie, ale retry nie dublował.
drop index if exists uniq_sms_form_internal;
create unique index if not exists uniq_sms_form_internal
  on sms_messages (form_submission_id, to_number) where trigger = 'form_internal';

-- 2) Szablon przypomnień o spotkaniach (per-właściciel) — nowa kolumna.
alter table app_settings add column if not exists sms_reminder_template_id uuid references sms_templates on delete set null;

notify pgrst, 'reload schema';
