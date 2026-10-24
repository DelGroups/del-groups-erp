"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, Link2, Trash2, Unlink } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/design-system/components";
import type { Formatter } from "@/views";
import { recordHref } from "@/views/chatter/logic";
import { buildTree, fileSize, folderLabel, isLinkModel, LINK_MODELS, parseTags, previewKind, visibleFolders, type DocumentFolder, type DocumentRow, type LinkModel, type SystemFile } from "../lib/documents";
import { documentUrl, searchRecords, useDocumentActions } from "../lib/data";

/** Preview of an image or a PDF from a link; anything else offers the download only. */
export function Preview({ url, name, mime, fmt }: { url: string | null; name: string; mime: string | null; fmt: Formatter }) {
  const kind = previewKind(mime, name);
  if (!url) return <p className="ds-muted">{fmt.t("common.loading")}</p>;
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage links
    return <img src={url} alt={name} className="max-h-[60vh] w-full rounded-[var(--ds-radius-md)] object-contain" style={{ background: "var(--ds-surface-sunken)" }} />;
  }
  if (kind === "pdf") return <iframe src={url} title={name} className="h-[60vh] w-full rounded-[var(--ds-radius-md)] border" style={{ borderColor: "var(--ds-border)" }} />;
  return <p className="ds-muted">{fmt.t("library.preview.none")}</p>;
}

/** A document of a user folder: preview, name, tags, folder, record link, download, delete. */
export function DocumentPanel({ doc, folders, canWrite, fmt, onClose }: { doc: DocumentRow; folders: readonly DocumentFolder[]; canWrite: boolean; fmt: Formatter; onClose: () => void }) {
  const { t } = fmt;
  const { user } = useAuth();
  const { toast } = useToast();
  const actions = useDocumentActions(user?.id ?? null);
  const url = useQuery({ queryKey: ["documents", "url", doc.storage_path], staleTime: 4 * 60_000, queryFn: () => documentUrl(doc.storage_path) });
  const [name, setName] = useState(doc.name);
  const [tags, setTags] = useState(doc.tags.join(", "));
  const [folderId, setFolderId] = useState(doc.folder_id);
  const fail = (err: unknown) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");
  const targets = visibleFolders(buildTree(folders), new Set(folders.map((f) => f.id))).filter((f) => !f.system_code);
  const link = doc.res_model && doc.res_id ? recordHref(doc.res_model, doc.res_id) : null;

  const save = () => {
    const n = name.trim();
    if (!n) {
      toast(t("library.errors.name"), undefined, "error");
      return;
    }
    actions.updateDocument.mutate(
      { id: doc.id, patch: { name: n.slice(0, 255), tags: parseTags(tags), folder_id: folderId } },
      { onSuccess: () => toast(t("library.saved"), undefined, "success"), onError: fail }
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Preview url={url.data ?? null} name={doc.name} mime={doc.mime_type} fmt={fmt} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="ds-btn ds-btn-sm"
          onClick={() =>
            documentUrl(doc.storage_path, true).then(
              (u) => window.location.assign(u),
              fail
            )
          }
        >
          <Download className="h-4 w-4" aria-hidden />
          {t("library.download")}
        </button>
        {link ? (
          <Link href={link} className="ds-btn ds-btn-sm">
            <ExternalLink className="h-4 w-4" aria-hidden />
            {t("library.openRecord", { model: t(`views.chatter.models.${doc.res_model}`) })}
          </Link>
        ) : null}
        <span className="ml-auto self-center ds-subtle text-[length:var(--ds-text-xs)]">{fileSize(doc.size_bytes)}</span>
      </div>
      {canWrite ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="flex flex-col gap-1" htmlFor="doc-name">
            <span className="ds-label">{t("library.fields.name")}</span>
            <input id="doc-name" className="ds-input" maxLength={255} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1" htmlFor="doc-tags">
            <span className="ds-label">{t("library.fields.tags")}</span>
            <input id="doc-tags" className="ds-input" value={tags} placeholder={t("library.tagsHint")} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1" htmlFor="doc-folder">
            <span className="ds-label">{t("library.fields.folder")}</span>
            <select id="doc-folder" className="ds-input" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              {targets.map((f) => (
                <option key={f.id} value={f.id}>
                  {`${"  ".repeat(f.depth)}${folderLabel(f, t)}`}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-between gap-2">
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" disabled={actions.deleteDocuments.isPending} onClick={() => actions.deleteDocuments.mutate([doc], { onSuccess: onClose, onError: fail })}>
              <Trash2 className="h-4 w-4" aria-hidden />
              {t("library.delete")}
            </button>
            <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary" disabled={actions.updateDocument.isPending}>
              {t("common.save")}
            </button>
          </div>
        </form>
      ) : null}
      {canWrite ? <RecordLink doc={doc} fmt={fmt} /> : null}
    </div>
  );
}

/** Link the document to a record (customer, deal, sale, …), or remove the link. */
function RecordLink({ doc, fmt }: { doc: DocumentRow; fmt: Formatter }) {
  const { t } = fmt;
  const { user } = useAuth();
  const { toast } = useToast();
  const actions = useDocumentActions(user?.id ?? null);
  const [model, setModel] = useState<LinkModel>(doc.res_model && isLinkModel(doc.res_model) ? doc.res_model : "customers");
  const [text, setText] = useState("");
  const [found, setFound] = useState<{ id: string; label: string }[]>([]);
  const fail = (err: unknown) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      searchRecords(model, text).then(
        (rows) => live && setFound(rows),
        () => live && setFound([])
      );
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [model, text]);

  return (
    <section className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--ds-border)" }} aria-labelledby="doc-link-title">
      <h3 id="doc-link-title" className="ds-label">
        {t("library.link.title")}
      </h3>
      {doc.res_model ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{t("library.link.current", { model: t(`views.chatter.models.${doc.res_model}`) })}</span>
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => actions.updateDocument.mutate({ id: doc.id, patch: { res_model: null, res_id: null } }, { onError: fail })}>
            <Unlink className="h-4 w-4" aria-hidden />
            {t("library.link.remove")}
          </button>
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <label className="sr-only" htmlFor="doc-link-model">
          {t("library.link.model")}
        </label>
        <select id="doc-link-model" className="ds-input" value={model} onChange={(e) => setModel(e.target.value as LinkModel)}>
          {(Object.keys(LINK_MODELS) as LinkModel[]).map((m) => (
            <option key={m} value={m}>
              {t(`views.chatter.models.${m}`)}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="doc-link-search">
          {t("library.link.search")}
        </label>
        <input id="doc-link-search" className="ds-input" value={text} placeholder={t("library.link.search")} onChange={(e) => setText(e.target.value)} />
      </div>
      {found.length ? (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {found.map((r) => (
            <li key={r.id}>
              <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost w-full justify-start" onClick={() => actions.updateDocument.mutate({ id: doc.id, patch: { res_model: model, res_id: r.id } }, { onError: fail })}>
                <Link2 className="h-4 w-4" aria-hidden />
                <span className="truncate">{r.label || "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ds-subtle text-[length:var(--ds-text-xs)]">{t("library.link.noMatch")}</p>
      )}
    </section>
  );
}

/** A file of a system folder: preview and the record it belongs to; nothing to change here. */
export function SystemFilePanel({ file, fmt }: { file: SystemFile; fmt: Formatter }) {
  const { t } = fmt;
  const link = recordHref(file.res_model, file.res_id);
  return (
    <div className="flex flex-col gap-4">
      <Preview url={file.url} name={file.name} mime={file.mime_type} fmt={fmt} />
      <div className="flex flex-wrap gap-2">
        {file.url ? (
          <a href={file.url} target="_blank" rel="noopener noreferrer" className="ds-btn ds-btn-sm">
            <Download className="h-4 w-4" aria-hidden />
            {t("library.download")}
          </a>
        ) : null}
        {link ? (
          <Link href={link} className="ds-btn ds-btn-sm">
            <ExternalLink className="h-4 w-4" aria-hidden />
            {t("library.openRecord", { model: t(`views.chatter.models.${file.res_model}`) })}
          </Link>
        ) : null}
      </div>
      <p className="ds-subtle text-[length:var(--ds-text-xs)]">{t("library.system.hint")}</p>
    </div>
  );
}
