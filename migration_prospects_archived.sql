-- migration_prospects_archived.sql
-- Miękkie archiwum prospektów (soft-delete). Dodaje kolumnę `archived_at`:
-- gdy ustawiona, prospekt znika z aktywnych list Prospectingu i trafia do
-- zakładki „Archiwum”, skąd można go przywrócić (archived_at = null).
-- `prospecting_status` (new/contact_attempted/…) pozostaje nietknięty —
-- archiwum jest ortogonalne do statusu dzwonienia, więc po przywróceniu
-- prospekt wraca dokładnie w tym stanie, w jakim był. Uruchom raz w Supabase
-- SQL editor. Bezpieczne do wielokrotnego uruchomienia (idempotentne).

alter table prospects add column if not exists archived_at timestamptz;

-- Częściowy indeks — aktywne listy filtrują po `archived_at is null`.
create index if not exists idx_prospects_archived_at on prospects (archived_at);
