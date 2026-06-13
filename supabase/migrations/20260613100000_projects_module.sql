-- ============================================================================
-- Project Management module — Renovations tracker.
--
-- WHY THIS EXISTS
-- ---------------
-- Renovation/upgrade projects (e.g. the Audi 1 Dolby Atmos rebuild) were being
-- tracked in throwaway HTML files whose check-offs lived in one browser's
-- localStorage — per-device, lost on a cache clear, invisible to anyone else.
-- This moves projects into first-class, cinema-scoped, RLS-protected tables so
-- the owner, the assigned project manager and assigned staff all see (and can
-- update) the same plan, with an immutable trail of who ticked what and when.
--
-- WHAT THIS DOES
-- --------------
--   a) Tables: projects, project_members, project_phases, project_tasks,
--      project_subtasks, project_task_files, project_audit.
--   b) Assignment model: an OWNER assigns one PROJECT MANAGER (a member row
--      with role_in_project = 'project_manager'); the project manager (or
--      owner) assigns further members (managers / daily managers). Only the
--      owner or assigned members may tick tasks/subtasks — enforced by RLS via
--      is_project_member().
--   c) Per-task file attachments (project_task_files + a `project-files`
--      storage bucket).
--   d) Subtasks: the project manager can break a task into subtasks; the app
--      derives a task's % completion from its subtasks.
--   e) Audit trail: BEFORE-UPDATE triggers stamp done_at/done_by and write an
--      immutable project_audit row whenever a task or subtask is (un)ticked.
--   f) Seeds the existing "Audi 1 — Dolby Atmos & Acoustic Renovation" project
--      (7 phases, 19 tasks, 11 Jun → 1 Jul 2026) so the module is populated on
--      first open. Deterministic seed ids → safe to re-run.
--
-- RLS reuses the existing helpers: cinema_access(uuid), is_owner(),
-- is_owner_or_manager(). New helpers (project_cinema, is_project_member,
-- is_project_manager_or_owner) are added below.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Run on BOTH
-- staging and prod. Idempotent / safe to re-run.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Tables
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
  id                     text primary key default gen_random_uuid()::text,
  cinema_id              uuid not null references public.cinemas(id) on delete restrict,
  category               text not null default 'renovation',
  name                   text not null,
  location               text,          -- e.g. "HQ"
  area                   text,          -- e.g. "Audi 1"
  project_type           text,          -- e.g. "Technical Upgrade"
  summary                text,          -- one-line scope subtitle
  status                 text not null default 'active'
                           check (status in ('planning','active','on_hold','completed','archived')),
  start_date             date,
  target_finish          date,
  project_manager_email  text,
  created_by             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             text,
  archived_at            timestamptz
);
create index if not exists projects_cinema_idx on public.projects (cinema_id) where archived_at is null;
create index if not exists projects_category_idx on public.projects (category);

create table if not exists public.project_members (
  id               text primary key default gen_random_uuid()::text,
  project_id       text not null references public.projects(id) on delete cascade,
  user_email       text not null,
  role_in_project  text not null default 'member'
                     check (role_in_project in ('project_manager','member')),
  assigned_by      text,
  assigned_at      timestamptz not null default now(),
  unique (project_id, user_email)
);
create index if not exists project_members_project_idx on public.project_members (project_id);

create table if not exists public.project_phases (
  id          text primary key default gen_random_uuid()::text,
  project_id  text not null references public.projects(id) on delete cascade,
  seq         int not null default 0,
  name        text not null,
  color       text
);
create index if not exists project_phases_project_idx on public.project_phases (project_id);

create table if not exists public.project_tasks (
  id            text primary key default gen_random_uuid()::text,
  project_id    text not null references public.projects(id) on delete cascade,
  phase_id      text not null references public.project_phases(id) on delete cascade,
  seq           int not null default 0,
  code          text,
  name          text not null,
  note          text,
  start_date    date,
  end_date      date,
  is_milestone  boolean not null default false,
  done          boolean not null default false,
  done_at       timestamptz,
  done_by       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text
);
create index if not exists project_tasks_project_idx on public.project_tasks (project_id);
create index if not exists project_tasks_phase_idx on public.project_tasks (phase_id);

create table if not exists public.project_subtasks (
  id          text primary key default gen_random_uuid()::text,
  project_id  text not null references public.projects(id) on delete cascade,
  task_id     text not null references public.project_tasks(id) on delete cascade,
  seq         int not null default 0,
  name        text not null,
  done        boolean not null default false,
  done_at     timestamptz,
  done_by     text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists project_subtasks_task_idx on public.project_subtasks (task_id);
create index if not exists project_subtasks_project_idx on public.project_subtasks (project_id);

create table if not exists public.project_task_files (
  id            text primary key default gen_random_uuid()::text,
  project_id    text not null references public.projects(id) on delete cascade,
  task_id       text not null references public.project_tasks(id) on delete cascade,
  file_url      text not null,
  file_name     text,
  file_size     bigint,
  content_type  text,
  uploaded_by   text,
  uploaded_at   timestamptz not null default now()
);
create index if not exists project_task_files_task_idx on public.project_task_files (task_id);

create table if not exists public.project_audit (
  id           bigint generated always as identity primary key,
  project_id   text not null references public.projects(id) on delete cascade,
  task_id      text,
  subtask_id   text,
  action       text not null,
  actor_email  text,
  detail       jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists project_audit_project_idx on public.project_audit (project_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 2) updated_at triggers (reuse shared touch fn if present)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'touch_updated_at') then
    drop trigger if exists projects_touch on public.projects;
    create trigger projects_touch before update on public.projects
      for each row execute function public.touch_updated_at();
    drop trigger if exists project_tasks_touch on public.project_tasks;
    create trigger project_tasks_touch before update on public.project_tasks
      for each row execute function public.touch_updated_at();
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- 3) RLS helper functions
-- ----------------------------------------------------------------------------
create or replace function public.project_cinema(p_project_id text)
  returns uuid language sql stable security definer set search_path = public
as $$ select cinema_id from public.projects where id = p_project_id $$;

-- Owner (global) OR an assigned member of this project.
create or replace function public.is_project_member(p_project_id text)
  returns boolean language plpgsql stable security definer set search_path = public
as $$
begin
  if public.is_owner() then return true; end if;
  return exists (
    select 1 from public.project_members
     where project_id = p_project_id
       and lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
end;
$$;

-- Owner (global) OR the assigned PROJECT MANAGER of this project.
create or replace function public.is_project_manager_or_owner(p_project_id text)
  returns boolean language plpgsql stable security definer set search_path = public
as $$
begin
  if public.is_owner() then return true; end if;
  return exists (
    select 1 from public.project_members
     where project_id = p_project_id
       and role_in_project = 'project_manager'
       and lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) Tick triggers — stamp done_at/done_by + write the immutable audit trail.
--    SECURITY DEFINER so the audit insert is authoritative (bypasses the
--    audit table's read-only RLS) and can't be forged from the client.
-- ----------------------------------------------------------------------------
create or replace function public.fn_project_task_tick()
  returns trigger language plpgsql security definer set search_path = public
as $$
declare v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if NEW.done is distinct from OLD.done then
    NEW.done_at := case when NEW.done then now() else null end;
    NEW.done_by := case when NEW.done then v_actor else null end;
    insert into public.project_audit (project_id, task_id, action, actor_email, detail)
    values (NEW.project_id, NEW.id,
            case when NEW.done then 'task_checked' else 'task_unchecked' end,
            v_actor,
            jsonb_build_object('code', NEW.code, 'name', NEW.name));
  end if;
  return NEW;
end;
$$;

drop trigger if exists project_tasks_tick on public.project_tasks;
create trigger project_tasks_tick before update on public.project_tasks
  for each row execute function public.fn_project_task_tick();

create or replace function public.fn_project_subtask_tick()
  returns trigger language plpgsql security definer set search_path = public
as $$
declare v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if NEW.done is distinct from OLD.done then
    NEW.done_at := case when NEW.done then now() else null end;
    NEW.done_by := case when NEW.done then v_actor else null end;
    insert into public.project_audit (project_id, task_id, subtask_id, action, actor_email, detail)
    values (NEW.project_id, NEW.task_id, NEW.id,
            case when NEW.done then 'subtask_checked' else 'subtask_unchecked' end,
            v_actor,
            jsonb_build_object('name', NEW.name));
  end if;
  return NEW;
end;
$$;

drop trigger if exists project_subtasks_tick on public.project_subtasks;
create trigger project_subtasks_tick before update on public.project_subtasks
  for each row execute function public.fn_project_subtask_tick();

-- ----------------------------------------------------------------------------
-- 5) RLS policies
-- ----------------------------------------------------------------------------
alter table public.projects           enable row level security;
alter table public.project_members    enable row level security;
alter table public.project_phases     enable row level security;
alter table public.project_tasks      enable row level security;
alter table public.project_subtasks   enable row level security;
alter table public.project_task_files enable row level security;
alter table public.project_audit      enable row level security;

-- projects: any cinema user reads; owner/manager create+edit; owner deletes.
drop policy if exists projects_read on public.projects;
drop policy if exists projects_ins  on public.projects;
drop policy if exists projects_upd  on public.projects;
drop policy if exists projects_del  on public.projects;
create policy projects_read on public.projects for select using (public.cinema_access(cinema_id));
create policy projects_ins  on public.projects for insert with check (public.cinema_access(cinema_id) and public.is_owner_or_manager());
create policy projects_upd  on public.projects for update using (public.cinema_access(cinema_id) and public.is_owner_or_manager())
                                                          with check (public.cinema_access(cinema_id) and public.is_owner_or_manager());
create policy projects_del  on public.projects for delete using (public.cinema_access(cinema_id) and public.is_owner());

-- members: cinema users read; PM/owner manage assignments.
drop policy if exists project_members_read  on public.project_members;
drop policy if exists project_members_write on public.project_members;
create policy project_members_read on public.project_members for select using (public.cinema_access(public.project_cinema(project_id)));
create policy project_members_write on public.project_members for all
  using (public.is_project_manager_or_owner(project_id))
  with check (public.is_project_manager_or_owner(project_id));

-- phases: cinema users read; PM/owner define structure.
drop policy if exists project_phases_read  on public.project_phases;
drop policy if exists project_phases_write on public.project_phases;
create policy project_phases_read on public.project_phases for select using (public.cinema_access(public.project_cinema(project_id)));
create policy project_phases_write on public.project_phases for all
  using (public.is_project_manager_or_owner(project_id))
  with check (public.is_project_manager_or_owner(project_id));

-- tasks: cinema users read; PM/owner add+remove; assigned members may UPDATE
-- (this is what lets them tick — done_at/done_by/audit are set by trigger).
drop policy if exists project_tasks_read on public.project_tasks;
drop policy if exists project_tasks_ins  on public.project_tasks;
drop policy if exists project_tasks_upd  on public.project_tasks;
drop policy if exists project_tasks_del  on public.project_tasks;
create policy project_tasks_read on public.project_tasks for select using (public.cinema_access(public.project_cinema(project_id)));
create policy project_tasks_ins  on public.project_tasks for insert with check (public.is_project_manager_or_owner(project_id));
create policy project_tasks_upd  on public.project_tasks for update using (public.is_project_member(project_id))
                                                                    with check (public.is_project_member(project_id));
create policy project_tasks_del  on public.project_tasks for delete using (public.is_project_manager_or_owner(project_id));

-- subtasks: cinema users read; PM/owner create+remove; members may tick (update).
drop policy if exists project_subtasks_read on public.project_subtasks;
drop policy if exists project_subtasks_ins  on public.project_subtasks;
drop policy if exists project_subtasks_upd  on public.project_subtasks;
drop policy if exists project_subtasks_del  on public.project_subtasks;
create policy project_subtasks_read on public.project_subtasks for select using (public.cinema_access(public.project_cinema(project_id)));
create policy project_subtasks_ins  on public.project_subtasks for insert with check (public.is_project_manager_or_owner(project_id));
create policy project_subtasks_upd  on public.project_subtasks for update using (public.is_project_member(project_id))
                                                                          with check (public.is_project_member(project_id));
create policy project_subtasks_del  on public.project_subtasks for delete using (public.is_project_manager_or_owner(project_id));

-- task files: cinema users read; assigned members upload; PM/owner delete.
drop policy if exists project_task_files_read on public.project_task_files;
drop policy if exists project_task_files_ins  on public.project_task_files;
drop policy if exists project_task_files_del  on public.project_task_files;
create policy project_task_files_read on public.project_task_files for select using (public.cinema_access(public.project_cinema(project_id)));
create policy project_task_files_ins  on public.project_task_files for insert with check (public.is_project_member(project_id));
create policy project_task_files_del  on public.project_task_files for delete using (public.is_project_manager_or_owner(project_id));

-- audit: read-only to cinema users. Inserts come from the SECURITY DEFINER
-- triggers above (no client INSERT policy → the trail can't be forged).
drop policy if exists project_audit_read on public.project_audit;
create policy project_audit_read on public.project_audit for select using (public.cinema_access(public.project_cinema(project_id)));

-- ----------------------------------------------------------------------------
-- 6) Storage bucket for task attachments.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('project-files', 'project-files', true)
  on conflict (id) do update set public = excluded.public;

drop policy if exists "project_files_read"   on storage.objects;
drop policy if exists "project_files_write"  on storage.objects;
drop policy if exists "project_files_update" on storage.objects;
drop policy if exists "project_files_delete" on storage.objects;

create policy "project_files_read" on storage.objects
  for select using (bucket_id = 'project-files');

create policy "project_files_write" on storage.objects
  for insert with check (
    bucket_id = 'project-files'
    and exists (
      select 1 from public.authorized_users
       where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         and role in ('owner','manager','daily_manager')
    )
  );

create policy "project_files_update" on storage.objects
  for update using (bucket_id = 'project-files' and public.is_owner());

create policy "project_files_delete" on storage.objects
  for delete using (bucket_id = 'project-files' and public.is_owner());

-- ----------------------------------------------------------------------------
-- 7) Seed — the Audi 1 Dolby Atmos / acoustic renovation (deterministic ids).
--    Skips cleanly if no cinema exists yet. start_date 2026-06-11; task dates
--    derived from the original 21-day, 7-day-week schedule.
-- ----------------------------------------------------------------------------
do $$
declare
  v_cinema uuid;
  v_owner  text := 'nitin.george@abhinayacinemas.com';
  pid      text := 'seed-audi1-renovation';
begin
  select id into v_cinema from public.cinemas order by created_at nulls last limit 1;
  if v_cinema is null then
    raise notice 'No cinema row — skipping Audi 1 project seed.';
    return;
  end if;

  insert into public.projects (id, cinema_id, category, name, location, area, project_type,
                               summary, status, start_date, target_finish,
                               project_manager_email, created_by)
  values (pid, v_cinema, 'renovation',
          'Audi 1 — Dolby Atmos & Acoustic Renovation', 'HQ', 'Audi 1', 'Technical Upgrade',
          'Sound upgrade to Dolby Atmos · PET acoustic paneling with glasswool · Screen speaker change & behind-screen acoustics · Balcony entrance & stairs redesign',
          'active', date '2026-06-11', date '2026-07-01', v_owner, 'migration:projects')
  on conflict (id) do nothing;

  insert into public.project_members (project_id, user_email, role_in_project, assigned_by)
  values (pid, v_owner, 'project_manager', 'migration:projects')
  on conflict (project_id, user_email) do nothing;

  insert into public.project_phases (id, project_id, seq, name, color) values
    ('seed-audi1-p1', pid, 1, 'Mobilization & Setup',            '#1C1C1C'),
    ('seed-audi1-p2', pid, 2, 'Procurement',                     '#E08A00'),
    ('seed-audi1-p3', pid, 3, 'Overhead Speakers (Ceiling)',     '#008BDC'),
    ('seed-audi1-p4', pid, 4, 'Side Wall Acoustic Paneling',     '#FF3720'),
    ('seed-audi1-p5', pid, 5, 'Stage, Screen & Screen Speakers', '#FF8A00'),
    ('seed-audi1-p6', pid, 6, 'Balcony & Under-Balcony Works',   '#006699'),
    ('seed-audi1-p7', pid, 7, 'Commissioning & Closeout',        '#555555')
  on conflict (id) do nothing;

  insert into public.project_tasks (id, project_id, phase_id, seq, code, name, note, start_date, end_date, is_milestone) values
    ('seed-audi1-t-1-1', pid,'seed-audi1-p1', 1,'1.1','Project kickoff & site prep','Work commenced Thursday.', date '2026-06-11', date '2026-06-11', false),
    ('seed-audi1-t-1-3', pid,'seed-audi1-p1', 2,'1.3','Final scaffold measurements & quote approval','Foldable scaffolding measurements finalised; quotation approved.', date '2026-06-12', date '2026-06-13', false),
    ('seed-audi1-t-1-2', pid,'seed-audi1-p1', 3,'1.2','Receive speakers · clean store · lay & cover flex','Speakers received today — lay flex, place speakers, cover completely to keep safe.', date '2026-06-13', date '2026-06-13', false),
    ('seed-audi1-t-2-1', pid,'seed-audi1-p2', 4,'2.1','Purchase foldable scaffolding','For overhead speaker arrangement.', date '2026-06-14', date '2026-06-15', false),
    ('seed-audi1-t-3-1', pid,'seed-audi1-p3', 5,'3.1','Lay 2 pipes across ceiling truss + hanging legs',null, date '2026-06-16', date '2026-06-18', false),
    ('seed-audi1-t-3-2', pid,'seed-audi1-p3', 6,'3.2','Wiring along piping for overhead speakers',null, date '2026-06-18', date '2026-06-20', false),
    ('seed-audi1-t-3-3', pid,'seed-audi1-p3', 7,'3.3','Install overhead Atmos speakers (ceiling)',null, date '2026-06-20', date '2026-06-21', false),
    ('seed-audi1-t-4-1', pid,'seed-audi1-p4', 8,'4.1','Erect scaffolding along both side walls (lower + balcony)',null, date '2026-06-15', date '2026-06-17', false),
    ('seed-audi1-t-4-2', pid,'seed-audi1-p4', 9,'4.2','Take exact wall measurements · issue to architects',null, date '2026-06-17', date '2026-06-18', false),
    ('seed-audi1-t-4-3', pid,'seed-audi1-p4',10,'4.3','Receive architect drawing (wall design + LED positions)','Key gating dependency.', date '2026-06-18', date '2026-06-22', true),
    ('seed-audi1-t-4-4', pid,'seed-audi1-p4',11,'4.4','Wiring along existing grooves (speakers + lights)',null, date '2026-06-22', date '2026-06-24', false),
    ('seed-audi1-t-4-5', pid,'seed-audi1-p4',12,'4.5','PET paneling + LED lights per design',null, date '2026-06-24', date '2026-06-28', false),
    ('seed-audi1-t-5-1', pid,'seed-audi1-p5',13,'5.1','Remove screen · roll onto pole · store safely',null, date '2026-06-19', date '2026-06-19', false),
    ('seed-audi1-t-5-2', pid,'seed-audi1-p5',14,'5.2','Stage redesign · change screen speakers · behind-screen acoustics',null, date '2026-06-20', date '2026-06-24', false),
    ('seed-audi1-t-5-3', pid,'seed-audi1-p5',15,'5.3','Re-install screen',null, date '2026-06-29', date '2026-06-30', false),
    ('seed-audi1-t-6-1', pid,'seed-audi1-p6',16,'6.1','Redesign balcony entrance & staircase','Per architect drawing.', date '2026-06-24', date '2026-06-28', false),
    ('seed-audi1-t-6-2', pid,'seed-audi1-p6',17,'6.2','Install under-balcony overhead speakers',null, date '2026-06-25', date '2026-06-26', false),
    ('seed-audi1-t-6-3', pid,'seed-audi1-p6',18,'6.3','PET paneling under balcony',null, date '2026-06-26', date '2026-06-29', false),
    ('seed-audi1-t-7-1', pid,'seed-audi1-p7',19,'7.1','Dolby Atmos tuning · commissioning · QC','Final sign-off.', date '2026-06-30', date '2026-07-01', true)
  on conflict (id) do nothing;
end$$;

commit;

-- ============================================================================
-- VERIFY (run after applying):
--   select count(*) from public.project_tasks where project_id = 'seed-audi1-renovation';  -- 19
--   select count(*) from public.project_phases where project_id = 'seed-audi1-renovation';  -- 7
--   -- Tick a task as an assigned user, then:
--   select action, actor_email, detail from public.project_audit order by created_at desc limit 5;
-- ============================================================================
