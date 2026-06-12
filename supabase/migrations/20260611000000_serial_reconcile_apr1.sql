-- =============================================================================
-- 2026-06-11  Audi-1/2 fiscal-year serial reconciliation (Apr 1 = 1).
-- Brings the live window into exact agreement with the physical book, verified
-- against the rebuilt archive CSV + POS. Idempotent; guarded. Apply to STAGING
-- first (already validated there), then prod. Pairs with the engine mergedEntries
-- fix (separate deploy). See project_dcr_historical_backfill memory.
-- =============================================================================
begin;

-- 1) Remove the duplicate April backfill rows (real cls_* April entries supersede
--    them). BOUNDED TO APRIL so it never touches the restored May Dridam run.
delete from public.entries
where movie_id ~ '^mh[0-9a-f]{8}$' and entry_date between '2026-04-01' and '2026-04-29'
  and movie_id <> 'mh7f6343df';   -- never delete Dridam

-- 2) Restore missing shows: Audi-1 spl shows + the Apr 9 Audi-2 show (append, guarded)
update public.entries set shows = shows || '[{"id": "9d99655a", "showtime": "23:59", "priceCardId": "de8fk1e", "online": "", "freePass": "", "lastShow": false, "rows": {"cls_royale": {"tickets": "12"}, "cls_lounge": {"tickets": "152"}, "cls_prime": {"tickets": "183"}}}]'::jsonb, updated_by='dridam-restore', updated_at=now()
where entry_date='2026-04-11' and movie_id='56byvv1' and screen_id='7gwkvh9'
  and not exists (select 1 from jsonb_array_elements(shows) s where s->>'showtime'='23:59' and s->'rows'->'cls_royale'->>'tickets'='12');
update public.entries set shows = shows || '[{"id": "f62d70c7", "showtime": "23:59", "priceCardId": "de8fk1e", "online": "", "freePass": "", "lastShow": false, "rows": {"cls_royale": {"tickets": "2"}, "cls_lounge": {"tickets": "104"}, "cls_prime": {"tickets": "73"}}}]'::jsonb, updated_by='dridam-restore', updated_at=now()
where entry_date='2026-04-12' and movie_id='56byvv1' and screen_id='7gwkvh9'
  and not exists (select 1 from jsonb_array_elements(shows) s where s->>'showtime'='23:59' and s->'rows'->'cls_royale'->>'tickets'='2');
update public.entries set shows = shows || '[{"id": "c07925d0", "showtime": "23:00", "priceCardId": "f5ty1o4", "online": "", "freePass": "", "lastShow": false, "rows": {"1u1lpa4": {"tickets": "90"}, "lp9hi7s": {"tickets": "161"}, "bsl9hd8": {"tickets": "0"}}}]'::jsonb, updated_by='dridam-restore', updated_at=now()
where entry_date='2026-04-09' and movie_id='56byvv1' and screen_id='oxnv3cw'
  and not exists (select 1 from jsonb_array_elements(shows) s where s->>'showtime'='23:00' and s->'rows'->'1u1lpa4'->>'tickets'='90');

-- 3) Restore the entire Dridam (mh7f6343df) Audi-2 run wrongly deleted by 20260609000000
insert into public.entries (entry_date,movie_id,screen_id,cinema_id,share,shows,updated_by,updated_at)
select '2026-05-12','mh7f6343df','oxnv3cw',(select cinema_id from public.screens where id='oxnv3cw'),60,'[{"id": "e99faa87", "showtime": "14:30", "priceCardId": "f5ty1o4", "online": "", "freePass": "", "lastShow": false, "rows": {"1u1lpa4": {"tickets": "10"}, "lp9hi7s": {"tickets": "14"}, "bsl9hd8": {"tickets": "1"}}}, {"id": "73bf5d71", "showtime": "10:45", "priceCardId": "f5ty1o4", "online": "", "freePass": "", "lastShow": false, "rows": {"1u1lpa4": {"tickets": "26"}, "lp9hi7s": {"tickets": "16"}, "bsl9hd8": {"tickets": "0"}}}, {"id": "a86559c4", "showtime": "17:30", "priceCardId": "f5ty1o4", "online": "", "freePass": "", "lastShow": false, "rows": {"1u1lpa4": {"tickets": "28"}, "lp9hi7s": {"tickets": "18"}, "bsl9hd8": {"tickets": "0"}}}, {"id": "1096cd21", "showtime": "19:35", "priceCardId": "f5ty1o4", "online": "", "freePass": "", "lastShow": false, "rows": {"1u1lpa4": {"tickets": "44"}, "lp9hi7s": {"tickets": "37"}, "bsl9hd8": {"tickets": "0"}}}]'::jsonb,'dridam-restore',now()
where not exists (select 1 from public.entries where entry_date='2026-05-12' and movie_id='mh7f6343df' and screen_id='oxnv3cw');
insert into public.entries (entry_date,movie_id,screen_id,cinema_id,share,shows,updated_by,updated_at)
select '2026-05-13','mh7f6343df','oxnv3cw',(select cinema_id from public.screens where id='oxnv3cw'),60,'[{"id": "f977988f", "showtime": "10:45", "priceCardId": "f5ty1o4", "online": "", "freePass": "", "lastShow": false, "rows": {"1u1lpa4": {"tickets": "7"}, "lp9hi7s": {"tickets": "21"}, "bsl9hd8": {"tickets": "1"}}}, {"id": "d61981cb", "showtime": "17:30", "priceCardId": "f5ty1o4", "online": "", "freePass": "", "lastShow": false, "rows": {"1u1lpa4": {"tickets": "35"}, "lp9hi7s": {"tickets": "16"}, "bsl9hd8": {"tickets": "3"}}}, {"id": "f27562c3", "showtime": "19:35", "priceCardId": "f5ty1o4", "online": "", "freePass": "", "lastShow": false, "rows": {"1u1lpa4": {"tickets": "10"}, "lp9hi7s": {"tickets": "11"}, "bsl9hd8": {"tickets": "3"}}}, {"id": "53614ce0", "showtime": "14:30", "priceCardId": "f5ty1o4", "online": "", "freePass": "", "lastShow": false, "rows": {"1u1lpa4": {"tickets": "17"}, "lp9hi7s": {"tickets": "14"}, "bsl9hd8": {"tickets": "0"}}}]'::jsonb,'dridam-restore',now()
where not exists (select 1 from public.entries where entry_date='2026-05-13' and movie_id='mh7f6343df' and screen_id='oxnv3cw');
insert into public.entries (entry_date,movie_id,screen_id,cinema_id,share,shows,updated_by,updated_at)
select '2026-05-15','mh7f6343df','oxnv3cw',(select cinema_id from public.screens where id='oxnv3cw'),60,'[{"id": "271a5b2f", "showtime": "10:45", "priceCardId": "f5ty1o4", "online": "", "freePass": "", "lastShow": false, "rows": {"1u1lpa4": {"tickets": "11"}, "lp9hi7s": {"tickets": "10"}, "bsl9hd8": {"tickets": "0"}}}]'::jsonb,'dridam-restore',now()
where not exists (select 1 from public.entries where entry_date='2026-05-15' and movie_id='mh7f6343df' and screen_id='oxnv3cw');
insert into public.entries (entry_date,movie_id,screen_id,cinema_id,share,shows,updated_by,updated_at)
select '2026-05-16','mh7f6343df','oxnv3cw',(select cinema_id from public.screens where id='oxnv3cw'),60,'[{"id": "79375512", "showtime": "10:45", "priceCardId": "f5ty1o4", "online": "", "freePass": "", "lastShow": false, "rows": {"1u1lpa4": {"tickets": "11"}, "lp9hi7s": {"tickets": "13"}, "bsl9hd8": {"tickets": "0"}}}]'::jsonb,'dridam-restore',now()
where not exists (select 1 from public.entries where entry_date='2026-05-16' and movie_id='mh7f6343df' and screen_id='oxnv3cw');
insert into public.entries (entry_date,movie_id,screen_id,cinema_id,share,shows,updated_by,updated_at)
select '2026-05-19','mh7f6343df','oxnv3cw',(select cinema_id from public.screens where id='oxnv3cw'),60,'[{"id": "6fbe2bba", "showtime": "10:45", "priceCardId": "f5ty1o4", "online": "", "freePass": "", "lastShow": false, "rows": {"1u1lpa4": {"tickets": "7"}, "lp9hi7s": {"tickets": "4"}, "bsl9hd8": {"tickets": "0"}}}]'::jsonb,'dridam-restore',now()
where not exists (select 1 from public.entries where entry_date='2026-05-19' and movie_id='mh7f6343df' and screen_id='oxnv3cw');

-- 4) Remove prod's phantom 2026-05-14 Patriot 23:35 show (not in book/POS). Idempotent.
update public.entries
set shows = (select jsonb_agg(s) from jsonb_array_elements(shows) s
             where not (s->>'showtime'='23:35' and coalesce(s->'rows'->'1u1lpa4'->>'tickets','0')='65')),
    updated_by='may14-dedupe', updated_at=now()
where entry_date='2026-05-14' and movie_id='moamjqo' and screen_id='oxnv3cw'
  and exists (select 1 from jsonb_array_elements(shows) s where s->>'showtime'='23:35' and s->'rows'->'1u1lpa4'->>'tickets'='65');

-- 5) Serial starts: April 1 = 1 for all classes; Royale jumps to 34 on April 2 to
--    model the physically-voided serial 33 (Aadu 3 Apr 1), so the closing serial = book.
update public.config set data = jsonb_set(data,'{serialStarts}','[{"id":"e4ujqqp","date":"2026-04-01","starts":{"cls_royale":1,"cls_lounge":1,"cls_prime":1},"screenId":"7gwkvh9"},{"id":"m8xbwh8","date":"2026-04-01","starts":{"1u1lpa4":1,"lp9hi7s":1,"bsl9hd8":1},"screenId":"oxnv3cw"},{"id":"a1roy0402","date":"2026-04-02","starts":{"cls_royale":34},"screenId":"7gwkvh9"}]'::jsonb),
    updated_by='serial-reconcile', updated_at=now() where id=1;

-- 6) Verify Apr1-Jun5 ticket totals match the book (Royale 3653 tickets; closing serial 3654).
do $$ declare n int; r record; book jsonb := '{"cls_royale":3653,"cls_lounge":35625,"cls_prime":56238,"1u1lpa4":16869,"lp9hi7s":19391,"bsl9hd8":437}';
begin for r in select key,(value)::int as b from jsonb_each_text(book) loop
  select coalesce(sum(coalesce(nullif(x.value->>'tickets','')::int,0)),0) into n
  from public.entries e cross join lateral jsonb_array_elements(e.shows) sh cross join lateral jsonb_each(sh->'rows') x
  where e.entry_date between '2026-04-01' and '2026-06-05' and x.key=r.key;
  if n <> r.b then raise exception 'class % = % expected %', r.key, n, r.b; end if;
end loop; end $$;

commit;
