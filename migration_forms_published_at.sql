-- ════════════════════════════════════════════════════════════════════════
-- forms.published_at — znacznik czasu publikacji formularza (przycisk „Publikuj”).
-- Ustawiany przez /admin/forms/[id] przy publikacji. Kolumny `slug` i `status`
-- już istnieją w schema.sql — tu dokładamy tylko datę publikacji.
-- Wklej w Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════

alter table forms add column if not exists published_at timestamptz;
