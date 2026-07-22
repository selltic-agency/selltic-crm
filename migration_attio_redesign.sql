-- ════════════════════════════════════════════════════════════════════════
-- SELLTIC — migracja pod redesign Attio-style (sidebar, właściwości z
-- zakresami, zapisane widoki z konfiguracją kolumn/kanbana).
--
-- Uruchom raz w Supabase → SQL Editor. Idempotentna — można odpalać
-- wielokrotnie. Aplikacja działa też PRZED migracją (fallbacki), ale bez
-- niej: zakresy właściwości i konfiguracja kolumn widoków nie zapisują się
-- na stałe, a nazwa firmy w sidebarze pozostaje domyślna.
-- ════════════════════════════════════════════════════════════════════════

-- ── Właściwości: zakres (gdzie właściwość jest widoczna) ──────────────────
-- 'deals' | 'prospects'; domyślnie obie encje (zachowanie sprzed migracji —
-- zero utraty: istniejące definicje dostają oba zakresy).
alter table property_defs
  add column if not exists scopes text[] not null default '{deals,prospects}';

-- ── Zapisane widoki: konfiguracja per widok (Attio-style) ─────────────────
-- config = {
--   columns?: [{ key, visible, position }],     -- kolumny tabeli + kolejność
--   kanban?:  { hiddenStages?: [key], cardFields?: [key] }  -- widok kanban
-- }
alter table saved_views
  add column if not exists config jsonb not null default '{}';

-- ── Ustawienia: nazwa firmy w nagłówku sidebara + zakresy właściwości
--    systemowych (nadpisania widoczności dla „Kategoria"/„Cel kontaktu") ──
alter table app_settings add column if not exists company_name text;
alter table app_settings add column if not exists system_prop_scopes jsonb;

-- ── Prospekty: licznik nieudanych prób kontaktu („Próby kontaktu") oraz
--    trwała historia kontaktu żyją w props (jsonb) — bez zmian schematu.
--    Status „Nie nasz target" zapisujemy pod istniejącą wartością
--    'not_interested' (etykieta zmieniona w UI; dane historyczne mapują się
--    same 1:1) — bez zmiany CHECK-a na prospecting_status.

-- Odświeżenie cache schematu PostgREST (bez tego nowe kolumny bywają
-- niewidoczne dla API — błąd PGRST204).
notify pgrst, 'reload schema';
