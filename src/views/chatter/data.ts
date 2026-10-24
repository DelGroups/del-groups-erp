"use client";

/**
 * Chatter data (phase 19) on TanStack Query, through the browser Supabase client with the user's
 * session: row level security decides what each user sees and may write (messages and
 * activities follow the record they belong to).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/lib/supabase";
import { ATTACHMENT_BUCKET, attachmentPath, DEFAULT_ACTIVITY_TYPES, type Activity, type ActivityTypeRow, type ChatterMessage, type ChatterModel, type Follower } from "./logic";

// The generated database types do not know the new tables yet.
const db = typedClient as unknown as SupabaseClient;

const keys = {
  messages: (model: string, id: string) => ["chatter", model, id, "messages"] as const,
  activities: (model: string, id: string) => ["chatter", model, id, "activities"] as const,
  followers: (model: string, id: string) => ["chatter", model, id, "followers"] as const,
  users: ["chatter", "users"] as const,
  types: ["chatter", "activity-types"] as const,
  mine: (userId: string) => ["chatter", "my-activities", userId] as const,
};

export function useMessages(model: ChatterModel, recordId: string) {
  return useQuery({
    queryKey: keys.messages(model, recordId),
    queryFn: async () => {
      const { data, error } = await db
        .from("mail_messages")
        .select("id, kind, body, author_id, author_name, created_at, edited_at, mail_attachments (id, storage_path, file_name, mime_type, size_bytes)")
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

/**
 * The current time, moving on every minute, for due-date states (overdue / today / planned):
 * screens and the top bar stay open for hours and must notice when the day changes.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Activity types (built-in and admin-defined), all of them; the composer shows the active ones. */
export function useActivityTypes() {
  return useQuery({
    queryKey: keys.types,
    staleTime: 5 * 60_000,
    placeholderData: DEFAULT_ACTIVITY_TYPES,
    queryFn: async () => {
      const { data, error } = await db.from("activity_types").select("code, name, icon, default_days, sequence, active").order("sequence").order("code");
      if (error) throw new Error(error.message);
      return (data ?? []) as ActivityTypeRow[];
    },
  });
}

/** Admin writes on activity types (row level security lets only admins through). */
export function useActivityTypeActions() {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: keys.types });
  const add = useMutation({
    mutationFn: (v: Pick<ActivityTypeRow, "code" | "name" | "icon" | "default_days"> & { sequence: number }) => check(db.from("activity_types").insert(v)),
    onSettled,
  });
  const update = useMutation({
    mutationFn: (v: { code: string; patch: Partial<Pick<ActivityTypeRow, "name" | "icon" | "default_days" | "active">> }) => check(db.from("activity_types").update(v.patch).eq("code", v.code)),
    onSettled,
  });
  return { add, update };
}

export function useFollowers(model: ChatterModel, recordId: string) {
  return useQuery({
    queryKey: keys.followers(model, recordId),
    queryFn: async () => {
      const { data, error } = await db.from("mail_followers").select("id, user_id, added_by").eq("res_model", model).eq("res_id", recordId).order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as Follower[];
    },
  });
}

export interface MyActivity extends Pick<Activity, "id" | "activity_type" | "summary" | "due_date" | "done_at"> {
  res_model: string;
  res_id: string;
}

/** Open activities assigned to the user, on records they can still read (for the top bar). */
export function useMyActivities(userId: string | null) {
  return useQuery({
    queryKey: keys.mine(userId ?? ""),
    enabled: !!userId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("activities")
        .select("id, activity_type, summary, due_date, done_at, res_model, res_id")
        .eq("assigned_to", userId)
        .is("done_at", null)
        .order("due_date", { ascending: true })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as MyActivity[];
    },
  });
}

/** A short-lived download link for a chatter file (the bucket is private). */
export async function attachmentUrl(path: string): Promise<string> {
  const { data, error } = await db.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "no link");
  return data.signedUrl;
}

type Result = PromiseLike<{ error: { message: string } | null }>;
async function check(result: Result): Promise<void> {
  const { error } = await result;
  if (error) throw new Error(error.message);
}

/**
 * A message with its files: the message first (files are stored under its id, which the bucket
 * policy requires), then every file uploaded, then one insert of their rows. If anything fails,
 * the rows and files of this message are removed again, so no row points at a missing file and
 * no file is left without a row; the message itself stays and the error is shown.
 */
async function postMessage(model: ChatterModel, recordId: string, v: { kind: "note" | "message"; body: string; files: readonly File[] }): Promise<void> {
  const { data, error } = await db.from("mail_messages").insert({ res_model: model, res_id: recordId, kind: v.kind, body: v.body }).select("id").single();
  if (error) throw new Error(error.message);
  const messageId = (data as { id: string }).id;
  if (!v.files.length) return;
  const stored: { path: string; file: File }[] = [];
  try {
    for (const file of v.files) {
      const path = attachmentPath(model, recordId, messageId, file.name, crypto.randomUUID());
      const up = await db.storage.from(ATTACHMENT_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (up.error) throw new Error(up.error.message);
      stored.push({ path, file });
    }
    await check(
      db.from("mail_attachments").insert(
        stored.map(({ path, file }) => ({ message_id: messageId, storage_path: path, file_name: file.name.slice(0, 255), mime_type: file.type || null, size_bytes: file.size }))
      )
    );
  } catch (err) {
    await db.from("mail_attachments").delete().eq("message_id", messageId);
    if (stored.length) await db.storage.from(ATTACHMENT_BUCKET).remove(stored.map((s) => s.path));
    throw err;
  }
}

/** Writes on one record's chatter; every change reloads its messages, activities and followers. */
export function useChatterActions(model: ChatterModel, recordId: string) {
  const client = useQueryClient();
  const onSettled = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.messages(model, recordId) }),
      client.invalidateQueries({ queryKey: keys.activities(model, recordId) }),
      client.invalidateQueries({ queryKey: keys.followers(model, recordId) }),
      client.invalidateQueries({ queryKey: ["chatter", "my-activities"] }),
    ]);
  const post = useMutation({
    mutationFn: (v: { kind: "note" | "message"; body: string; files: readonly File[] }) => postMessage(model, recordId, v),
    onSettled,
  });
  // Files go first (the uploader may delete them), then the message and its file rows.
  const removeMessage = useMutation({
    mutationFn: async (m: Pick<ChatterMessage, "id" | "mail_attachments">) => {
      const paths = (m.mail_attachments ?? []).map((a) => a.storage_path);
      if (paths.length) await db.storage.from(ATTACHMENT_BUCKET).remove(paths);
      await check(db.from("mail_messages").delete().eq("id", m.id));
    },
    onSettled,
  });
  const follow = useMutation({
    mutationFn: (userId: string) => check(db.from("mail_followers").insert({ res_model: model, res_id: recordId, user_id: userId })),
    onSettled,
  });
  const unfollow = useMutation({ mutationFn: (followerId: string) => check(db.from("mail_followers").delete().eq("id", followerId)), onSettled });
  // Returns the new activity's id (a meeting's calendar event hangs off it).
  const schedule = useMutation({
    mutationFn: async (v: { activity_type: string; summary: string; due_date: string; assigned_to: string | null; note: string | null }): Promise<string> => {
      const { data, error } = await db.from("activities").insert({ res_model: model, res_id: recordId, ...v }).select("id").single();
      if (error) throw new Error(error.message);
      return (data as { id: string }).id;
    },
    onSettled,
  });
  const setDone = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => check(db.from("activities").update({ done_at: v.done ? new Date().toISOString() : null }).eq("id", v.id)),
    onSettled,
  });
  const removeActivity = useMutation({ mutationFn: (id: string) => check(db.from("activities").delete().eq("id", id)), onSettled });
  return { post, removeMessage, follow, unfollow, schedule, setDone, removeActivity };
}
