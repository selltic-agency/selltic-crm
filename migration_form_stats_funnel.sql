-- ════════════════════════════════════════════════════════════════════════
-- item 5 — POPRAWA LEJKA KROKOWEGO w form_stats().
--
-- Dawniej lejek liczył ODRĘBNIE zdarzenia `step_viewed`/`step_completed` per
-- indeks kroku (count distinct session_id). Skutek: liczby bywały niemonotoniczne
-- (krok 3 mógł mieć więcej niż krok 2 przy rozgałęzieniach), a „ukończyło" myliło
-- się z „dotarło do następnego". To dawało błędne/mylące statystyki.
--
-- Nowe podejście — KUMULACYJNY lejek liczony po UNIKALNYCH użytkownikach:
--   • dla każdego kroku i liczymy, ilu RÓŻNYCH gości (visitor_id) DOTARŁO do
--     tego kroku, tj. ich sesja osiągnęła max_step >= i;
--   • jest z natury monotonicznie malejący (kto dotarł do kroku 3, dotarł też
--     do 1 i 2) — dokładnie jak oczekuje użytkownik:
--       „10 weszło → 1. stronę widziało 10, 2 wyszły → 2. pytanie 8, itd.".
--   • liczba kroków bierze się z total_steps sesji (= liczba kroków formularza),
--     więc lejek pokrywa cały formularz.
--
-- Bezpieczne do wielokrotnego uruchomienia (create or replace).
-- Wklej w Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════

create or replace function form_stats(p_form_id uuid, p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_uid   uuid := auth.uid();
  v_tiles jsonb;
  v_funnel jsonb;
  v_steps int;
begin
  select owner into v_owner from forms where id = p_form_id;
  if v_owner is null or v_owner is distinct from v_uid then
    raise exception 'not authorized';
  end if;

  -- Kafelki: wyświetlenia (sesje), unikalni goście, ukończenia, porzucenia.
  select jsonb_build_object(
    'views',        count(*),
    'unique_users', count(distinct visitor_id),
    'completions',  count(*) filter (where status = 'completed'),
    'abandoned',    count(*) filter (where status in ('started', 'abandoned')),
    'last_submission', max(completed_at)
  )
  into v_tiles
  from form_sessions
  where form_id = p_form_id
    and (p_since is null or started_at >= p_since);

  -- Ile kroków ma formularz (z migawki total_steps sesji, fallback do max_step).
  select coalesce(max(total_steps), max(max_step) + 1, 0)
  into v_steps
  from form_sessions
  where form_id = p_form_id
    and (p_since is null or started_at >= p_since);

  -- Kumulacyjny lejek: dla każdego kroku i — ilu UNIKALNYCH gości dotarło (max_step >= i).
  select coalesce(jsonb_agg(row_to_json(t) order by t.step_index), '[]'::jsonb)
  into v_funnel
  from (
    select
      gs.step_index,
      count(distinct s.visitor_id) as reached
    from generate_series(0, greatest(v_steps - 1, 0)) as gs(step_index)
    left join form_sessions s
      on s.form_id = p_form_id
     and (p_since is null or s.started_at >= p_since)
     and s.max_step >= gs.step_index
    -- Gdy formularz nie ma sesji, nie zwracaj sztucznego jednowierszowego lejka.
    where v_steps > 0
    group by gs.step_index
  ) t;

  return coalesce(v_tiles, '{}'::jsonb) || jsonb_build_object('funnel', coalesce(v_funnel, '[]'::jsonb));
end;
$$;

grant execute on function form_stats(uuid, timestamptz) to authenticated;
