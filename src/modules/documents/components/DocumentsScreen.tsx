"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, FolderOpen, Inbox, LayoutGrid, List, Tag, Trash2, FolderInput } from "lucide-react";
import { EmptyState, FileDropzone, useToast } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLimitStatus } from "@/components/limits/useLimitStatus";
import { limitState } from "@/lib/limits/limits";
import { RecordPanel, ViewScope, useFormatter, type Formatter } from "@/views";
import {
  allTags,
  buildTree,
  DOCUMENT_MAX_BYTES,
  fileBadge,
  fileSize,
  filterDocuments,
  folderLabel,
  folderPath,
  previewKind,
  visibleFolders,
  type DocumentFolder,
  type DocumentRow,
  type SystemFile,
} from "../lib/documents";
import { documentUrl, useDocumentActions, useDocuments, useFolders, useFolderWritable, useSystemFolder } from "../lib/data";
import { DocumentPanel, SystemFilePanel } from "./DocumentPanel";
import { FolderTree } from "./FolderTree";
import { RequestsPanel } from "./RequestsPanel";
import { dateFormat } from "@/lib/dates/localeDate";

/**
 * The Documents module's screen (phase 23, new UI only): the folder tree on the left; on the
 * right the open folder's files as a grid (image thumbnails, page-shaped tiles for the rest) or a
 * list, with search, a tag filter, drag-and-drop upload, bulk move / tag / delete, a preview
 * panel and file requests. System folders list existing attachments where they are.
 */
export default function DocumentsScreen() {
  return (
    <ViewScope>
      <DocumentsBody />
    </ViewScope>
  );
}

function DocumentsBody() {
  const fmt = useFormatter();
  const { t } = fmt;
  const folders = useFolders();
  const list = useMemo(() => folders.data ?? [], [folders.data]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showRequests, setShowRequests] = useState(false);
  const current = list.find((f) => f.id === selected) ?? null;
  const userDocs = useDocuments(current && !current.system_code ? current.id : null);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-[length:var(--ds-text-2xl)] font-semibold">{t("library.title")}</h1>
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => setShowRequests(true)}>
          <Inbox className="h-4 w-4" aria-hidden />
          {t("library.requests.open")}
        </button>
      </header>
      <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="ds-card ds-card-pad self-start">
          {folders.isLoading ? <p className="ds-muted">{t("common.loading")}</p> : <FolderTree folders={list} selected={selected} onSelect={setSelected} fmt={fmt} />}
        </aside>
        <section className="flex min-w-0 flex-col gap-3" aria-live="polite">
          {current ? (
            current.system_code ? (
              <SystemFolderView folder={current} folders={list} fmt={fmt} />
            ) : (
              <FolderView folder={current} folders={list} docs={userDocs.data ?? []} loading={userDocs.isLoading} fmt={fmt} />
            )
          ) : (
            <EmptyState icon={FolderOpen} title={t("library.pick.title")} description={t("library.pick.description")} />
          )}
        </section>
      </div>
      <RecordPanel open={showRequests} onClose={() => setShowRequests(false)} title={t("library.requests.heading")} closeLabel={t("common.close")}>
        {showRequests ? <RequestsPanel folder={current} folders={list} docs={userDocs.data ?? []} fmt={fmt} /> : null}
      </RecordPanel>
    </div>
  );
}

function Breadcrumbs({ folders, id, fmt }: { folders: readonly DocumentFolder[]; id: string; fmt: Formatter }) {
  const path = folderPath(folders, id);
  return (
    <nav aria-label={fmt.t("library.path")} className="ds-muted text-[length:var(--ds-text-xs)]">
      {path.map((f, i) => (
        <span key={f.id}>
          {i ? " / " : ""}
          {folderLabel(f, fmt.t)}
        </span>
      ))}
    </nav>
  );
}

type Mode = "grid" | "list";

function Toolbar({ mode, setMode, search, setSearch, tags, tag, setTag, fmt }: { mode: Mode; setMode: (m: Mode) => void; search: string; setSearch: (v: string) => void; tags: string[]; tag: string | null; setTag: (v: string | null) => void; fmt: Formatter }) {
  const { t } = fmt;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="doc-search">
        {t("library.search")}
      </label>
      <input id="doc-search" className="ds-input max-w-xs flex-1" value={search} placeholder={t("library.search")} onChange={(e) => setSearch(e.target.value)} />
      {tags.length ? (
        <>
          <label className="sr-only" htmlFor="doc-tag">
            {t("library.tagFilter")}
          </label>
          <select id="doc-tag" className="ds-input w-40" value={tag ?? ""} onChange={(e) => setTag(e.target.value || null)}>
            <option value="">{t("library.allTags")}</option>
            {tags.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <div role="radiogroup" aria-label={t("library.layout")} className="ml-auto flex gap-1">
        {(
          [
            ["grid", LayoutGrid],
            ["list", List],
          ] as const
        ).map(([m, Icon]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} aria-label={t(`library.layouts.${m}`)} className={["ds-icon-btn h-8 w-8", mode === m ? "ds-btn-primary" : ""].join(" ")} onClick={() => setMode(m)}>
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Thumbnail of a stored image (short-lived link, read when the tile shows). */
function Thumb({ doc }: { doc: Pick<DocumentRow, "storage_path" | "name"> }) {
  const url = useQuery({ queryKey: ["documents", "url", doc.storage_path], staleTime: 4 * 60_000, queryFn: () => documentUrl(doc.storage_path) });
  if (!url.data) return <span className="block h-full w-full" style={{ background: "var(--ds-surface-sunken)" }} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage links
  return <img src={url.data} alt="" loading="lazy" className="h-full w-full object-cover" />;
}

/** The grid tile: a thumbnail for images, a page with the file type for everything else. */
function Tile({ name, size, mime, thumb, selected, onToggle, onOpen, fmt }: { name: string; size: number | null; mime: string | null; thumb: React.ReactNode | null; selected?: boolean; onToggle?: () => void; onOpen: () => void; fmt: Formatter }) {
  return (
    <li className="relative">
      <button type="button" onClick={onOpen} className="flex w-full flex-col overflow-hidden rounded-[var(--ds-radius-md)] border text-left focus-visible:outline-2" style={{ borderColor: selected ? "var(--ds-brand)" : "var(--ds-border)", background: "var(--ds-surface)" }}>
        <span className="relative grid aspect-[4/3] place-items-center overflow-hidden" style={{ background: "var(--ds-surface-sunken)" }}>
          {thumb ?? (
            <span className="relative grid h-[70%] aspect-[3/4] place-items-center rounded-[var(--ds-radius-sm)] border shadow-sm" style={{ background: "var(--ds-surface)", borderColor: "var(--ds-border)" }} aria-hidden>
              <FileText className="h-6 w-6 ds-subtle" />
              <span className="absolute bottom-1.5 rounded px-1 text-[10px] font-semibold" style={{ background: previewKind(mime, name) === "pdf" ? "var(--ds-danger-soft)" : "var(--ds-brand-soft)" }}>
                {fileBadge(name)}
              </span>
            </span>
          )}
        </span>
        <span className="flex flex-col px-2 py-1.5">
          <span className="truncate font-medium">{name}</span>
          <span className="ds-subtle text-[length:var(--ds-text-xs)]">{fileSize(size) || " "}</span>
        </span>
      </button>
      {onToggle ? (
        <input type="checkbox" className="absolute left-2 top-2 h-4 w-4" checked={!!selected} aria-label={fmt.t("library.select", { name })} onChange={onToggle} />
      ) : null}
    </li>
  );
}

function FolderView({ folder, folders, docs, loading, fmt }: { folder: DocumentFolder; folders: readonly DocumentFolder[]; docs: DocumentRow[]; loading: boolean; fmt: Formatter }) {
  const { t } = fmt;
  const { user } = useAuth();
  const { toast } = useToast();
  const writable = useFolderWritable(folder.id).data === true;
  const actions = useDocumentActions(user?.id ?? null);
  const { status } = useLimitStatus(true);
  const storage = status ? limitState(status.storage) : "ok";
  const [mode, setMode] = useState<Mode>("grid");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<DocumentRow | null>(null);
  const [bulkTag, setBulkTag] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const shown = filterDocuments(docs, search, tag);
  const chosen = docs.filter((d) => picked.has(d.id));
  const targets = visibleFolders(buildTree(folders), new Set(folders.map((f) => f.id))).filter((f) => !f.system_code && f.id !== folder.id);
  const fail = (err: unknown) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clear = () => setPicked(new Set());

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-[length:var(--ds-text-lg)] font-semibold">{folderLabel(folder, t)}</h2>
        <Breadcrumbs folders={folders} id={folder.id} fmt={fmt} />
      </div>
      {writable ? (
        storage === "blocked" ? (
          <p role="alert" className="rounded-[var(--ds-radius-md)] p-3" style={{ background: "var(--ds-danger-soft)" }}>
            {t("library.storageFull")}
          </p>
        ) : (
          <>
            {storage === "warning" ? <p className="rounded-[var(--ds-radius-md)] p-2 text-[length:var(--ds-text-xs)]" style={{ background: "var(--ds-warning-soft)" }}>{t("library.storageWarning")}</p> : null}
            <FileDropzone
              rules={{ maxBytes: DOCUMENT_MAX_BYTES, accept: [] }}
              upload={(file, onProgress) => actions.upload(folder.id, file, onProgress)}
              labels={{
                drag: t("library.drop.drag"),
                browse: t("library.drop.browse"),
                constraints: t("library.drop.constraints"),
                tooLarge: t("library.drop.tooLarge"),
                wrongType: t("library.drop.wrongType"),
                empty: t("library.drop.empty"),
                failed: t("library.drop.failed"),
                retry: t("library.drop.retry"),
                remove: t("library.drop.remove"),
                done: t("library.drop.done"),
              }}
            />
          </>
        )
      ) : (
        <p className="ds-subtle text-[length:var(--ds-text-xs)]">{t("library.readOnly")}</p>
      )}
      <Toolbar mode={mode} setMode={setMode} search={search} setSearch={setSearch} tags={allTags(docs)} tag={tag} setTag={setTag} fmt={fmt} />
      {chosen.length && writable ? (
        <div role="toolbar" aria-label={t("library.bulk.label")} className="ds-card flex flex-wrap items-center gap-2 p-2">
          <span className="font-medium">{t("library.bulk.count", { count: chosen.length })}</span>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (moveTo) actions.moveDocuments.mutate({ ids: chosen.map((d) => d.id), folder_id: moveTo }, { onSuccess: clear, onError: fail });
            }}
          >
            <label className="sr-only" htmlFor="bulk-move">
              {t("library.bulk.moveTo")}
            </label>
            <select id="bulk-move" className="ds-input h-8 w-44" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">{t("library.bulk.moveTo")}</option>
              {targets.map((f) => (
                <option key={f.id} value={f.id}>
                  {`${"  ".repeat(f.depth)}${folderLabel(f, t)}`}
                </option>
              ))}
            </select>
            <button type="submit" className="ds-btn ds-btn-sm" disabled={!moveTo}>
              <FolderInput className="h-4 w-4" aria-hidden />
              {t("library.bulk.move")}
            </button>
          </form>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const v = bulkTag.trim();
              if (v) actions.tagDocuments.mutate({ docs: chosen, tag: v }, { onSuccess: () => setBulkTag(""), onError: fail });
            }}
          >
            <label className="sr-only" htmlFor="bulk-tag">
              {t("library.bulk.tag")}
            </label>
            <input id="bulk-tag" className="ds-input h-8 w-32" maxLength={40} value={bulkTag} placeholder={t("library.bulk.tag")} onChange={(e) => setBulkTag(e.target.value)} />
            <button type="submit" className="ds-btn ds-btn-sm" disabled={!bulkTag.trim()}>
              <Tag className="h-4 w-4" aria-hidden />
              {t("library.bulk.addTag")}
            </button>
          </form>
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => actions.deleteDocuments.mutate(chosen, { onSuccess: clear, onError: fail })}>
            <Trash2 className="h-4 w-4" aria-hidden />
            {t("library.bulk.delete")}
          </button>
          <button type="button" className="ml-auto ds-btn ds-btn-sm ds-btn-ghost" onClick={clear}>
            {t("library.bulk.clear")}
          </button>
        </div>
      ) : null}
      {loading ? (
        <p className="ds-muted">{t("common.loading")}</p>
      ) : !shown.length ? (
        <EmptyState icon={FileText} title={docs.length ? t("library.empty.noMatch") : t("library.empty.title")} description={docs.length ? t("library.empty.noMatchHint") : writable ? t("library.empty.upload") : t("library.empty.readOnly")} />
      ) : mode === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {shown.map((d) => (
            <Tile
              key={d.id}
              name={d.name}
              size={d.size_bytes}
              mime={d.mime_type}
              thumb={previewKind(d.mime_type, d.name) === "image" ? <Thumb doc={d} /> : null}
              selected={picked.has(d.id)}
              onToggle={writable ? () => toggle(d.id) : undefined}
              onOpen={() => setOpen(d)}
              fmt={fmt}
            />
          ))}
        </ul>
      ) : (
        <div className="ds-card overflow-x-auto">
          <table className="w-full text-left">
            <thead className="ds-label">
              <tr>
                {writable ? (
                  <th className="w-8 p-2">
                    <input type="checkbox" aria-label={t("library.selectAll")} checked={shown.every((d) => picked.has(d.id))} onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((d) => d.id)) : new Set())} />
                  </th>
                ) : null}
                <th className="p-2">{t("library.fields.name")}</th>
                <th className="p-2">{t("library.fields.tags")}</th>
                <th className="p-2">{t("library.fields.size")}</th>
                <th className="p-2">{t("library.fields.added")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id} className="border-t" style={{ borderColor: "var(--ds-border)" }}>
                  {writable ? (
                    <td className="p-2">
                      <input type="checkbox" checked={picked.has(d.id)} aria-label={t("library.select", { name: d.name })} onChange={() => toggle(d.id)} />
                    </td>
                  ) : null}
                  <td className="p-2">
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setOpen(d)}>
                      {d.name}
                    </button>
                  </td>
                  <td className="p-2 ds-muted">{d.tags.join(", ")}</td>
                  <td className="p-2 ds-mono">{fileSize(d.size_bytes)}</td>
                  <td className="p-2 ds-muted">{dateFormat(fmt.locale, { dateStyle: "medium" }).format(new Date(d.created_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RecordPanel open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""} closeLabel={t("common.close")}>
        {open ? <DocumentPanel key={open.id} doc={open} folders={folders} canWrite={writable} fmt={fmt} onClose={() => setOpen(null)} /> : null}
      </RecordPanel>
    </>
  );
}

function SystemFolderView({ folder, folders, fmt }: { folder: DocumentFolder; folders: readonly DocumentFolder[]; fmt: Formatter }) {
  const { t } = fmt;
  const files = useSystemFolder(folder.system_code);
  const [mode, setMode] = useState<Mode>("grid");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<SystemFile | null>(null);
  const shown = filterDocuments((files.data ?? []).map((f) => ({ ...f, tags: [] as string[] })), search, null);
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-[length:var(--ds-text-lg)] font-semibold">{folderLabel(folder, t)}</h2>
        <Breadcrumbs folders={folders} id={folder.id} fmt={fmt} />
        <p className="ds-subtle text-[length:var(--ds-text-xs)]">{t("library.system.hint")}</p>
      </div>
      <Toolbar mode={mode} setMode={setMode} search={search} setSearch={setSearch} tags={[]} tag={null} setTag={() => undefined} fmt={fmt} />
      {files.isLoading ? (
        <p className="ds-muted">{t("common.loading")}</p>
      ) : files.isError ? (
        <EmptyState icon={FolderOpen} title={t("library.system.noAccess")} description={files.error instanceof Error ? files.error.message : ""} />
      ) : !shown.length ? (
        <EmptyState icon={FileText} title={t("library.system.empty")} description={t("library.system.emptyHint")} />
      ) : mode === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {shown.map((f) => (
            // eslint-disable-next-line @next/next/no-img-element -- signed or public storage links
            <Tile key={f.id} name={f.name} size={f.size_bytes} mime={f.mime_type} thumb={previewKind(f.mime_type, f.name) === "image" && f.url ? <img src={f.url} alt="" loading="lazy" className="h-full w-full object-cover" /> : null} onOpen={() => setOpen(f)} fmt={fmt} />
          ))}
        </ul>
      ) : (
        <ul className="ds-card divide-y" style={{ borderColor: "var(--ds-border)" }}>
          {shown.map((f) => (
            <li key={f.id}>
              <button type="button" className="flex w-full items-center gap-2 p-2 text-left hover:underline" onClick={() => setOpen(f)}>
                <FileText className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="ds-mono ds-subtle text-[length:var(--ds-text-xs)]">{fileSize(f.size_bytes)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <RecordPanel open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""} closeLabel={t("common.close")}>
        {open ? <SystemFilePanel file={open} fmt={fmt} /> : null}
      </RecordPanel>
    </>
  );
}
