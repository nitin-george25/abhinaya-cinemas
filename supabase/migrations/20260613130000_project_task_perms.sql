-- ============================================================================
-- Project tasks — let owner/manager add & edit tasks (timeline).
--
-- Adds/edits of the task list (structure + dates) are now open to the global
-- owner and manager roles, not only the assigned project manager. Ticking is
-- unchanged: still any assigned member (is_project_member). Assigned project
-- managers are managers, so they remain covered.
--
--   insert (add task)        : cinema_access AND is_owner_or_manager()
--   update (tick OR edit)    : cinema_access AND (is_project_member OR is_owner_or_manager())
--   delete (remove task)     : cinema_access AND is_owner_or_manager()
--
-- HOW TO RUN: applied via `npm run db:push:staging` / `:prod`. Idempotent.
-- ============================================================================

begin;

drop policy if exists project_tasks_ins on public.project_tasks;
drop policy if exists project_tasks_upd on public.project_tasks;
drop policy if exists project_tasks_del on public.project_tasks;

create policy project_tasks_ins on public.project_tasks
  for insert with check (
    public.cinema_access(public.project_cinema(project_id))
    and public.is_owner_or_manager()
  );

create policy project_tasks_upd on public.project_tasks
  for update using (
    public.cinema_access(public.project_cinema(project_id))
    and (public.is_project_member(project_id) or public.is_owner_or_manager())
  ) with check (
    public.cinema_access(public.project_cinema(project_id))
    and (public.is_project_member(project_id) or public.is_owner_or_manager())
  );

create policy project_tasks_del on public.project_tasks
  for delete using (
    public.cinema_access(public.project_cinema(project_id))
    and public.is_owner_or_manager()
  );

commit;
