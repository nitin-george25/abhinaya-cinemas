-- ============================================================================
-- Staging dummy-data seeder (pg_cron, Vault-gated)
--
-- Seeds a full day of programme + linked entries for EVERY screen so features
-- can be tested in staging without hand-entering data. Runs daily; also
-- callable on demand:  select public.seed_dummy_day();          -- today (IST)
--                      select public.seed_dummy_day(date '...') -- any date
--
-- PARITY (same pattern as the digest crons): this migration applies to BOTH
-- staging and prod and hard-codes nothing environment-specific. The cron job
-- is registered everywhere but no-ops unless the Vault flag exists. Set it in
-- STAGING ONLY (SQL editor, value not committed):
--   select vault.create_secret('true', 'dummy_seed_enabled');
-- (Never set it in prod. To pause: vault.update_secret to 'false'.)
--
-- Coverage per seeded day — everything derived from config.data at run time
-- (screens, active classes, price cards, first two movies):
--   • 4 shows per screen (10:30 / 13:30 / 17:30 / 21:30) + one CANCELLED row
--     on the first screen (cancelled-show rendering)
--   • entries linked by scheduleId; varied tickets per class incl. a
--     zero-ticket class on every show and one all-zero show ("from–NA" serials)
--   • freePass + online ₹ on the first screen's first/second shows
--   • per-day share override (55) on the first screen's entry; cancelledShows=1
--   • same movie on BOTH screens' first show → rep-batta pooling path
--   • second movie on screen 2 with its LAST scheduled show left un-entered
--     ("Not entered" state) and repBattaWaived=true (waiver feature)
--   • an OFF-PROGRAMME entry (movie 2 on screen 1, no schedule row)
--
-- Idempotent per day: rows previously written by 'dummy-seeder' for that date
-- are wiped and re-created. Manually-created rows for the same
-- (date, movie, screen) key are overwritten by the upsert — acceptable in
-- staging, and the job never runs in prod.
-- ============================================================================

create extension if not exists pg_cron with schema extensions;

create or replace function public.seed_dummy_day(
  seed_date date default (now() at time zone 'Asia/Kolkata')::date
) returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  cfg        jsonb;
  scr        jsonb;
  scr_no     int := 0;
  m1         text;
  m2         text;
  cin        text;
  times      text[] := array['10:30','13:30','17:30','21:30'];
  sid        text;
  card_id    text;
  cls_ids    text[];
  sched_id   text;
  movie_for  text;
  shows_j    jsonb;
  rows_j     jsonb;
  t_no       int;
  c_no       int;
  tkts       int;
  n_sched    int := 0;
  n_ent      int := 0;
  flag       text;
begin
  -- Belt and braces: the function ITSELF refuses to run unless the staging
  -- flag is set, so even a manual call in prod is a safe no-op.
  select decrypted_secret into flag from vault.decrypted_secrets
  where name = 'dummy_seed_enabled' limit 1;
  if flag is distinct from 'true' then
    return 'dummy_seed_enabled flag not set to true in this environment - refusing to seed';
  end if;

  select data into cfg from public.config where id = 1;
  if cfg is null then return 'no config row - skipped'; end if;

  -- First two movies in the catalog (m2 may be null on a thin catalog).
  select c->>'id' into m1 from jsonb_array_elements(cfg->'movies') with ordinality t(c, o)
    order by o limit 1;
  select c->>'id' into m2 from jsonb_array_elements(cfg->'movies') with ordinality t(c, o)
    order by o offset 1 limit 1;
  if m1 is null then return 'no movies in catalog - skipped'; end if;

  select cinema_id into cin from public.screens limit 1;

  -- Wipe this date's previous seed (only rows we created).
  delete from public.entries        where entry_date    = seed_date and updated_by = 'dummy-seeder';
  delete from public.show_schedules where schedule_date = seed_date and updated_by = 'dummy-seeder';

  for scr in
    select s from jsonb_array_elements(cfg->'screens') with ordinality t(s, o) order by o
  loop
    scr_no  := scr_no + 1;
    sid     := scr->>'id';
    card_id := scr->'priceCards'->0->>'id';

    -- Active class ids for this screen, in assignment order.
    select array_agg(a->>'classId' order by o) into cls_ids
    from jsonb_array_elements(scr->'classes') with ordinality t(a, o)
    where coalesce((a->>'active')::boolean, true);
    if cls_ids is null then continue; end if;

    shows_j := '[]'::jsonb;

    for t_no in 1 .. array_length(times, 1) loop
      sched_id  := 'ds' || substr(md5(seed_date::text || sid || times[t_no]), 1, 8);
      -- Screen 1: movie 1 throughout. Screen 2+: movie 1 on the first show
      -- (cross-screen pooling), movie 2 (if any) on the rest.
      movie_for := case when scr_no = 1 or t_no = 1 then m1 else coalesce(m2, m1) end;

      insert into public.show_schedules
        (id, cinema_id, schedule_date, screen_id, movie_id, price_card_id,
         showtime, position, cancelled, updated_by, updated_at)
      values
        (sched_id, cin, seed_date, sid, movie_for, card_id,
         times[t_no], t_no - 1, false, 'dummy-seeder', now())
      on conflict (id) do update
        set movie_id = excluded.movie_id, showtime = excluded.showtime,
            cancelled = false, updated_by = 'dummy-seeder', updated_at = now();
      n_sched := n_sched + 1;

      -- Entered show for this slot — except screen 2's LAST slot, left
      -- un-entered to exercise the "Not entered" state.
      if scr_no >= 2 and t_no = array_length(times, 1) then continue; end if;

      rows_j := '{}'::jsonb;
      for c_no in 1 .. array_length(cls_ids, 1) loop
        tkts := case
          when t_no = 3 then 0                    -- all-zero show → "from–NA"
          when c_no = 1 then 30 + t_no * 4
          when c_no = 2 then 15 + t_no * 2
          when c_no = 3 then 5
          else 0                                  -- zero-ticket class every show
        end;
        rows_j := rows_j || jsonb_build_object(cls_ids[c_no], jsonb_build_object('tickets', tkts));
      end loop;

      shows_j := shows_j || jsonb_build_array(
        jsonb_build_object(
          'showtime',   times[t_no],
          'priceCardId', card_id,
          'scheduleId', sched_id,
          'rows',       rows_j
        )
        || case when scr_no = 1 and t_no = 1 then jsonb_build_object('freePass', 2)  else '{}'::jsonb end
        || case when scr_no = 1 and t_no = 2 then jsonb_build_object('online', 12345) else '{}'::jsonb end
      );
    end loop;

    -- One cancelled programme row on the first screen.
    if scr_no = 1 then
      insert into public.show_schedules
        (id, cinema_id, schedule_date, screen_id, movie_id, price_card_id,
         showtime, position, cancelled, updated_by, updated_at)
      values
        ('ds' || substr(md5(seed_date::text || sid || '23:45'), 1, 8), cin, seed_date,
         sid, m1, card_id, '23:45', array_length(times, 1), true, 'dummy-seeder', now())
      on conflict (id) do nothing;
      n_sched := n_sched + 1;
    end if;

    if scr_no = 1 then
      -- Screen 1: one entry, movie 1 — share override + a cancelled show.
      insert into public.entries
        (entry_date, movie_id, screen_id, cinema_id, share, shows,
         cancelled_shows, rep_batta_waived, updated_by, updated_at)
      values
        (seed_date, m1, sid, cin, 55, shows_j, 1, false, 'dummy-seeder', now())
      on conflict (entry_date, movie_id, screen_id) do update
        set shows = excluded.shows, share = excluded.share,
            cancelled_shows = excluded.cancelled_shows,
            rep_batta_waived = excluded.rep_batta_waived,
            updated_by = 'dummy-seeder', updated_at = now();
      n_ent := n_ent + 1;

      -- Off-programme entry: movie 2 on screen 1 with NO schedule row.
      if m2 is not null then
        insert into public.entries
          (entry_date, movie_id, screen_id, cinema_id, share, shows,
           cancelled_shows, rep_batta_waived, updated_by, updated_at)
        values
          (seed_date, m2, sid, cin, null,
           jsonb_build_array(jsonb_build_object(
             'showtime', '12:00', 'priceCardId', card_id,
             'rows', jsonb_build_object(cls_ids[1], jsonb_build_object('tickets', 25)))),
           0, false, 'dummy-seeder', now())
        on conflict (entry_date, movie_id, screen_id) do update
          set shows = excluded.shows, updated_by = 'dummy-seeder', updated_at = now();
        n_ent := n_ent + 1;
      end if;
    else
      -- Screen 2+: split the built shows between movie 1 (first show) and
      -- movie 2 (rest). Movie 2's entry is rep-batta-waived.
      insert into public.entries
        (entry_date, movie_id, screen_id, cinema_id, share, shows,
         cancelled_shows, rep_batta_waived, updated_by, updated_at)
      values
        (seed_date, m1, sid, cin, null,
         jsonb_build_array(shows_j->0), 0, false, 'dummy-seeder', now())
      on conflict (entry_date, movie_id, screen_id) do update
        set shows = excluded.shows, updated_by = 'dummy-seeder', updated_at = now();
      n_ent := n_ent + 1;

      if m2 is not null and jsonb_array_length(shows_j) > 1 then
        insert into public.entries
          (entry_date, movie_id, screen_id, cinema_id, share, shows,
           cancelled_shows, rep_batta_waived, updated_by, updated_at)
        values
          (seed_date, m2, sid, cin, null,
           shows_j - 0, 0, true, 'dummy-seeder', now())
        on conflict (entry_date, movie_id, screen_id) do update
          set shows = excluded.shows, rep_batta_waived = true,
              updated_by = 'dummy-seeder', updated_at = now();
        n_ent := n_ent + 1;
      end if;
    end if;
  end loop;

  return format('seeded %s: %s schedule rows, %s entries', seed_date, n_sched, n_ent);
end
$fn$;

comment on function public.seed_dummy_day is
  'Staging test-data generator: seeds a day of programme + linked entries for every screen. Cron-gated by vault secret dummy_seed_enabled (staging only).';

-- ── cron registration (both envs; Vault flag decides where it acts) ─────────
do $$
declare j bigint;
begin
  for j in select jobid from cron.job where jobname = 'abhinaya-staging-dummy-seed' loop
    perform cron.unschedule(j);
  end loop;
end $$;

-- 03:30 UTC = 09:00 IST daily.
select cron.schedule('abhinaya-staging-dummy-seed', '30 3 * * *', $cron$
do $job$
declare
  flag text := (select decrypted_secret from vault.decrypted_secrets
                where name = 'dummy_seed_enabled' limit 1);
begin
  -- Flag absent / not 'true' (i.e. prod) -> no-op, no data, no error.
  if flag is distinct from 'true' then return; end if;
  perform public.seed_dummy_day();
end
$job$;
$cron$);
