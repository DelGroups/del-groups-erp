# To-do module (`todo`, phase 22)

Depends on `core`. New UI only (NEW_UI): `/todo` is a 404 while NEW_UI is off, and there is no
classic sidebar item; the new shell lists it with the home app, and the command palette (quick
actions) has "New to-do".

## Goal

People capture what they have to do in seconds, organise it in their own columns, work through
it in their own priority order, share it with colleagues, and finish it.

## What it does

- **Tasks** (`todo_tasks`): title, notes, priority (normal / high / urgent), due date, tags,
  checklist (`todo_checklist_items`), activities and chatter (phase 19).
- **Personal stages** (`todo_stages`): every user has their own columns (Inbox, Today, This
  week, Later, Done, editable: rename, reorder, add, delete). A shared task sits in each member's
  own column (`todo_task_members.stage_id`) and own order (`sequence`).
- **Finishing**: moving a task into a done column finishes it for everyone; moving it out
  reopens it.
- **Views**: kanban of the user's stages (drag between columns) and a list, on the view engine;
  the priority stack (reference `bonus/bonus-drag-to-reorder-priority-stack`) on top: drag by
  the handle or move with the arrow keys, the new order is saved.
- **Quick capture**: one line, `!` / `!!` for priority, `#tag` for tags; from the screen or the
  command palette (`/todo?capture=1`).
- **My activities**: open tasks with a due date show in the top bar's "My activities" with
  overdue / today / planned counts.

## Access

- A task is seen and changed only by its members (creator and assignees) and admins.
- Members add colleagues; each member moves only their own card.
- The creator or an admin deletes a task; a member may leave it.
- Stages are personal.

## Acceptance (prompt 22)

A user can capture, organise and finish tasks, and see due tasks in "My activities". Logic tests
in `tests/todo.test.mjs`; access rules in `supabase/tests/todo.sql` (CI).

## Out of scope

- Conversion to a project task: the prompt asks for it "when the project module exists"; there is
  no project module yet.
- Recurring tasks, sub-tasks.

## Approval

New behaviour stays behind NEW_UI. Database changes go through one migration
(`supabase/migrations/20261024110000_todo.sql`) that the owner runs after review; the control
plane gets the module row through `control-panel/supabase/migrations/20261024110000_todo_module.sql`.
