-- migration_scraped_leads_rejected.sql
-- Dodaje status 'rejected' do scraped_leads (Archiwum). Lead odrzucony przez
-- użytkownika NIE trafia do Prospectingu — zostaje zachowany do wglądu w
-- zakładce „Archiwum”, ale znika z aktywnej listy „Leady”. Uruchom raz w
-- Supabase SQL editor. Bezpieczne do wielokrotnego uruchomienia.

alter table scraped_leads drop constraint if exists scraped_leads_status_check;

alter table scraped_leads
  add constraint scraped_leads_status_check
  check (status in ('new', 'moved', 'duplicate', 'rejected'));
