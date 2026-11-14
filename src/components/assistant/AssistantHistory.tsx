"use client";

import React, { useCallback, useEffect, useState } from "react";
import { MessagesSquare, Pencil, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, Dialog, ErrorState, Field, RowActionsMenu, SkeletonList, Truncate, useToast } from "@/design-system/components";
import { formatGridDateTime } from "@/lib/dates/localeDate";
import { cleanTitle, TITLE_MAX, type ConversationItem } from "@/lib/assistant/history";

type T = (key: string, params?: Record<string, string | number>) => string;

export interface AssistantHistoryProps {
  t: T;
  activeId: string | null;
  onOpen: (id: string) => void;
  /** The open conversation was deleted: start a new one. */
  onDeletedActive: () => void;
}

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; items: ConversationItem[] };

/** The user's conversations (AST-2): open, rename, delete (soft: it leaves the list). */
export function AssistantHistory({ t, activeId, onOpen, onDeletedActive }: AssistantHistoryProps) {
  const { toast } = useToast();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [renaming, setRenaming] = useState<ConversationItem | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ConversationItem | null>(null);

  const refresh = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const response = await fetch("/api/assistant/conversations", { credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { conversations?: ConversationItem[] };
      setLoad({ state: "ready", items: body.conversations ?? [] });
    } catch {
      setLoad({ state: "error" });
    }
  }, []);

  useEffect(() => {
    // Loads once when the history opens; the list is fetched from the server, not derived from props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(String(response.status));
  }, []);

  const saveName = async () => {
    if (!renaming) return;
    const title = cleanTitle(name);
    if (!title) return;
    setSaving(true);
    try {
      await patch(renaming.id, { title });
      setLoad((l) => (l.state === "ready" ? { ...l, items: l.items.map((i) => (i.id === renaming.id ? { ...i, title } : i)) } : l));
      toast(t("assistant.renamed"), undefined, "success");
      setRenaming(null);
    } catch {
      toast(t("assistant.actionFailed"), undefined, "error");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await patch(deleting.id, { hidden: true });
      setLoad((l) => (l.state === "ready" ? { ...l, items: l.items.filter((i) => i.id !== deleting.id) } : l));
      toast(t("assistant.deleted"), undefined, "success");
      if (deleting.id === activeId) onDeletedActive();
      setDeleting(null);
    } catch {
      toast(t("assistant.actionFailed"), undefined, "error");
      throw new Error("delete failed");
    }
  };

  if (load.state === "loading") {
    return (
      <div className="ds-assistant-history">
        <SkeletonList loading rows={5} label={t("assistant.loadingChat")}>{null}</SkeletonList>
      </div>
    );
  }
  if (load.state === "error") {
    return (
      <div className="ds-assistant-history">
        <ErrorState title={t("assistant.historyError")} retryLabel={t("assistant.retry")} onRetry={() => void refresh()} />
      </div>
    );
  }

  return (
    <div className="ds-assistant-history">
      {load.items.length === 0 ? (
        <div className="ds-assistant-history-empty">
          <MessagesSquare className="h-6 w-6" aria-hidden />
          <p className="font-semibold">{t("assistant.historyEmpty")}</p>
          <p className="ds-muted">{t("assistant.historyEmptyBody")}</p>
        </div>
      ) : (
        <ul className="ds-assistant-history-list" aria-label={t("assistant.historyTitle")}>
          {load.items.map((item) => {
            const title = item.title || t("assistant.untitled");
            return (
              <li key={item.id} data-active={item.id === activeId || undefined}>
                <button type="button" className="ds-assistant-history-open" onClick={() => onOpen(item.id)} aria-current={item.id === activeId ? "true" : undefined}>
                  <Truncate className="font-medium">{title}</Truncate>
                  <span className="ds-muted text-[length:var(--ds-text-xs)]">{item.updatedAt ? formatGridDateTime(item.updatedAt) : ""}</span>
                </button>
                <RowActionsMenu
                  label={t("assistant.chatActions")}
                  items={[
                    {
                      key: "rename",
                      label: t("assistant.rename"),
                      icon: <Pencil className="h-4 w-4" />,
                      onSelect: () => {
                        setName(item.title);
                        setRenaming(item);
                      },
                    },
                    { key: "delete", label: t("assistant.delete"), icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => setDeleting(item) },
                  ]}
                />
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={!!renaming}
        onOpenChange={(open) => (open ? undefined : setRenaming(null))}
        size="sm"
        title={t("assistant.renameTitle")}
        labels={{ close: t("uiUnified.dialog.close") }}
        busy={saving}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(null)} disabled={saving}>
              {t("uiUnified.dialog.cancel")}
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void saveName()}>
              {t("assistant.renameSave")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <Field label={t("assistant.renameLabel")} htmlFor="ds-assistant-rename" required>
            <input id="ds-assistant-rename" className="ds-input w-full" value={name} maxLength={TITLE_MAX} onChange={(e) => setName(e.target.value)} />
          </Field>
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={t("assistant.deleteTitle", { title: deleting?.title || t("assistant.untitled") })}
        description={t("assistant.deleteBody")}
        labels={{ close: t("uiUnified.dialog.close"), cancel: t("uiUnified.dialog.cancel"), working: t("uiUnified.dialog.working"), confirm: t("assistant.deleteConfirm") }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
