-- migration_app_settings_resend.sql
-- Integracje → Wysyłka e-mail (item 9). Klucz API Resend i adres nadawcy
-- trzymane per-właściciel w app_settings, czytane WYŁĄCZNIE po stronie serwera
-- (/api/submit, /api/email/test). Nigdy nie wracają do klienta w jawnej postaci
-- — UI pokazuje tylko maskę i pozwala nadpisać.

alter table app_settings add column if not exists resend_api_key text;
alter table app_settings add column if not exists resend_from    text;
