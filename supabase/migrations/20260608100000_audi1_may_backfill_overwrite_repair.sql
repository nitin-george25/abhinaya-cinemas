-- =============================================================================
-- Repair: Audi 1 live entries 2026-05-21..30 overwritten by the DCR backfill
-- (20260606110009 upserted era-class rows a1_rc_lng/a1_rc_prm over the live
--  cls_lounge/cls_prime rows for movie 26ammug, screen 7gwkvh9 — Prime and
--  Lounge therefore read 0 in the DCR for those dates).
-- Source of truth: staging_seed_from_prod_2026-05-30.sql (prod export taken
-- 2026-05-30 00:56 UTC, before the backfill reached prod).
-- Also removes duplicate backfill entries (mh* movie ids) inserted alongside
-- live entries on the same screen-day (2026-04-30 onward, both screens).
-- Idempotent; guards ensure manually-corrected rows are never touched.
-- =============================================================================

-- 1) Restore 2026-05-21..29 exactly as they were pre-overwrite
update public.entries e
set share = v.share,
    shows = v.shows,
    updated_by = 'audi1-may-repair',
    updated_at = now()
from (values
  (date '2026-05-21', 60, '[{"id":"3l21pct","rows":{"cls_prime":{"tickets":"412"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"16"}},"online":"","freePass":"","lastShow":false,"showtime":"08:00","priceCardId":"18a8omq"},{"id":"b3qlftx","rows":{"cls_prime":{"tickets":"387"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"11:15","priceCardId":"qs31yg4"},{"id":"2zheoqa","rows":{"cls_prime":{"tickets":"403"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"14:20","priceCardId":"qs31yg4"},{"id":"9lmg3tl","rows":{"cls_prime":{"tickets":"412"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"17:30","priceCardId":"qs31yg4"},{"id":"0evkdx0","rows":{"cls_prime":{"tickets":"412"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"20:45","priceCardId":"qs31yg4"},{"id":"3t74vr3","rows":{"cls_prime":{"tickets":"396"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":true,"showtime":"23:59","priceCardId":"qs31yg4"}]'::jsonb),
  (date '2026-05-22', 60, '[{"id":"b28fjui","rows":{"cls_prime":{"tickets":"54"},"cls_lounge":{"tickets":"86"},"cls_royale":{"tickets":"4"}},"online":"","freePass":"","lastShow":false,"showtime":"08:00","priceCardId":"qs31yg4"},{"id":"zdmt9ai","rows":{"cls_prime":{"tickets":"352"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"11:15","priceCardId":"qs31yg4"},{"id":"scahrer","rows":{"cls_prime":{"tickets":"392"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"14:20","priceCardId":"qs31yg4"},{"id":"rz6rmo8","rows":{"cls_prime":{"tickets":"382"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"17:30","priceCardId":"qs31yg4"},{"id":"kx3og5b","rows":{"cls_prime":{"tickets":"407"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"20:45","priceCardId":"qs31yg4"},{"id":"pugtwck","rows":{"cls_prime":{"tickets":"346"},"cls_lounge":{"tickets":"165"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":true,"showtime":"23:59","priceCardId":"qs31yg4"}]'::jsonb),
  (date '2026-05-23', 60, '[{"id":"d4vv90z","rows":{"cls_prime":{"tickets":"80"},"cls_lounge":{"tickets":"93"},"cls_royale":{"tickets":"10"}},"online":"","freePass":"","lastShow":false,"showtime":"08:00","priceCardId":"qs31yg4"},{"id":"20112ar","rows":{"cls_prime":{"tickets":"352"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"11:15","priceCardId":"qs31yg4"},{"id":"tt7prux","rows":{"cls_prime":{"tickets":"408"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"14:20","priceCardId":"qs31yg4"},{"id":"sbxinyh","rows":{"cls_prime":{"tickets":"396"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"17:30","priceCardId":"qs31yg4"},{"id":"581qc5z","rows":{"cls_prime":{"tickets":"411"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"20:45","priceCardId":"qs31yg4"},{"id":"08r6mkz","rows":{"cls_prime":{"tickets":"356"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":true,"showtime":"23:59","priceCardId":"qs31yg4"}]'::jsonb),
  (date '2026-05-24', 60, '[{"id":"22h00v8","rows":{"cls_prime":{"tickets":"167"},"cls_lounge":{"tickets":"163"},"cls_royale":{"tickets":"19"}},"online":"","freePass":"","lastShow":false,"showtime":"08:00","priceCardId":"qs31yg4"},{"id":"3tig9fb","rows":{"cls_prime":{"tickets":"395"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"11:15","priceCardId":"qs31yg4"},{"id":"bltzi0q","rows":{"cls_prime":{"tickets":"411"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"14:20","priceCardId":"qs31yg4"},{"id":"fve4gr3","rows":{"cls_prime":{"tickets":"404"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"17:30","priceCardId":"qs31yg4"},{"id":"n1kspy5","rows":{"cls_prime":{"tickets":"412"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"20:45","priceCardId":"qs31yg4"},{"id":"e6et3lf","rows":{"cls_prime":{"tickets":"305"},"cls_lounge":{"tickets":"165"},"cls_royale":{"tickets":"19"}},"online":"","freePass":"","lastShow":true,"showtime":"23:59","priceCardId":"qs31yg4"}]'::jsonb),
  (date '2026-05-25', 60, '[{"id":"95djmuq","rows":{"cls_prime":{"tickets":"248"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"20"}},"online":"","freePass":"","lastShow":false,"showtime":"08:00","priceCardId":"qs31yg4"},{"id":"7ekeuad","rows":{"cls_prime":{"tickets":"353"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"20"}},"online":"","freePass":"","lastShow":false,"showtime":"11:15","priceCardId":"qs31yg4"},{"id":"n9dfnes","rows":{"cls_prime":{"tickets":"313"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"14:20","priceCardId":"qs31yg4"},{"id":"9pggni5","rows":{"cls_prime":{"tickets":"374"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"20"}},"online":"","freePass":"","lastShow":false,"showtime":"17:30","priceCardId":"qs31yg4"},{"id":"9rieb5r","rows":{"cls_prime":{"tickets":"152"},"cls_lounge":{"tickets":"163"},"cls_royale":{"tickets":"20"}},"online":"","freePass":"","lastShow":true,"showtime":"20:45","priceCardId":"qs31yg4"}]'::jsonb),
  (date '2026-05-26', 60, '[{"id":"vtg7jma","rows":{"cls_prime":{"tickets":"298"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"20"}},"online":"77820","freePass":"","lastShow":false,"showtime":"17:15","priceCardId":"qs31yg4"},{"id":"f5cpn1u","rows":{"cls_prime":{"tickets":"378"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"92930","freePass":"","lastShow":false,"showtime":"20:35","priceCardId":"qs31yg4"},{"id":"1jhqei2","rows":{"cls_prime":{"tickets":"123"},"cls_lounge":{"tickets":"140"}},"online":"36560","freePass":"","lastShow":true,"showtime":"23:45","priceCardId":"qs31yg4"},{"id":"2ekpz6e","rows":{"cls_prime":{"tickets":"216"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"10:45","priceCardId":"qs31yg4"},{"id":"h2y5kgn","rows":{"cls_prime":{"tickets":"303"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"","freePass":"","lastShow":false,"showtime":"14:00","priceCardId":"qs31yg4"}]'::jsonb),
  (date '2026-05-27', 60, '[{"id":"gvwd5ub","rows":{"cls_prime":{"tickets":"180"},"cls_lounge":{"tickets":"164"},"cls_royale":{"tickets":"17"}},"online":"59750","freePass":"","lastShow":false,"showtime":"10:00","priceCardId":"qs31yg4"},{"id":"y971xw8","rows":{"cls_prime":{"tickets":"273"},"cls_lounge":{"tickets":"164"},"cls_royale":{"tickets":"20"}},"online":"70080","freePass":"","lastShow":false,"showtime":"13:10","priceCardId":"qs31yg4"},{"id":"q0j9r2n","rows":{"cls_prime":{"tickets":"292"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"20"}},"online":"80330","freePass":"","lastShow":false,"showtime":"16:20","priceCardId":"qs31yg4"},{"id":"44uqyrh","rows":{"cls_prime":{"tickets":"301"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"83670","freePass":"","lastShow":false,"showtime":"19:30","priceCardId":"qs31yg4"},{"id":"1qeeoj5","rows":{"cls_prime":{"tickets":"230"},"cls_lounge":{"tickets":"161"},"cls_royale":{"tickets":"20"}},"online":"70220","freePass":"","lastShow":true,"showtime":"22:45","priceCardId":"qs31yg4"}]'::jsonb),
  (date '2026-05-28', 55, '[{"id":"7xjkauw","rows":{"cls_prime":{"tickets":"142"},"cls_lounge":{"tickets":"156"},"cls_royale":{"tickets":"17"}},"online":"49810","freePass":"","lastShow":false,"showtime":"10:00","priceCardId":"qs31yg4"},{"id":"6mzaz7v","rows":{"cls_prime":{"tickets":"241"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"20"}},"online":"68080","freePass":"","lastShow":false,"showtime":"13:10","priceCardId":"qs31yg4"},{"id":"wgysohv","rows":{"cls_prime":{"tickets":"300"},"cls_lounge":{"tickets":"164"},"cls_royale":{"tickets":"21"}},"online":"78470","freePass":"","lastShow":false,"showtime":"16:20","priceCardId":"qs31yg4"},{"id":"uvid6j2","rows":{"cls_prime":{"tickets":"331"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"21"}},"online":"88310","freePass":"","lastShow":false,"showtime":"19:30","priceCardId":"qs31yg4"},{"id":"vsifxpk","rows":{"cls_prime":{"tickets":"268"},"cls_lounge":{"tickets":"165"},"cls_royale":{"tickets":"20"}},"online":"77020","freePass":"","lastShow":true,"showtime":"22:45","priceCardId":"qs31yg4"}]'::jsonb),
  (date '2026-05-29', 55, '[{"id":"zass8ij","rows":{"cls_prime":{"tickets":"66"},"cls_lounge":{"tickets":"100"},"cls_royale":{"tickets":"4"}},"online":"23340","freePass":"","lastShow":false,"showtime":"10:00","priceCardId":"qs31yg4"},{"id":"o5l1ure","rows":{"cls_prime":{"tickets":"153"},"cls_lounge":{"tickets":"165"},"cls_royale":{"tickets":"16"}},"online":"49440","freePass":"","lastShow":false,"showtime":"13:10","priceCardId":"qs31yg4"},{"id":"jm6b3g6","rows":{"cls_prime":{"tickets":"204"},"cls_lounge":{"tickets":"158"},"cls_royale":{"tickets":"21"}},"online":"63330","freePass":"","lastShow":false,"showtime":"16:20","priceCardId":"qs31yg4"},{"id":"npi77be","rows":{"cls_prime":{"tickets":"326"},"cls_lounge":{"tickets":"166"},"cls_royale":{"tickets":"20"}},"online":"84060","freePass":"","lastShow":false,"showtime":"19:37","priceCardId":"qs31yg4"},{"id":"2g8t63r","rows":{"cls_prime":{"tickets":"168"},"cls_lounge":{"tickets":"163"},"cls_royale":{"tickets":"16"}},"online":"55420","freePass":"","lastShow":true,"showtime":"22:45","priceCardId":"18a8omq"}]'::jsonb)
) as v(entry_date, share, shows)
where e.entry_date = v.entry_date
  and e.movie_id = '26ammug'
  and e.screen_id = '7gwkvh9'
  and e.shows::text like '%a1_rc_%';

-- 2) 2026-05-30 post-dates the seed: remap era keys/cards in place.
--    Price parity verified: hec1e84 = qs31yg4 (390/180/160),
--                           h90aa57 = 18a8omq (390/180/150).
update public.entries
set shows = replace(replace(replace(replace(shows::text,
              '"a1_rc_lng"', '"cls_lounge"'),
              '"a1_rc_prm"', '"cls_prime"'),
              '"hec1e84"',   '"qs31yg4"'),
              '"h90aa57"',   '"18a8omq"')::jsonb,
    updated_by = 'audi1-may-repair',
    updated_at = now()
where entry_date = date '2026-05-30'
  and movie_id = '26ammug'
  and screen_id = '7gwkvh9'
  and shows::text like '%a1_rc_%';

-- 3) Delete duplicate backfill rows where a live entry exists for the same
--    screen-day (backfill movie ids are 'mh' + 8 hex; live ids are 7 chars)
delete from public.entries e
where e.movie_id ~ '^mh[0-9a-f]{8}$'
  and e.entry_date >= date '2026-04-30'
  and exists (
    select 1 from public.entries l
    where l.entry_date = e.entry_date
      and l.screen_id  = e.screen_id
      and l.movie_id !~ '^mh[0-9a-f]{8}$'
  );

-- 4) Fail loudly if any era keys survive in the affected window
do $$
declare n int;
begin
  select count(*) into n
  from public.entries
  where screen_id = '7gwkvh9'
    and entry_date between date '2026-05-21' and date '2026-05-31'
    and shows::text like '%a1_rc_%';
  if n > 0 then
    raise exception 'audi1 repair incomplete: % rows still carry era class keys', n;
  end if;
end $$;
