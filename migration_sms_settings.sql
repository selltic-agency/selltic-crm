-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — MIGRACJA: konfiguracja bramki SMS w app_settings (zamiast .env).
-- Pozwala ustawić token/nadawcę/tryb testowy z UI (Ustawienia → Bramka SMS).
-- Wartości czytane WYŁĄCZNIE po stronie serwera; env pozostaje fallbackiem.
-- Idempotentna. Wymaga wcześniejszego migration_sms.sql.
-- ════════════════════════════════════════════════════════════════════════
alter table app_settings add column if not exists smsapi_token     text;   -- SEKRET (server-side)
alter table app_settings add column if not exists smsapi_sender    text;
alter table app_settings add column if not exists smsapi_base_url  text;
alter table app_settings add column if not exists sms_test_mode    boolean not null default false;
alter table app_settings add column if not exists sms_dlr_secret   text;   -- SEKRET (weryfikacja webhooka DLR)

notify pgrst, 'reload schema';
