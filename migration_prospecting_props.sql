-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — dodaje `props` (jsonb) do `prospects`, na wzór `deals.props`.
-- Trzyma dane ze scrapera bez stałego miejsca w schemacie: google_maps_url,
-- priority_label, score_reasons. Uruchom raz na istniejącej bazie (po
-- migration_prospecting_deals.sql). Idempotentny.
-- ════════════════════════════════════════════════════════════════════════

alter table prospects add column if not exists props jsonb not null default '{}';
