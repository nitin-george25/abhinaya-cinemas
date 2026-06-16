-- =============================================================================
-- Distributors consolidation. The distributors table was populated with the
-- raw (dirty) names by an earlier run of the distributors migration, BEFORE
-- name normalization existed; the add-only backfill never cleaned them, so the
-- table (and the config.distributors blob the app reads) still holds every
-- spelling/case/typo variant. This collapses them to the canonical set:
--   1) normalize distributors.name to canonical,
--   2) delete duplicate rows, keeping one per (cinema, case-insensitive name)
--      — movies.distributor_id FK is ON DELETE SET NULL, so affected links null,
--   3) relink every movie to the surviving distributor by name,
--   4) rebuild config.distributors[] + movies[].distributorId from the clean table.
-- Inline VALUES (no temp tables) so it runs in the Supabase SQL editor too.
-- Idempotent: a no-op once the table is already canonical.
-- =============================================================================
begin;

-- 1) Normalize the distributor names in the table.
with dist_map(variant, canon) as (values
    ('A & A RELEASE','A&A Release'),
    ('A&A RELEASE','A&A Release'),
    ('AAN MEGA MEDIA','AAN Mega Media'),
    ('Aan Mega Media','AAN Mega Media'),
    ('AAN MEGA MEDIA RELEASE','AAN Mega Media'),
    ('aan mega media','AAN Mega Media'),
    ('AASHIRVAD CINEMAS','Aashirvad Cinemas'),
    ('AASHIRVAD CINEMAS PVT LTD','Aashirvad Cinemas'),
    ('AASHIRVAD CINEMAS LLP','Aashirvad Cinemas'),
    ('AASHIRVAD RELEASE','Aashirvad Release'),
    ('AASHIRVAD RELASE','Aashirvad Release'),
    ('ASHIRVAD RELEASE','Aashirvad Release'),
    ('aashirvad release','Aashirvad Release'),
    ('AJITH VINAYAKA FILMS PVT LTD','Ajith Vinayaka Films'),
    ('VINAYAKA FILMS','Ajith Vinayaka Films'),
    ('AJITH VINAYAKA FILMS','Ajith Vinayaka Films'),
    ('ajith vinayaka films pvt ltd','Ajith Vinayaka Films'),
    ('BHAVANA STUDIOS','Bhavana Studios'),
    ('BHAVANA STUDIOUS','Bhavana Studios'),
    ('BHAVANA STUDIOES','Bhavana Studios'),
    ('CELEBRATE CINEAMS','Celebrate Cinema'),
    ('CELEBRATE CINEMA','Celebrate Cinema'),
    ('celebrate cinema','Celebrate Cinema'),
    ('CENTRAL PICTURES','Central Pictures'),
    ('central pictures','Central Pictures'),
    ('Central pictures','Central Pictures'),
    ('CENTRAL  PICTURES','Central Pictures'),
    ('CENTURY','Century Films'),
    ('CENTURY FILMS','Century Films'),
    ('century','Century Films'),
    ('Century','Century Films'),
    ('CENTURY RELEASE','Century Films'),
    ('DISNEY','Disney'),
    ('disney','Disney'),
    ('DREAM BIG FILMS','Dream Big Films'),
    ('DREAM BIG','Dream Big Films'),
    ('dream big films','Dream Big Films'),
    ('DREAMBIG FILMS','Dream Big Films'),
    ('E4 ENTERTAINMENTS','E4 Entertainment'),
    ('E4 ENTERTAINMENT','E4 Entertainment'),
    ('E4 Entertainments','E4 Entertainment'),
    ('E4 ENTERTAINMNETS','E4 Entertainment'),
    ('E4 entertainments','E4 Entertainment'),
    ('FESTIVAL CINEMAS','Festival Cinemas'),
    ('FRIDAY FILM HOUSE','Friday Film House'),
    ('GOODWILL ENTERTAINMENTS','Goodwill Entertainments'),
    ('GOODWILL','Goodwill Entertainments'),
    ('GOODWILL ENETERTAINMENTS','Goodwill Entertainments'),
    ('GOODWILL ENETRTAINMENTS','Goodwill Entertainments'),
    ('GOODWILL FILMS','Goodwill Entertainments'),
    ('HM ASSOCIATES PRIVATE LTD','HM Associates'),
    ('HM ASSOCIATES','HM Associates'),
    ('ICON CINEMAS','Icon Cinemas'),
    ('icon cinemas','Icon Cinemas'),
    ('Icon cinemas','Icon Cinemas'),
    ('jawahar films','Jawahar Films'),
    ('JAWAHAR FILMS','Jawahar Films'),
    ('KOKERS MEDIA','Kokers Media Entertainments'),
    ('KOKERS MEDIA ENTERTAINMENTS','Kokers Media Entertainments'),
    ('MAGIC FRAMES','Magic Frames'),
    ('magic frames','Magic Frames'),
    ('Magic frames','Magic Frames'),
    ('MAGIC  FRAMES','Magic Frames'),
    ('MOONSHOT ENTERTAINMENTS','Moonshot Entertainments'),
    ('MOON SHOT ENTERTAINMENTS','Moonshot Entertainments'),
    ('Pvr Inox Pictures','PVR Inox Pictures'),
    ('PVR INOX PICTURES','PVR Inox Pictures'),
    ('RD ILLUMINATIONS','RD Illuminations'),
    ('R D ILUMINATIONS','RD Illuminations'),
    ('RD ILUMINATIONS','RD Illuminations'),
    ('RAJAPUTRA RELEASE','Rejaputhra Visual Media'),
    ('REJAPUTHRA RELEASE','Rejaputhra Visual Media'),
    ('RAJAPUTHRA VISUAL MEDIA','Rejaputhra Visual Media'),
    ('THE GREEN ROOM','The Green Room'),
    ('GREEN ROOM RELEASE','The Green Room'),
    ('THOMAS THIRUVALLA FILMS','Thomas Thiruvalla Films'),
    ('URVASHI THEATERS','Urvashi Theatres'),
    ('URVASHI THEATERES','Urvashi Theatres'),
    ('urvashi','Urvashi Theatres'),
    ('UTV','UTV Software Communications Ltd'),
    ('UTV SOFTWARE COMMUNICATION PVT LTD','UTV Software Communications Ltd'),
    ('UTV SOFTWARE COMMUNICATION LTD','UTV Software Communications Ltd'),
    ('utv software communication pvt ltd','UTV Software Communications Ltd'),
    ('WAYFARER FILMS','Wayfarer Films'),
    ('WAYFARE FILMS','Wayfarer Films'),
    ('wayfarer films','Wayfarer Films'),
    ('WORLD WIDE FILMS','World Wide Films')
)
update public.distributors d
set name = dm.canon, updated_by = 'dist-consolidate', updated_at = now()
from dist_map dm
where d.name = dm.variant and d.name is distinct from dm.canon;

-- 2) Delete duplicate rows, keeping the lexicographically-first id per
--    (cinema, case-insensitive trimmed name). Nulls any movie links to the
--    deleted rows via the ON DELETE SET NULL FK; step 3 restores them.
delete from public.distributors d
where d.id <> (
  select min(d2.id) from public.distributors d2
  where d2.cinema_id = d.cinema_id
    and lower(btrim(d2.name)) = lower(btrim(d.name))
);

-- 3) Relink every movie to its surviving distributor by (now-clean) name.
update public.movies m
set distributor_id = d.id, updated_by = 'dist-consolidate', updated_at = now()
from public.distributors d
where d.cinema_id = m.cinema_id
  and lower(btrim(d.name)) = lower(btrim(m.distributor))
  and m.distributor is not null and btrim(m.distributor) <> ''
  and m.distributor_id is distinct from d.id;

-- 4) Rebuild the config blob: distributors[] from the clean table, and
--    re-point movies[].distributorId (dropping any stale link).
do $$
declare v_arr jsonb; v_namemap jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'name', name,
           'pocName', poc_name, 'pocContact', poc_contact, 'pocEmail', poc_email
         ) order by name), '[]'::jsonb),
         coalesce(jsonb_object_agg(lower(btrim(name)), id), '{}'::jsonb)
    into v_arr, v_namemap
    from public.distributors where archived_at is null;

  update public.config c
     set data = jsonb_set(
       jsonb_set(c.data, '{distributors}', v_arr, true),
       '{movies}',
       coalesce((
         select jsonb_agg(
           case when mv->>'distributor' is not null
                 and btrim(mv->>'distributor') <> ''
                 and v_namemap ? lower(btrim(mv->>'distributor'))
                then mv || jsonb_build_object('distributorId',
                                              v_namemap -> lower(btrim(mv->>'distributor')))
                else mv - 'distributorId'
           end)
         from jsonb_array_elements(c.data->'movies') mv
       ), c.data->'movies'),
       true),
         updated_by = 'dist-consolidate', updated_at = now()
   where c.id = 1 and jsonb_typeof(c.data->'movies') = 'array';
end$$;

commit;

-- VERIFY:
--   select count(*) from public.distributors;                       -- ~109
--   select jsonb_array_length(data->'distributors') from public.config where id=1;
--   select count(*) from public.movies where distributor is not null
--     and btrim(distributor)<>'' and distributor_id is null;        -- expect 0
