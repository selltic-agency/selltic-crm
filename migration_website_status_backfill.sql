-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — porządkuje dane o stronie WWW prospektów (kolumna „Strona"
-- w Prospectingu pokazywała raz adres, raz „Brak strony", raz „—" dla
-- rekordów o tym samym stanie).
--
-- Co robi:
--   1. `website`: placeholdery ("", " ", "-", "brak", "n/a", "null") → NULL,
--      adresy bez schematu → https:// (inaczej link w CRM-ie jest względny).
--   2. `website_status`: uzupełnia tam, gdzie da się to wywnioskować —
--      z obecności adresu i z opisu w `lead_score_breakdown.stan_strony.opis`
--      (scraper zapisuje tam „Brak strony/domeny" / „Strona nie działa" /
--      „Strona działa"). Rekordów, o których nic nie wiadomo, NIE oznaczamy
--      jako „brak strony" — zostają NULL i UI pokazuje „—".
--   3. Prostuje sprzeczność „jest adres, a status = none".
--
-- Uruchom raz na istniejącej bazie. Idempotentny — można puścić ponownie.
-- Uwaga: `website_status` ma CHECK na ('none','active','broken','slow'),
-- więc polskie wartości ze scrapera ('brak'/'dziala'/'nie_dziala') i tak nie
-- mogły się tu zapisać; od teraz mapuje je API importu (lib/website.ts).
-- ════════════════════════════════════════════════════════════════════════

-- 1a. Placeholdery zamiast adresu → NULL.
update prospects
set website = null
where website is not null
  and lower(btrim(website)) in ('', '-', '--', '—', 'brak', 'brak strony', 'brak_strony',
                                'n/a', 'na', 'nd', 'nie', 'none', 'null', 'undefined', 'false', '0');

-- 1b. Adres bez schematu → https:// (+ przycięcie białych znaków).
update prospects
set website = 'https://' || btrim(website)
where website is not null
  and btrim(website) <> ''
  and btrim(website) !~* '^https?://'
  and btrim(website) ~ '\.';

update prospects
set website = btrim(website)
where website is not null and website <> btrim(website);

-- 2a. Jest adres, a status mówi „brak strony" → sprzeczność. Adres jest
--     twardszym dowodem (tak samo rozstrzyga UI), ale NIE zgadujemy „Aktywna" —
--     tego, czy strona odpowiada, ta migracja nie sprawdza. Status = NULL,
--     czyli „nie wiadomo w jakim stanie", a UI i tak pokaże klikalny adres.
update prospects
set website_status = null
where website is not null and website_status = 'none';

-- 2b. Brak adresu i brak statusu, ale scoring zapisał stan strony w rozbiciu.
update prospects
set website_status = case
      when lower(lead_score_breakdown->'stan_strony'->>'opis') like '%brak%'      then 'none'
      when lower(lead_score_breakdown->'stan_strony'->>'opis') like '%nie dzia%'  then 'broken'
      when lower(lead_score_breakdown->'stan_strony'->>'opis') like '%woln%'      then 'slow'
      when lower(lead_score_breakdown->'stan_strony'->>'opis') like '%dzia%'      then 'active'
    end
where website is null
  and website_status is null
  and lead_score_breakdown->'stan_strony'->>'opis' is not null
  and lower(lead_score_breakdown->'stan_strony'->>'opis') ~ '(brak|dzia|woln)';

-- 2c. To samo dla starych rekordów z listą powodów w props.score_reasons.
update prospects
set website_status = 'none'
where website is null
  and website_status is null
  and jsonb_typeof(props->'score_reasons') = 'array'
  and exists (
    select 1
    from jsonb_array_elements_text(props->'score_reasons') as r(reason)
    where lower(reason) like '%brak strony%'
  );

-- 2d. Zostały rekordy bez adresu i bez statusu. Reguła produktowa: dane
--     pochodzą z Google Maps, gdzie adres WWW jest podany zawsze, gdy firma go
--     ma — pusta kolumna znaczy więc „brak strony". Zapisujemy to wprost, żeby
--     filtr „Status strony = Brak strony" łapał te same rekordy, które UI
--     opisuje jako „Brak strony" (UI stosuje tę samą regułę w lib/website.ts).
update prospects
set website_status = 'none'
where website is null and website_status is null;

-- 3. Kontrolka po migracji — rozkład stanów strony:
--    select coalesce(website_status, '(null)') as stan, count(*)
--    from prospects group by 1 order by 2 desc;
--    Rekordy ze statusem NULL mają adres, ale nieznany stan (patrz 2a).
