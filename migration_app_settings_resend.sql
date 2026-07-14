-- migration_app_settings_resend.sql
-- Integracje → Wysyłka e-mail (item 9). Klucz API Resend, adres nadawcy oraz
-- adres do odpowiedzi (reply-to) trzymane per-właściciel w app_settings,
-- czytane WYŁĄCZNIE po stronie serwera (/api/submit, /api/email/test,
-- /api/email/send). Nigdy nie wracają do klienta w jawnej postaci — UI pokazuje
-- tylko maskę i pozwala nadpisać.
--
-- WAŻNE: jeśli „Zapisz” w Ustawienia → Integracje nie utrwalał klucza/adresu,
-- to zwykle znaczy, że ta migracja nie została jeszcze uruchomiona na bazie —
-- kolumny nie istniały, więc zapis był odrzucany. Uruchom ten plik w Supabase
-- (SQL Editor), a następnie odśwież cache schematu (NOTIFY pgrst poniżej).

alter table app_settings add column if not exists resend_api_key  text;
alter table app_settings add column if not exists resend_from     text;
alter table app_settings add column if not exists resend_reply_to text;

-- Odśwież cache schematu PostgREST, żeby nowe kolumny były od razu widoczne
-- dla API (bez tego zapis może zwracać błąd „column ... does not exist”).
notify pgrst, 'reload schema';
