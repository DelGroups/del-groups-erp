"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderLock, FolderPlus, Lock, Pencil, Share2, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/design-system/components";
import { RecordPanel, type Formatter } from "@/views";
import { useChatterUsers } from "@/views/chatter/data";
import { buildTree, checkFolderName, folderLabel, visibleFolders, type DocumentFolder } from "../lib/documents";
import { useDocumentActions, useFolderAccess, useRoles } from "../lib/data";

/**
 * The folder tree (phase 23): open / close folders with the mouse or the arrow keys, pick one,
 * add a folder (at the top or inside the selected one), rename, delete an empty folder, and
 * share it. System folders sit at the bottom with a lock.
 */
export function FolderTree({ folders, selected, onSelect, fmt }: { folders: readonly DocumentFolder[]; selected: string | null; onSelect: (id: string) => void; fmt: Formatter }) {
  const { t } = fmt;
  const { user, isAdmin } = useAuth();
  const userId = user?.id ?? null;
  const { toast } = useToast();
  const actions = useDocumentActions(userId);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState<"top" | "inside" | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sharing, setSharing] = useState<DocumentFolder | null>(null);
  const tree = buildTree(folders);
  const rows = visibleFolders(tree, expanded);
  const fail = (err: unknown) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");
  const current = folders.find((f) => f.id === selected) ?? null;
  const toggle = (id: string, open?: boolean) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const submitName = () => {
    const checked = checkFolderName(name);
    if (!checked.ok) {
      toast(t(checked.error), undefined, "error");
      return;
    }
    if (renaming) {
      actions.renameFolder.mutate({ id: renaming, name: checked.name }, { onSuccess: () => setRenaming(null), onError: fail });
    } else {
      const parent = adding === "inside" && current && !current.system_code ? current.id : null;
      actions.createFolder.mutate(
        { name: checked.name, parent_id: parent },
        {
          onSuccess: () => {
            setAdding(null);
            if (parent) toggle(parent, true);
          },
          onError: fail,
        }
      );
    }
    setName("");
  };

  const nameForm = (
    <form
      className="flex gap-1 px-1"
      onSubmit={(e) => {
        e.preventDefault();
        submitName();
      }}
    >
      <label className="sr-only" htmlFor="folder-name">
        {t("library.folder.name")}
      </label>
      <input
        id="folder-name"
        className="ds-input h-8 flex-1"
        autoFocus
        maxLength={120}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setAdding(null);
            setRenaming(null);
          }
        }}
      />
      <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary">
        {t("common.save")}
      </button>
    </form>
  );

  return (
    <nav aria-label={t("library.folders")} className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h2 className="mr-auto ds-label">{t("library.folders")}</h2>
        <button type="button" className="ds-icon-btn h-8 w-8" aria-label={t("library.folder.add")} onClick={() => setAdding(current && !current.system_code ? "inside" : "top")}>
          <FolderPlus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {adding ? (
        <div className="flex flex-col gap-1">
          <p className="px-1 ds-subtle text-[length:var(--ds-text-xs)]">{adding === "inside" && current ? t("library.folder.addInside", { name: folderLabel(current, t) }) : t("library.folder.addTop")}</p>
          {nameForm}
        </div>
      ) : null}
      <ul role="tree" aria-label={t("library.folders")} className="flex flex-col">
        {rows.map((f) => {
          const isSelected = f.id === selected;
          const hasChildren = f.children.length > 0;
          const canManage = !f.system_code && (f.created_by === userId || isAdmin);
          return (
            <li key={f.id} role="treeitem" aria-selected={isSelected} aria-expanded={hasChildren ? expanded.has(f.id) : undefined} aria-level={f.depth + 1}>
              {renaming === f.id ? (
                nameForm
              ) : (
                <div className="group flex items-center rounded-[var(--ds-radius-sm)]" style={{ paddingLeft: f.depth * 14, background: isSelected ? "var(--ds-brand-soft)" : undefined }}>
                  {hasChildren ? (
                    <button type="button" className="ds-icon-btn h-7 w-6" aria-label={expanded.has(f.id) ? t("library.folder.collapse", { name: folderLabel(f, t) }) : t("library.folder.expand", { name: folderLabel(f, t) })} onClick={() => toggle(f.id)}>
                      {expanded.has(f.id) ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                    </button>
                  ) : (
                    <span className="w-6" aria-hidden />
                  )}
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 text-left"
                    style={{ color: isSelected ? "var(--ds-brand)" : undefined, fontWeight: isSelected ? 600 : undefined }}
                    onClick={() => onSelect(f.id)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowRight" && hasChildren) toggle(f.id, true);
                      if (e.key === "ArrowLeft" && hasChildren) toggle(f.id, false);
                    }}
                  >
                    {f.system_code ? <FolderLock className="h-4 w-4 shrink-0" aria-hidden /> : <Folder className="h-4 w-4 shrink-0" aria-hidden />}
                    <span className="truncate">{folderLabel(f, t)}</span>
                  </button>
                  {canManage ? (
                    <span className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button type="button" className="ds-icon-btn h-7 w-7" aria-label={t("library.folder.share", { name: folderLabel(f, t) })} onClick={() => setSharing(f)}>
                        <Share2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="ds-icon-btn h-7 w-7"
                        aria-label={t("library.folder.rename", { name: folderLabel(f, t) })}
                        onClick={() => {
                          setName(f.name ?? "");
                          setRenaming(f.id);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button type="button" className="ds-icon-btn h-7 w-7" aria-label={t("library.folder.delete", { name: folderLabel(f, t) })} onClick={() => actions.deleteFolder.mutate(f.id, { onError: () => toast(t("library.folder.notEmpty"), undefined, "error") })}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </span>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!rows.length ? <p className="px-1 ds-muted text-[length:var(--ds-text-xs)]">{t("library.folder.none")}</p> : null}
      <RecordPanel open={!!sharing} onClose={() => setSharing(null)} title={sharing ? t("library.sharing.title", { name: folderLabel(sharing, t) }) : ""} closeLabel={t("common.close")}>
        {sharing ? <SharingEditor folder={sharing} fmt={fmt} /> : null}
      </RecordPanel>
    </nav>
  );
}

/** Who may open a folder: nobody listed = everyone; otherwise only the listed roles and people. */
function SharingEditor({ folder, fmt }: { folder: DocumentFolder; fmt: Formatter }) {
  const { t } = fmt;
  const { user } = useAuth();
  const { toast } = useToast();
  const access = useFolderAccess(folder.id);
  const roles = useRoles(true);
  const users = useChatterUsers(true);
  const actions = useDocumentActions(user?.id ?? null);
  const [who, setWho] = useState("");
  const [write, setWrite] = useState(false);
  const rules = access.data ?? [];
  const fail = (err: unknown) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");
  const label = (r: { role_id: string | null; user_id: string | null }) =>
    r.role_id ? t("library.sharing.role", { name: roles.data?.find((x) => x.id === r.role_id)?.name ?? "—" }) : users.data?.find((u) => u.id === r.user_id)?.full_name || t("views.chatter.unnamedUser");
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{rules.length ? t("library.sharing.restricted") : t("library.sharing.open")}</span>
      </p>
      {rules.length ? (
        <ul className="flex flex-col gap-1">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{label(r)}</span>
              <label className="flex items-center gap-1 text-[length:var(--ds-text-xs)]">
                <input type="checkbox" checked={r.can_write} onChange={(e) => actions.setRuleWrite.mutate({ id: r.id, can_write: e.target.checked }, { onError: fail })} />
                {t("library.sharing.canWrite")}
              </label>
              <button type="button" className="ds-icon-btn h-7 w-7" aria-label={t("library.sharing.remove", { name: label(r) })} onClick={() => actions.removeRule.mutate(r.id, { onError: fail })}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!who) return;
          const [kind, id] = who.split(":");
          actions.addRule.mutate({ folder_id: folder.id, ...(kind === "role" ? { role_id: id } : { user_id: id }), can_write: write }, { onSuccess: () => setWho(""), onError: fail });
        }}
      >
        <label className="flex flex-col gap-1" htmlFor="share-who">
          <span className="ds-label">{t("library.sharing.add")}</span>
          <select id="share-who" className="ds-input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">—</option>
            <optgroup label={t("library.sharing.roles")}>
              {(roles.data ?? []).map((r) => (
                <option key={r.id} value={`role:${r.id}`}>
                  {r.name}
                </option>
              ))}
            </optgroup>
            <optgroup label={t("library.sharing.people")}>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={`user:${u.id}`}>
                  {u.full_name || t("views.chatter.unnamedUser")}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} />
          <span>{t("library.sharing.canWriteLong")}</span>
        </label>
        <div className="flex justify-end">
          <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary" disabled={!who}>
            {t("library.sharing.addButton")}
          </button>
        </div>
      </form>
      <p className="ds-subtle text-[length:var(--ds-text-xs)]">{t("library.sharing.hint")}</p>
    </div>
  );
}
