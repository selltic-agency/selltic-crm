-- migration_perf_indexes.sql — indeksy pod najczęstsze zapytania list (audyt
-- wydajności). Wklej w Supabase → SQL Editor → Run. Bezpieczne do wielokrotnego
-- uruchomienia (IF NOT EXISTS) i nieblokujące (CREATE INDEX CONCURRENTLY nie
-- działa w transakcji edytora SQL, więc używamy zwykłego CREATE INDEX — przy
-- obecnym wolumenie (setki–tysiące wierszy) blokada jest pomijalna).
--
-- Kontekst: przy ~900+ leadach i rosnącym wolumenie domyślne sortowania list
-- (Leady/Pipeline i Prospecting) robiły sort bez wspierającego indeksu.

-- ── LEADY (deals) ─────────────────────────────────────────────────────────
-- Pipeline i tabela Leadów domyślnie sortują po opened_at malejąco, w obrębie
-- właściciela (RLS: owner = auth.uid()). Indeks złożony obsługuje filtr owner
-- + ORDER BY opened_at DESC jednym przejściem.
create index if not exists idx_deals_owner_opened_at
  on deals (owner, opened_at desc);

-- Pulpit, analityka i zapisane widoki sortują/filtrują po created_at.
create index if not exists idx_deals_owner_created_at
  on deals (owner, created_at desc);

-- ── PROSPECTING (prospects) ───────────────────────────────────────────────
-- Domyślny ranking aktywnych prospektów: lead_score DESC (NULLS LAST), potem
-- created_at DESC — zawsze z filtrem archived_at IS NULL. Indeks częściowy
-- pokrywa dokładnie ten, najgorętszy widok i pomija zarchiwizowane wiersze.
create index if not exists idx_prospects_active_ranking
  on prospects (owner, lead_score desc nulls last, created_at desc)
  where archived_at is null;
