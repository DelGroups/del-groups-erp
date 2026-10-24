/**
 * Documents (phase 23), pure parts: the folder tree, folder labels, storage paths, upload limits,
 * preview kinds, search and tag filters, record links and the request form's checks. Kept free of
 * React and Supabase so `node --test` covers it.
 */

export const SYSTEM_FOLDERS = ["expenses", "contracts", "products"] as const;
export type SystemFolder = (typeof SYSTEM_FOLDERS)[number];

export interface DocumentFolder {
  id: string;
  parent_id: string | null;
  name: string | null;
  system_code: SystemFolder | null;
  sequence: number;
  created_by: string | null;
}

export interface FolderNode extends DocumentFolder {
  depth: number;
  children: FolderNode[];
}

export interface DocumentRow {
  id: string;
  folder_id: string;
  name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  tags: string[];
  owner_id: string | null;
  res_model: string | null;
  res_id: string | null;
  created_at: string;
}

/** A file of a system folder, listed by the server where it already is. */
export interface SystemFile {
  id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string | null;
  url: string | null;
  res_model: string;
  res_id: string;
}

export function folderLabel(folder: Pick<DocumentFolder, "name" | "system_code">, t: (key: string) => string): string {
  if (folder.system_code) return t(`library.system.${folder.system_code}`);
  return folder.name ?? "—";
}

/** The folders as a tree: user folders first by sequence and name, system folders last. */
export function buildTree(folders: readonly DocumentFolder[]): FolderNode[] {
  const byParent = new Map<string | null, DocumentFolder[]>();
  const ids = new Set(folders.map((f) => f.id));
  for (const f of folders) {
    // A folder whose parent is hidden (no access) shows at the top.
    const key = f.parent_id && ids.has(f.parent_id) ? f.parent_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), f]);
  }
  const order = (a: DocumentFolder, b: DocumentFolder) =>
    Number(!!a.system_code) - Number(!!b.system_code) || a.sequence - b.sequence || (a.name ?? a.system_code ?? "").localeCompare(b.name ?? b.system_code ?? "");
  const seen = new Set<string>();
  const build = (parent: string | null, depth: number): FolderNode[] =>
    [...(byParent.get(parent) ?? [])].sort(order).flatMap((f) => {
      if (seen.has(f.id) || depth > 50) return [];
      seen.add(f.id);
      return [{ ...f, depth, children: build(f.id, depth + 1) }];
    });
  return build(null, 0);
}

/** The tree flattened in display order, children of collapsed folders left out. */
export function visibleFolders(tree: readonly FolderNode[], expanded: ReadonlySet<string>): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (nodes: readonly FolderNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (expanded.has(n.id)) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** The folder and everything under it (a folder cannot move into these). */
export function subtreeIds(folders: readonly DocumentFolder[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Folder names from the top down to the folder (breadcrumbs). */
export function folderPath(folders: readonly DocumentFolder[], id: string | null): DocumentFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: DocumentFolder[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur && out.length < 50) {
    out.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}

export function checkFolderName(name: string): { ok: true; name: string } | { ok: false; error: string } {
  const v = name.trim();
  if (!v) return { ok: false, error: "library.errors.folderName" };
  if (v.length > 120) return { ok: false, error: "library.errors.tooLong" };
  return { ok: true, name: v };
}

// ── Files ────────────────────────────────────────────────────────────────────

export const DOCUMENTS_BUCKET = "documents";
export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

/** Storage path of an upload: "<folder id>/<unique>-<safe name>" (the bucket policy reads the folder). */
export function documentPath(folderId: string, fileName: string, unique: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) : "";
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${folderId}/${unique}-${stem || "file"}${ext ? `.${ext}` : ""}`;
}

export type PreviewKind = "image" | "pdf" | "none";

/** How the panel previews a file: images and PDFs in place, everything else as a download. */
export function previewKind(mime: string | null | undefined, name: string): PreviewKind {
  const m = (mime ?? "").toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext)) return m === "image/svg+xml" || ext === "svg" ? "none" : "image";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  return "none";
}

/** Short type badge for a file: "PDF", "XLSX", "FILE". */
export function fileBadge(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "").slice(0, 5) : "";
  return ext ? ext.toUpperCase() : "FILE";
}

/** "512 B", "14 KB", "2.4 MB". */
export function fileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Documents matching the search text (name or tag) and the chosen tag. */
export function filterDocuments<D extends Pick<DocumentRow, "name" | "tags">>(docs: readonly D[], search: string, tag: string | null): D[] {
  const q = search.trim().toLowerCase();
  return docs.filter((d) => (!tag || d.tags.includes(tag)) && (!q || d.name.toLowerCase().includes(q) || d.tags.some((x) => x.toLowerCase().includes(q))));
}

/** Every tag used, sorted, once. */
export function allTags(docs: readonly Pick<DocumentRow, "tags">[]): string[] {
  return [...new Set(docs.flatMap((d) => d.tags))].sort((a, b) => a.localeCompare(b));
}

/** Tags from "a, b,  a" (trimmed, no duplicates, at most 20 of up to 40 characters). */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw.trim().replace(/^#/, "").slice(0, 40);
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 20);
}

/** Tags of a document with one more (bulk "add tag"), still at most 20. */
export function withTag(tags: readonly string[], tag: string): string[] {
  return parseTags([...tags, tag].join(","));
}

// ── Record links ─────────────────────────────────────────────────────────────

/** Records a document can be linked to, and the column that names them. */
export const LINK_MODELS = {
  customers: "full_name",
  suppliers: "full_name",
  deals: "title",
  sales: "invoice_number",
  purchases: "invoice_number",
  products: "name",
  contracts: "contract_number",
} as const;
export type LinkModel = keyof typeof LINK_MODELS;

export function isLinkModel(model: string): model is LinkModel {
  return Object.prototype.hasOwnProperty.call(LINK_MODELS, model);
}

// ── Requests ─────────────────────────────────────────────────────────────────

export interface RequestInput {
  title: string;
  note: string;
  due_date: string;
  requested_user_id: string;
  partner: { partner_model: "customers" | "suppliers"; partner_id: string; partner_name: string } | null;
}

export function checkRequest(input: RequestInput): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "library.errors.requestTitle" };
  if (title.length > 200 || input.note.length > 2000) return { ok: false, error: "library.errors.tooLong" };
  if (!input.requested_user_id && !input.partner) return { ok: false, error: "library.errors.requestWho" };
  if (input.due_date && (!/^\d{4}-\d{2}-\d{2}$/.test(input.due_date) || Number.isNaN(Date.parse(input.due_date)))) return { ok: false, error: "library.errors.dueDate" };
  return {
    ok: true,
    value: {
      title,
      note: input.note.trim() || null,
      due_date: input.due_date || null,
      requested_user_id: input.requested_user_id || null,
      ...(input.partner ? input.partner : { partner_model: null, partner_id: null, partner_name: null }),
    },
  };
}
