-- =============================================================================
-- Movie de-duplication v2 (supersedes movie_dedup.sql). Folds each duplicate
-- movie into its canonical id, repoints entries + openings, renames the survivor
-- to its web-verified title, drops orphans from the movies table AND the
-- config.movies blob the app reads. Adrishyam/Drishyam and distinct films are
-- left untouched. Idempotent/guarded; a no-op on a DB without these ids.
-- (Mappings inlined as VALUES so it runs identically in `supabase db push` and
--  the Supabase SQL editor — no temp tables. Runs after 20260616120000 and
--  before 20260616140000_distributors.sql.)
-- =============================================================================
begin;

-- 1) Drop orphan entries colliding with the canonical on same date+screen.
with dedup_map(bf, canon) as (values
    ('mh49b42c0d','cjnx0h3'),
    ('mhad7b9991','85m6eki'),
    ('mhbe14874d','vfj13iu'),
    ('mh4283fce3','87sa8pk'),
    ('mh57e5b5c4','wc63z8s'),
    ('mhc611bdca','moamjqo'),
    ('mhb0355c79','56byvv1'),
    ('mh6a3bda94','mh4246029c'),
    ('mh9f33350c','mh470f0910'),
    ('mhca94cab8','mh68558f13'),
    ('mh8dc914a4','mhdbc5c27a'),
    ('mheb234a50','mh645770b2'),
    ('mh82ba5e37','26ammug'),
    ('mh2792c802','mh82801722'),
    ('mh384cd0f0','mhd7147730'),
    ('mhcb82766e','mh4fc30ca8'),
    ('mh5cfd9efa','mh371e70b4'),
    ('mh36e6eda3','mhc8087758'),
    ('mh15f1da09','mh06147a56'),
    ('mh2c72a85f','mh56f7030f'),
    ('mh62569d2d','mh94100c7e'),
    ('mh288639b0','mh0853ad1a'),
    ('mh8f0bfeb4','mh92ad91e2'),
    ('mha85d36c9','mh8a1fe5d7'),
    ('mhb298af61','mh6f65c807'),
    ('mh186af174','mh519d8f13'),
    ('mhf9d42fb4','mh784fca7c'),
    ('mh177247c0','mhc6c9e88d'),
    ('mha48f44cc','mhf9ace68e')
)
delete from public.entries e using dedup_map m
where e.movie_id = m.bf
  and exists (select 1 from public.entries c
              where c.movie_id = m.canon and c.entry_date = e.entry_date
                and c.screen_id = e.screen_id);

-- 2) Repoint surviving entries onto the canonical id.
with dedup_map(bf, canon) as (values
    ('mh49b42c0d','cjnx0h3'),
    ('mhad7b9991','85m6eki'),
    ('mhbe14874d','vfj13iu'),
    ('mh4283fce3','87sa8pk'),
    ('mh57e5b5c4','wc63z8s'),
    ('mhc611bdca','moamjqo'),
    ('mhb0355c79','56byvv1'),
    ('mh6a3bda94','mh4246029c'),
    ('mh9f33350c','mh470f0910'),
    ('mhca94cab8','mh68558f13'),
    ('mh8dc914a4','mhdbc5c27a'),
    ('mheb234a50','mh645770b2'),
    ('mh82ba5e37','26ammug'),
    ('mh2792c802','mh82801722'),
    ('mh384cd0f0','mhd7147730'),
    ('mhcb82766e','mh4fc30ca8'),
    ('mh5cfd9efa','mh371e70b4'),
    ('mh36e6eda3','mhc8087758'),
    ('mh15f1da09','mh06147a56'),
    ('mh2c72a85f','mh56f7030f'),
    ('mh62569d2d','mh94100c7e'),
    ('mh288639b0','mh0853ad1a'),
    ('mh8f0bfeb4','mh92ad91e2'),
    ('mha85d36c9','mh8a1fe5d7'),
    ('mhb298af61','mh6f65c807'),
    ('mh186af174','mh519d8f13'),
    ('mhf9d42fb4','mh784fca7c'),
    ('mh177247c0','mhc6c9e88d'),
    ('mha48f44cc','mhf9ace68e')
)
update public.entries e set movie_id = m.canon, updated_by = 'movie-dedup-v2', updated_at = now()
from dedup_map m where e.movie_id = m.bf;

-- 3) Repoint openings onto the canonical id, then drop any colliding leftovers.
with dedup_map(bf, canon) as (values
    ('mh49b42c0d','cjnx0h3'),
    ('mhad7b9991','85m6eki'),
    ('mhbe14874d','vfj13iu'),
    ('mh4283fce3','87sa8pk'),
    ('mh57e5b5c4','wc63z8s'),
    ('mhc611bdca','moamjqo'),
    ('mhb0355c79','56byvv1'),
    ('mh6a3bda94','mh4246029c'),
    ('mh9f33350c','mh470f0910'),
    ('mhca94cab8','mh68558f13'),
    ('mh8dc914a4','mhdbc5c27a'),
    ('mheb234a50','mh645770b2'),
    ('mh82ba5e37','26ammug'),
    ('mh2792c802','mh82801722'),
    ('mh384cd0f0','mhd7147730'),
    ('mhcb82766e','mh4fc30ca8'),
    ('mh5cfd9efa','mh371e70b4'),
    ('mh36e6eda3','mhc8087758'),
    ('mh15f1da09','mh06147a56'),
    ('mh2c72a85f','mh56f7030f'),
    ('mh62569d2d','mh94100c7e'),
    ('mh288639b0','mh0853ad1a'),
    ('mh8f0bfeb4','mh92ad91e2'),
    ('mha85d36c9','mh8a1fe5d7'),
    ('mhb298af61','mh6f65c807'),
    ('mh186af174','mh519d8f13'),
    ('mhf9d42fb4','mh784fca7c'),
    ('mh177247c0','mhc6c9e88d'),
    ('mha48f44cc','mhf9ace68e')
)
update public.openings o set movie_id = m.canon
from dedup_map m where o.movie_id = m.bf
  and not exists (select 1 from public.openings c
                  where c.movie_id = m.canon and c.screen_id = o.screen_id and c.open_date = o.open_date);
with dedup_map(bf, canon) as (values
    ('mh49b42c0d','cjnx0h3'),
    ('mhad7b9991','85m6eki'),
    ('mhbe14874d','vfj13iu'),
    ('mh4283fce3','87sa8pk'),
    ('mh57e5b5c4','wc63z8s'),
    ('mhc611bdca','moamjqo'),
    ('mhb0355c79','56byvv1'),
    ('mh6a3bda94','mh4246029c'),
    ('mh9f33350c','mh470f0910'),
    ('mhca94cab8','mh68558f13'),
    ('mh8dc914a4','mhdbc5c27a'),
    ('mheb234a50','mh645770b2'),
    ('mh82ba5e37','26ammug'),
    ('mh2792c802','mh82801722'),
    ('mh384cd0f0','mhd7147730'),
    ('mhcb82766e','mh4fc30ca8'),
    ('mh5cfd9efa','mh371e70b4'),
    ('mh36e6eda3','mhc8087758'),
    ('mh15f1da09','mh06147a56'),
    ('mh2c72a85f','mh56f7030f'),
    ('mh62569d2d','mh94100c7e'),
    ('mh288639b0','mh0853ad1a'),
    ('mh8f0bfeb4','mh92ad91e2'),
    ('mha85d36c9','mh8a1fe5d7'),
    ('mhb298af61','mh6f65c807'),
    ('mh186af174','mh519d8f13'),
    ('mhf9d42fb4','mh784fca7c'),
    ('mh177247c0','mhc6c9e88d'),
    ('mha48f44cc','mhf9ace68e')
)
delete from public.openings o using dedup_map m where o.movie_id = m.bf;

-- 4) Rename survivors to the verified canonical title (movies table).
with movie_rename(id, title) as (values
    ('cjnx0h3','Aadu 3'),
    ('85m6eki','Bharathanatyam 2 Mohiniyattam'),
    ('vfj13iu','Dhurandhar'),
    ('87sa8pk','Dhurandhar (Malayalam)'),
    ('wc63z8s','Pallichattambi'),
    ('moamjqo','Patriot'),
    ('56byvv1','Vaazha 2'),
    ('mh4246029c','Aadujeevitham'),
    ('mh470f0910','Avatar 3D'),
    ('mh68558f13','Bougainvillea'),
    ('mhdbc5c27a','Dies Irae'),
    ('mh645770b2','Dominic and the Ladies'' Purse'),
    ('26ammug','Drishyam 3'),
    ('mh82801722','The Face of the Faceless'),
    ('mhd7147730','Hridayapoorvam'),
    ('mh4fc30ca8','Kaapa'),
    ('mh371e70b4','Kalamkaval'),
    ('mhc8087758','Kalki 2898 AD'),
    ('mh06147a56','Mahaveeryar'),
    ('mh56f7030f','Manichitrathazhu'),
    ('mh94100c7e','Nadanna Sambavam'),
    ('mh0853ad1a','Neyyattinkara Gopante Aaraattu'),
    ('mh92ad91e2','Pookkaalam'),
    ('mh8a1fe5d7','Rorschach'),
    ('mh6f65c807','Thallumaala'),
    ('mh519d8f13','Thanneer Mathan Dinangal'),
    ('mh784fca7c','Thunivu'),
    ('mhc6c9e88d','Vilayath Buddha'),
    ('mhf9ace68e','Vyasanasametham Bandhumithradhikal')
)
update public.movies mv set name = r.title, updated_by = 'movie-dedup-v2', updated_at = now()
from movie_rename r where mv.id = r.id and mv.name is distinct from r.title;

-- 5) Drop orphan movies from the normalized catalog.
delete from public.movies where id in ('mh49b42c0d','mhad7b9991','mhbe14874d','mh4283fce3','mh57e5b5c4','mhc611bdca','mhb0355c79','mh6a3bda94','mh9f33350c','mhca94cab8','mh8dc914a4','mheb234a50','mh82ba5e37','mh2792c802','mh384cd0f0','mhcb82766e','mh5cfd9efa','mh36e6eda3','mh15f1da09','mh2c72a85f','mh62569d2d','mh288639b0','mh8f0bfeb4','mha85d36c9','mhb298af61','mh186af174','mhf9d42fb4','mh177247c0','mha48f44cc');

-- 6) Update the config.movies blob: drop orphans + apply the rename.
with movie_rename(id, title) as (values
    ('cjnx0h3','Aadu 3'),
    ('85m6eki','Bharathanatyam 2 Mohiniyattam'),
    ('vfj13iu','Dhurandhar'),
    ('87sa8pk','Dhurandhar (Malayalam)'),
    ('wc63z8s','Pallichattambi'),
    ('moamjqo','Patriot'),
    ('56byvv1','Vaazha 2'),
    ('mh4246029c','Aadujeevitham'),
    ('mh470f0910','Avatar 3D'),
    ('mh68558f13','Bougainvillea'),
    ('mhdbc5c27a','Dies Irae'),
    ('mh645770b2','Dominic and the Ladies'' Purse'),
    ('26ammug','Drishyam 3'),
    ('mh82801722','The Face of the Faceless'),
    ('mhd7147730','Hridayapoorvam'),
    ('mh4fc30ca8','Kaapa'),
    ('mh371e70b4','Kalamkaval'),
    ('mhc8087758','Kalki 2898 AD'),
    ('mh06147a56','Mahaveeryar'),
    ('mh56f7030f','Manichitrathazhu'),
    ('mh94100c7e','Nadanna Sambavam'),
    ('mh0853ad1a','Neyyattinkara Gopante Aaraattu'),
    ('mh92ad91e2','Pookkaalam'),
    ('mh8a1fe5d7','Rorschach'),
    ('mh6f65c807','Thallumaala'),
    ('mh519d8f13','Thanneer Mathan Dinangal'),
    ('mh784fca7c','Thunivu'),
    ('mhc6c9e88d','Vilayath Buddha'),
    ('mhf9ace68e','Vyasanasametham Bandhumithradhikal')
)
update public.config c
set data = jsonb_set(c.data, '{movies}', (
      select coalesce(jsonb_agg(
               case when r.title is not null
                    then jsonb_set(mv, '{name}', to_jsonb(r.title))
                    else mv end), '[]'::jsonb)
      from jsonb_array_elements(c.data->'movies') mv
      left join movie_rename r on r.id = mv->>'id'
      where mv->>'id' not in ('mh49b42c0d','mhad7b9991','mhbe14874d','mh4283fce3','mh57e5b5c4','mhc611bdca','mhb0355c79','mh6a3bda94','mh9f33350c','mhca94cab8','mh8dc914a4','mheb234a50','mh82ba5e37','mh2792c802','mh384cd0f0','mhcb82766e','mh5cfd9efa','mh36e6eda3','mh15f1da09','mh2c72a85f','mh62569d2d','mh288639b0','mh8f0bfeb4','mha85d36c9','mhb298af61','mh186af174','mhf9d42fb4','mh177247c0','mha48f44cc')
    )),
    updated_by = 'movie-dedup-v2', updated_at = now()
where c.id = 1 and jsonb_typeof(c.data->'movies') = 'array';

-- 7) Guard: no entry/opening may still reference a removed id (rolls back if so).
do $$ declare n int; begin
  select count(*) into n from public.entries  where movie_id in ('mh49b42c0d','mhad7b9991','mhbe14874d','mh4283fce3','mh57e5b5c4','mhc611bdca','mhb0355c79','mh6a3bda94','mh9f33350c','mhca94cab8','mh8dc914a4','mheb234a50','mh82ba5e37','mh2792c802','mh384cd0f0','mhcb82766e','mh5cfd9efa','mh36e6eda3','mh15f1da09','mh2c72a85f','mh62569d2d','mh288639b0','mh8f0bfeb4','mha85d36c9','mhb298af61','mh186af174','mhf9d42fb4','mh177247c0','mha48f44cc');
  if n > 0 then raise exception 'dedup incomplete: % entries still on an orphan id', n; end if;
  select count(*) into n from public.openings where movie_id in ('mh49b42c0d','mhad7b9991','mhbe14874d','mh4283fce3','mh57e5b5c4','mhc611bdca','mhb0355c79','mh6a3bda94','mh9f33350c','mhca94cab8','mh8dc914a4','mheb234a50','mh82ba5e37','mh2792c802','mh384cd0f0','mhcb82766e','mh5cfd9efa','mh36e6eda3','mh15f1da09','mh2c72a85f','mh62569d2d','mh288639b0','mh8f0bfeb4','mha85d36c9','mhb298af61','mh186af174','mhf9d42fb4','mh177247c0','mha48f44cc');
  if n > 0 then raise exception 'dedup incomplete: % openings still on an orphan id', n; end if;
end $$;

commit;

-- VERIFY: select id, name from public.movies order by name;
