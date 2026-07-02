-- migration_scrape_jobs_new_existing.sql
-- Rozbija results_count zadania scrapowania na NOWE vs „już w bazie”.
--
-- Kontekst: scraped_leads ma unikat (owner, place_id), a backend zapisuje leady
-- przez upsert(on_conflict=owner,place_id). Dwa bliskoznaczne zapytania (np.
-- „fizjoterapia” i „fizjoterapeuta” w tym samym mieście) zwracają w dużej części
-- te same fizyczne firmy — drugie zadanie tylko je odświeża, nie dodaje nowych.
-- Dotąd results_count liczył wszystkie przetworzone wyniki API, przez co dwa
-- zadania po „20 znalezionych” dawały mocno poniżej 40 unikalnych leadów, co
-- wyglądało jak gubienie danych (a jest poprawną deduplikacją).
--
-- new_count      — ile z przetworzonych wyników to leady wcześniej nieznane
--                  temu właścicielowi (faktycznie dodane).
-- existing_count — ile już istniało (tylko zaktualizowane). Suma = results_count.
--
-- Uruchom raz w Supabase SQL editor. Bezpieczne do wielokrotnego uruchomienia.

alter table scrape_jobs add column if not exists new_count      int not null default 0;
alter table scrape_jobs add column if not exists existing_count  int not null default 0;
