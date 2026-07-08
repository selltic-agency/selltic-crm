-- ════════════════════════════════════════════════════════════════════════
-- Storage: bucket „form-assets” dla obrazków wgrywanych w kreatorze formularzy.
-- Publiczny odczyt (obrazki są renderowane na publicznej stronie /f/[slug]),
-- zapis/edycja/usuwanie tylko dla zalogowanych (panel admina).
-- Wklej w Supabase → SQL Editor → Run (bezpieczne do wielokrotnego uruchomienia).
-- ════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('form-assets', 'form-assets', true)
on conflict (id) do update set public = true;

-- Publiczny odczyt plików z tego bucketa.
drop policy if exists "form-assets public read" on storage.objects;
create policy "form-assets public read" on storage.objects
  for select using (bucket_id = 'form-assets');

-- Upload tylko dla zalogowanych (właściciel panelu).
drop policy if exists "form-assets auth insert" on storage.objects;
create policy "form-assets auth insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'form-assets');

-- Nadpisanie/zamiana pliku — zalogowani.
drop policy if exists "form-assets auth update" on storage.objects;
create policy "form-assets auth update" on storage.objects
  for update to authenticated using (bucket_id = 'form-assets');

-- Usuwanie pliku — zalogowani.
drop policy if exists "form-assets auth delete" on storage.objects;
create policy "form-assets auth delete" on storage.objects
  for delete to authenticated using (bucket_id = 'form-assets');
