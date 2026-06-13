-- ============================================================================
-- Project tasks — completion note (replaces the hard "attachment required".)
--
-- Attachments are no longer mandatory to complete a task. Instead, when a task
-- is marked done WITHOUT an attachment the app collects a short comment; it is
-- stored on the task and copied into the audit trail. This adds the column and
-- updates the tick trigger to (a) surface the note in project_audit.detail and
-- (b) clear it when a task is reopened.
--
-- HOW TO RUN: applied via `npm run db:push:staging` / `:prod`. Idempotent.
-- ============================================================================

begin;

alter table public.project_tasks
  add column if not exists done_note text;

create or replace function public.fn_project_task_tick()
  returns trigger language plpgsql security definer set search_path = public
as $$
declare v_actor text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if NEW.done is distinct from OLD.done then
    NEW.done_at := case when NEW.done then now() else null end;
    NEW.done_by := case when NEW.done then v_actor else null end;
    -- Reopening clears any completion note.
    if not NEW.done then
      NEW.done_note := null;
    end if;
    insert into public.project_audit (project_id, task_id, action, actor_email, detail)
    values (NEW.project_id, NEW.id,
            case when NEW.done then 'task_checked' else 'task_unchecked' end,
            v_actor,
            jsonb_build_object('code', NEW.code, 'name', NEW.name)
              || case
                   when NEW.done and NEW.done_note is not null and btrim(NEW.done_note) <> ''
                   then jsonb_build_object('note', NEW.done_note)
                   else '{}'::jsonb
                 end);
  end if;
  return NEW;
end;
$$;

commit;

-- ============================================================================
-- VERIFY:
--   select column_name from information_schema.columns
--    where table_name = 'project_tasks' and column_name = 'done_note';  -- 1 row
-- ============================================================================
