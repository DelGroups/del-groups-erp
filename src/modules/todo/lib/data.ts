"use client";

/**
 * To-do data (phase 22) on TanStack Query, through the browser Supabase client with the user's
 * session: row level security limits each user to the tasks they work on and their own stages.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/lib/supabase";
import type { MyTaskRow, TaskValue, TodoStage, TodoTaskRow } from "./todo";

// The generated database types do not know the to-do tables yet.
const db = typedClient as unknown as SupabaseClient;

const TASK_SELECT =
  "id, title, description, priority, due_date, tags, done_at, created_by, created_at, " +
  "todo_checklist_items (id, label, done, sequence), todo_task_members (user_id)";

export const todoKeys = {
  all: ["todo"] as const,
  stages: (userId: string) => ["todo", "stages", userId] as const,
  mine: (userId: string) => ["todo", "mine", userId] as const,
  task: (id: string) => ["todo", "task", id] as const,
  due: (userId: string) => ["todo", "due", userId] as const,
};

type Result = PromiseLike<{ error: { message: string } | null }>;
async function check(result: Result): Promise<void> {
  const { error } = await result;
  if (error) throw new Error(error.message);
}

/** The user's stages (the built-in ones are created the first time). */
export function useStages(userId: string | null) {
  return useQuery({
    queryKey: todoKeys.stages(userId ?? ""),
    enabled: !!userId,
    queryFn: async () => {
      const ensured = await db.rpc("todo_ensure_stages");
      if (ensured.error) throw new Error(ensured.error.message);
      const { data, error } = await db.from("todo_stages").select("id, code, name, sequence, is_done, folded").eq("user_id", userId).order("sequence").order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as TodoStage[];
    },
  });
}

/** The tasks the user works on, with their own stage and order. */
export function useMyTasks(userId: string | null) {
  return useQuery({
    queryKey: todoKeys.mine(userId ?? ""),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await db
        .from("todo_task_members")
        .select(`task_id, stage_id, sequence, todo_tasks (${TASK_SELECT})`)
        .eq("user_id", userId)
        .order("sequence")
        .limit(2000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as MyTaskRow[];
    },
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: todoKeys.task(id ?? ""),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db.from("todo_tasks").select(TASK_SELECT).eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as unknown as TodoTaskRow | null;
    },
  });
}

/** Open tasks of the user with a due date, for "My activities" in the top bar. */
export function useMyDueTasks(userId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: todoKeys.due(userId ?? ""),
    enabled: !!userId && enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("todo_task_members")
        .select("task_id, todo_tasks!inner (id, title, due_date, done_at)")
        .eq("user_id", userId)
        .is("todo_tasks.done_at", null)
        .not("todo_tasks.due_date", "is", null)
        .limit(100);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as { todo_tasks: { id: string; title: string; due_date: string; done_at: string | null } }[]).map((r) => r.todo_tasks);
    },
  });
}

export function useTodoActions(userId: string | null) {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: todoKeys.all });
  const create = useMutation({
    mutationFn: async (v: TaskValue & { stage_id?: string | null }): Promise<string> => {
      const { stage_id, ...task } = v;
      const { data, error } = await db.from("todo_tasks").insert({ ...task, created_by: userId }).select("id").single();
      if (error) throw new Error(error.message);
      const id = (data as { id: string }).id;
      if (stage_id) await check(db.from("todo_task_members").update({ stage_id }).eq("task_id", id).eq("user_id", userId));
      return id;
    },
    onSettled,
  });
  const update = useMutation({ mutationFn: (v: { id: string; patch: Partial<TaskValue> }) => check(db.from("todo_tasks").update(v.patch).eq("id", v.id)), onSettled });
  const remove = useMutation({ mutationFn: (id: string) => check(db.from("todo_tasks").delete().eq("id", id)), onSettled });
  const move = useMutation({
    mutationFn: (v: { taskId: string; stageId: string }) => check(db.from("todo_task_members").update({ stage_id: v.stageId }).eq("task_id", v.taskId).eq("user_id", userId)),
    onSettled,
  });
  /** The priority stack's new order (only rows whose sequence changes). */
  const reorder = useMutation({
    mutationFn: async (updates: { task_id: string; sequence: number }[]) => {
      for (const u of updates) await check(db.from("todo_task_members").update({ sequence: u.sequence }).eq("task_id", u.task_id).eq("user_id", userId));
    },
    onSettled,
  });
  const setAssignees = useMutation({
    mutationFn: async (v: { taskId: string; want: string[]; have: string[] }) => {
      const add = v.want.filter((u) => !v.have.includes(u));
      const drop = v.have.filter((u) => !v.want.includes(u) && u !== userId);
      if (add.length) await check(db.from("todo_task_members").insert(add.map((user_id) => ({ task_id: v.taskId, user_id }))));
      if (drop.length) await check(db.from("todo_task_members").delete().eq("task_id", v.taskId).in("user_id", drop));
    },
    onSettled,
  });
  const addItem = useMutation({
    mutationFn: (v: { taskId: string; label: string; sequence: number }) => check(db.from("todo_checklist_items").insert({ task_id: v.taskId, label: v.label, sequence: v.sequence })),
    onSettled,
  });
  const toggleItem = useMutation({ mutationFn: (v: { id: string; done: boolean }) => check(db.from("todo_checklist_items").update({ done: v.done }).eq("id", v.id)), onSettled });
  const removeItem = useMutation({ mutationFn: (id: string) => check(db.from("todo_checklist_items").delete().eq("id", id)), onSettled });
  return { create, update, remove, move, reorder, setAssignees, addItem, toggleItem, removeItem };
}

export function useStageActions(userId: string | null) {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: todoKeys.all });
  const add = useMutation({ mutationFn: (v: { name: string; sequence: number }) => check(db.from("todo_stages").insert({ user_id: userId, name: v.name, sequence: v.sequence })), onSettled });
  const rename = useMutation({ mutationFn: (v: { id: string; name: string }) => check(db.from("todo_stages").update({ name: v.name }).eq("id", v.id)), onSettled });
  const setSequence = useMutation({
    mutationFn: async (updates: { id: string; sequence: number }[]) => {
      for (const u of updates) await check(db.from("todo_stages").update({ sequence: u.sequence }).eq("id", u.id));
    },
    onSettled,
  });
  const remove = useMutation({ mutationFn: (id: string) => check(db.from("todo_stages").delete().eq("id", id)), onSettled });
  return { add, rename, setSequence, remove };
}
