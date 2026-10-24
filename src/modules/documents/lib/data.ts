"use client";

/**
 * Documents data (phase 23) on TanStack Query, through the browser Supabase client with the
 * user's session: folder rules (row level security) decide what each user sees and may change.
 * System folders come from the server action, which checks each module's own permission.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedClient } from "@/lib/supabase";
import { listSystemFolderAction } from "../actions/systemFolders";
import { DOCUMENTS_BUCKET, documentPath, LINK_MODELS, withTag, type DocumentFolder, type DocumentRow, type LinkModel, type SystemFolder } from "./documents";

// The generated database types do not know the documents tables yet.
const db = typedClient as unknown as SupabaseClient;

const DOC_SELECT = "id, folder_id, name, storage_path, mime_type, size_bytes, tags, owner_id, res_model, res_id, created_at";

export const docKeys = {
  all: ["documents"] as const,
  folders: ["documents", "folders"] as const,
  access: (folderId: string) => ["documents", "access", folderId] as const,
  files: (folderId: string) => ["documents", "files", folderId] as const,
  system: (code: string) => ["documents", "system", code] as const,
  writable: (folderId: string) => ["documents", "writable", folderId] as const,
  requests: ["documents", "requests"] as const,
  roles: ["documents", "roles"] as const,
};

type Result = PromiseLike<{ error: { message: string } | null }>;
async function check(result: Result): Promise<void> {
  const { error } = await result;
  if (error) throw new Error(error.message);
}

export function useFolders() {
  return useQuery({
    queryKey: docKeys.folders,
    queryFn: async () => {
      const { data, error } = await db.from("document_folders").select("id, parent_id, name, system_code, sequence, created_by").order("sequence").order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as DocumentFolder[];
    },
  });
}

/** Whether the user may add, change and remove files in the folder. */
export function useFolderWritable(folderId: string | null) {
  return useQuery({
    queryKey: docKeys.writable(folderId ?? ""),
    enabled: !!folderId,
    queryFn: async () => {
      const { data, error } = await db.rpc("document_folder_allowed", { p_folder: folderId, p_write: true });
      if (error) throw new Error(error.message);
      return data === true;
    },
  });
}

export function useDocuments(folderId: string | null) {
  return useQuery({
    queryKey: docKeys.files(folderId ?? ""),
    enabled: !!folderId,
    queryFn: async () => {
      const { data, error } = await db.from("documents").select(DOC_SELECT).eq("folder_id", folderId).order("created_at", { ascending: false }).limit(2000);
      if (error) throw new Error(error.message);
      return (data ?? []) as DocumentRow[];
    },
  });
}

export function useSystemFolder(code: SystemFolder | null) {
  return useQuery({
    queryKey: docKeys.system(code ?? ""),
    enabled: !!code,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const result = await listSystemFolderAction(code!);
      if (!result.success) throw new Error(result.error);
      return result.data ?? [];
    },
  });
}

export interface AccessRule {
  id: string;
  role_id: string | null;
  user_id: string | null;
  can_write: boolean;
}

export function useFolderAccess(folderId: string | null) {
  return useQuery({
    queryKey: docKeys.access(folderId ?? ""),
    enabled: !!folderId,
    queryFn: async () => {
      const { data, error } = await db.from("document_folder_access").select("id, role_id, user_id, can_write").eq("folder_id", folderId);
      if (error) throw new Error(error.message);
      return (data ?? []) as AccessRule[];
    },
  });
}

export function useRoles(enabled: boolean) {
  return useQuery({
    queryKey: docKeys.roles,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("roles").select("id, name").order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

/** A short-lived link to a document (the bucket is private). */
export async function documentUrl(path: string, download = false): Promise<string> {
  const { data, error } = await db.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 300, download ? { download: true } : undefined);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "no link");
  return data.signedUrl;
}

/** Records of a model whose name matches, to link a document to one. */
export async function searchRecords(model: LinkModel, text: string): Promise<{ id: string; label: string }[]> {
  const column = LINK_MODELS[model];
  const q = text.trim().replace(/[%_,()]/g, " ").slice(0, 60);
  let query = db.from(model).select(`id, ${column}`).order(column).limit(10);
  if (q) query = query.ilike(column, `%${q}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ id: String(r.id), label: String(r[column] ?? "") }));
}

export function useDocumentActions(userId: string | null) {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: docKeys.all });

  /** One file: stored first, then its row; the stored file is removed again if the row fails. */
  const upload = async (folderId: string, file: File, onProgress: (f: number) => void): Promise<void> => {
    const path = documentPath(folderId, file.name, crypto.randomUUID());
    onProgress(0.1);
    const up = await db.storage.from(DOCUMENTS_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (up.error) throw new Error(up.error.message);
    onProgress(0.8);
    const { error } = await db.from("documents").insert({ folder_id: folderId, name: file.name.slice(0, 255), storage_path: path, mime_type: file.type || null, size_bytes: file.size, owner_id: userId });
    if (error) {
      await db.storage.from(DOCUMENTS_BUCKET).remove([path]);
      throw new Error(error.message);
    }
    onProgress(1);
    void client.invalidateQueries({ queryKey: docKeys.files(folderId) });
  };

  const createFolder = useMutation({
    mutationFn: (v: { name: string; parent_id: string | null }) => check(db.from("document_folders").insert({ ...v, created_by: userId })),
    onSettled,
  });
  const renameFolder = useMutation({ mutationFn: (v: { id: string; name: string }) => check(db.from("document_folders").update({ name: v.name }).eq("id", v.id)), onSettled });
  const moveFolder = useMutation({ mutationFn: (v: { id: string; parent_id: string | null }) => check(db.from("document_folders").update({ parent_id: v.parent_id }).eq("id", v.id)), onSettled });
  const deleteFolder = useMutation({ mutationFn: (id: string) => check(db.from("document_folders").delete().eq("id", id)), onSettled });
  const addRule = useMutation({
    mutationFn: (v: { folder_id: string; role_id?: string | null; user_id?: string | null; can_write: boolean }) => check(db.from("document_folder_access").insert(v)),
    onSettled,
  });
  const setRuleWrite = useMutation({ mutationFn: (v: { id: string; can_write: boolean }) => check(db.from("document_folder_access").update({ can_write: v.can_write }).eq("id", v.id)), onSettled });
  const removeRule = useMutation({ mutationFn: (id: string) => check(db.from("document_folder_access").delete().eq("id", id)), onSettled });

  const updateDocument = useMutation({
    mutationFn: (v: { id: string; patch: Partial<Pick<DocumentRow, "name" | "tags" | "folder_id" | "res_model" | "res_id">> }) => check(db.from("documents").update(v.patch).eq("id", v.id)),
    onSettled,
  });
  /** Bulk: move to a folder. */
  const moveDocuments = useMutation({ mutationFn: (v: { ids: string[]; folder_id: string }) => check(db.from("documents").update({ folder_id: v.folder_id }).in("id", v.ids)), onSettled });
  /** Bulk: add one tag to each document. */
  const tagDocuments = useMutation({
    mutationFn: async (v: { docs: Pick<DocumentRow, "id" | "tags">[]; tag: string }) => {
      for (const d of v.docs) await check(db.from("documents").update({ tags: withTag(d.tags, v.tag) }).eq("id", d.id));
    },
    onSettled,
  });
  /** Bulk: delete rows, then their files. */
  const deleteDocuments = useMutation({
    mutationFn: async (docs: Pick<DocumentRow, "id" | "storage_path">[]) => {
      await check(db.from("documents").delete().in("id", docs.map((d) => d.id)));
      await db.storage.from(DOCUMENTS_BUCKET).remove(docs.map((d) => d.storage_path));
    },
    onSettled,
  });
  return { upload, createFolder, renameFolder, moveFolder, deleteFolder, addRule, setRuleWrite, removeRule, updateDocument, moveDocuments, tagDocuments, deleteDocuments };
}

// ── Requests ─────────────────────────────────────────────────────────────────

export interface DocumentRequest {
  id: string;
  folder_id: string;
  title: string;
  note: string | null;
  requested_user_id: string | null;
  partner_model: string | null;
  partner_name: string | null;
  due_date: string | null;
  status: "pending" | "done" | "cancelled";
  document_id: string | null;
  created_by: string | null;
  created_at: string;
}

export function useRequests(enabled: boolean) {
  return useQuery({
    queryKey: docKeys.requests,
    enabled,
    queryFn: async () => {
      const { data, error } = await db
        .from("document_requests")
        .select("id, folder_id, title, note, requested_user_id, partner_model, partner_name, due_date, status, document_id, created_by, created_at")
        .order("status")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as DocumentRequest[];
    },
  });
}

export function useRequestActions(userId: string | null) {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: docKeys.all });
  const create = useMutation({ mutationFn: (v: Record<string, unknown>) => check(db.from("document_requests").insert({ ...v, created_by: userId })), onSettled });
  const fulfil = useMutation({ mutationFn: (v: { id: string; document_id: string }) => check(db.from("document_requests").update({ document_id: v.document_id }).eq("id", v.id)), onSettled });
  const cancel = useMutation({ mutationFn: (id: string) => check(db.from("document_requests").update({ status: "cancelled" }).eq("id", id)), onSettled });
  return { create, fulfil, cancel };
}

/** Customers and suppliers whose name matches, to ask one of them for a file. */
export async function searchPartners(text: string): Promise<{ partner_model: "customers" | "suppliers"; partner_id: string; partner_name: string }[]> {
  const out: { partner_model: "customers" | "suppliers"; partner_id: string; partner_name: string }[] = [];
  for (const model of ["customers", "suppliers"] as const) {
    out.push(...(await searchRecords(model, text)).map((r) => ({ partner_model: model, partner_id: r.id, partner_name: r.label })));
  }
  return out.slice(0, 12);
}
