"use client";

/**
 * Chatter data (phase 19) on TanStack Query, through the browser Supabase client with the user's
 * session: row level security decides what each user sees and may write (messages and
 * activities follow the record they belong to).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/lib/supabase";
import type { Activity, ChatterMessage, ChatterModel } from "./logic";

// The generated database types do not know the new tables yet.
const db = typedClient as unknown as SupabaseClient;

const keys = {
  messages: (model: string, id: string) => ["chatter", model, id, "messages"] as const,
  activities: (model: string, id: string) => ["chatter", model, id, "activities"] as const,
  users: ["chatter", "users"] as const,
};

export function useMessages(model: ChatterModel, recordId: string) {
  return useQuery({
    queryKey: keys.messages(model, recordId),
    queryFn: async () => {
      const { data, error } = await db
        .from("mail_messages")
        .select("id, kind, body, author_id, author_name, created_at, edited_at")
        .eq("res_model", model)
        .eq("res_id", recordId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as ChatterMessage[];
    },
  });
}

export function useActivities(model: ChatterModel, recordId: string) {
  return useQuery({
    queryKey: keys.activities(model, recordId),
    queryFn: async () => {
      const { data, error } = await db
        .from("activities")
        .select("id, activity_type, summary, note, due_date, assigned_to, created_by, done_at, done_by")
        .eq("res_model", model)
        .eq("res_id", recordId)
        .order("due_date", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Activity[];
    },
  });
}

/** Active users for the assignee picker (names only). */
export function useChatterUsers(enabled: boolean) {
  return useQuery({
    queryKey: keys.users,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("chatter_users");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; full_name: string }[];
    },
  });
}

type Result = PromiseLike<{ error: { message: string } | null }>;
async function check(result: Result): Promise<void> {
  const { error } = await result;
  if (error) throw new Error(error.message);
}

/** Writes on one record's chatter; every change reloads its messages and activities. */
export function useChatterActions(model: ChatterModel, recordId: string) {
  const client = useQueryClient();
  const onSettled = () =>
    Promise.all([client.invalidateQueries({ queryKey: keys.messages(model, recordId) }), client.invalidateQueries({ queryKey: keys.activities(model, recordId) })]);
  const post = useMutation({
    mutationFn: (v: { kind: "note" | "message"; body: string }) => check(db.from("mail_messages").insert({ res_model: model, res_id: recordId, kind: v.kind, body: v.body })),
    onSettled,
  });
  const removeMessage = useMutation({ mutationFn: (id: string) => check(db.from("mail_messages").delete().eq("id", id)), onSettled });
  const schedule = useMutation({
    mutationFn: (v: { activity_type: string; summary: string; due_date: string; assigned_to: string | null; note: string | null }) =>
      check(db.from("activities").insert({ res_model: model, res_id: recordId, ...v })),
    onSettled,
  });
  const setDone = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => check(db.from("activities").update({ done_at: v.done ? new Date().toISOString() : null }).eq("id", v.id)),
    onSettled,
  });
  const removeActivity = useMutation({ mutationFn: (id: string) => check(db.from("activities").delete().eq("id", id)), onSettled });
  return { post, removeMessage, schedule, setDone, removeActivity };
}
