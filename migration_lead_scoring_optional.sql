-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — scoring leadów w pełni OPCJONALNY.
--
-- KONTEKST / PROBLEM
-- Kolumna lead_score była już nullable (brak wyniku = OK), ale check-constraint
-- na prospects/deals wymuszał `lead_score <= 100`. Wagi scoringu są w pełni
-- edytowalne z UI, więc suma punktów potrafiła przekroczyć 100. Taki wynik
-- przechodził przez scraped_leads (kolumna score bez ograniczenia), a wywracał
-- się dopiero przy „Przenieś do Prospectingu" jako:
--     violates check constraint "prospects_lead_score_check"
-- Blokowało to realnie przenoszenie leadów (m.in. paczek z celem „Ads").
--
-- ZMIANY
--  1) Zdejmujemy GÓRNĄ granicę z check-constraintu lead_score na prospects i
--     deals. Zostawiamy tylko `lead_score is null or lead_score >= 0`, żeby
--     żaden lead (niezależnie od celu kontaktu, źródła czy wag) nie mógł już
--     zablokować przeniesienia. Scraper i tak przycina wynik do 0–100
--     (scraper_core.score_website), więc to pas bezpieczeństwa na dane
--     historyczne/z innych źródeł.
--  2) Dodajemy scoring_enabled (bool, default true) na scrape_batches i
--     scrape_jobs — przełącznik „Włącz scoring" wybierany per paczka przy
--     starcie. Wyłączony → backend scrapera nie sprawdza stron i nie liczy
--     wyniku; leady z tej paczki mają score/website_status = NULL i to jest
--     stan POPRAWNY, nie błąd.
--
-- Uruchom raz w Supabase SQL editor, PO migration_prospecting_deals.sql,
-- migration_deals_scraper_fields.sql i migration_scrape_batches.sql.
-- Idempotentny.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Relaksacja check-constraintów lead_score --------------------------------
alter table prospects drop constraint if exists prospects_lead_score_check;
alter table prospects add constraint prospects_lead_score_check
  check (lead_score is null or lead_score >= 0);

alter table deals drop constraint if exists deals_lead_score_check;
alter table deals add constraint deals_lead_score_check
  check (lead_score is null or lead_score >= 0);

-- 2) Przełącznik scoringu per paczka -----------------------------------------
-- Dziedziczenie batch → job ustala CRM przy tworzeniu zadań (start route);
-- backend czyta scrape_jobs.scoring_enabled per zadanie.
alter table scrape_batches add column if not exists scoring_enabled boolean not null default true;
alter table scrape_jobs    add column if not exists scoring_enabled boolean not null default true;
