"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Plus, Trash2 } from "lucide-react";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { comboboxLabels } from "@/i18n/uiStandardLabels";
import { Button, Combobox, Dialog, EmptyState, ErrorState, Field, LoadingState, useToast } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { stateLabels } from "@/i18n/uiUnifiedLabels";
import { formatGridDateTime } from "@/lib/dates/localeDate";
import { deleteGuardMemoryAction, listGuardMemoryAction, saveGuardMemoryAction, type GuardMemoryNote } from "@/lib/actions/accountingGuardAgent";
import { GUARD_KEYS } from "./guardUi";

const KINDS = ["fact", "pattern", "preference"] as const;

/**
 * What the accountant agent remembers about the company (GUARD-5): one short note per subject. An admin
 * can add, change and delete notes; the agent can add and update them but has no way to delete one.
 */
export default function GuardMemoryTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const states = stateLabels(t);
  const g = (key: string, p?: Record<string, string | number>) => t(`guard.ui.${key}`, p);
  const [editing, setEditing] = useState<GuardMemoryNote | "new" | null>(null);
  const [deleting, setDeleting] = useState<GuardMemoryNote | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useQuery({
    queryKey: GUARD_KEYS.memory,
    queryFn: async () => {
      const r = await listGuardMemoryAction();
      if (!r.success) throw new Error(t(r.error));
      return r.data;
    },
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: GUARD_KEYS.memory });

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    const r = await deleteGuardMemoryAction(deleting.id);
    setBusy(false);
    if (!r.success) {
      toast(t("common.error"), t(r.error), "error");
      return;
    }
    toast(g("noteDeleted"), undefined, "success");
    setDeleting(null);
    refresh();
  };

  const columns: StandardColumn<GuardMemoryNote>[] = [
    { key: "subject", header: g("colSubject"), width: 260, className: "font-medium", cell: (r) => r.subject, sortValue: (r) => r.subject },
    { key: "body", header: g("colText"), width: 460, cell: (r) => r.body, sortValue: (r) => r.body },
    { key: "kind", header: g("noteKind"), width: 140, cell: (r) => g(`memKind_${r.kind}`), sortValue: (r) => r.kind },
    { key: "source", header: g("colSource"), width: 160, cell: (r) => g(`memSource_${r.source}`), sortValue: (r) => r.source },
    { key: "updated", header: g("colUpdated"), type: "datetime", cell: (r) => formatGridDateTime(r.updatedAt), sortValue: (r) => r.updatedAt },
  ];

  if (list.isError) return <ErrorState title={states.errorTitle} description={list.error instanceof Error ? list.error.message : undefined} retryLabel={states.retry} onRetry={() => void list.refetch()} />;
  if (!list.data) return <LoadingState label={states.loading} rows={6} />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ds-muted max-w-2xl text-[length:var(--ds-text-sm)]">{g("memoryHelp")}</p>
        <Button variant="secondary" icon={Plus} onClick={() => setEditing("new")}>
          {g("addNote")}
        </Button>
      </div>
      {list.data.length === 0 ? (
        <EmptyState icon={Brain} title={g("memoryEmpty")} description={g("memoryEmptyHelp")} />
      ) : (
        <StandardGrid<GuardMemoryNote> id="guard-memory" label={g("tab_memory")} rows={list.data} rowKey={(r) => r.id} columns={columns} onOpen={(r) => setEditing(r)} />
      )}
      <NoteDialog
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.id}
        note={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
        onDelete={(note) => {
          setEditing(null);
          setDeleting(note);
        }}
      />
      <Dialog
        open={deleting !== null}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        size="sm"
        title={g("deleteNoteTitle")}
        labels={{ close: t("common.close") }}
        busy={busy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" icon={Trash2} onClick={() => void remove()} loading={busy}>
              {g("deleteNote")}
            </Button>
          </>
        }
      >
        <p className="text-[length:var(--ds-text-sm)]">
          <strong>{deleting?.subject}</strong>
          <br />
          {g("deleteNoteHelp")}
        </p>
      </Dialog>
    </div>
  );
}

function NoteDialog({ note, open, onClose, onSaved, onDelete }: { note: GuardMemoryNote | null; open: boolean; onClose: () => void; onSaved: () => void; onDelete: (n: GuardMemoryNote) => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const g = (key: string, p?: Record<string, string | number>) => t(`guard.ui.${key}`, p);
  const [subject, setSubject] = useState(note?.subject ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [kind, setKind] = useState<(typeof KINDS)[number]>(note?.kind ?? "fact");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (subject.trim().length < 3 || subject.trim().length > 120 || body.trim().length < 3 || body.trim().length > 2000) {
      setError(t("guard.errors.invalidMemory"));
      return;
    }
    setBusy(true);
    const r = await saveGuardMemoryAction(subject, body, kind);
    setBusy(false);
    if (!r.success) {
      setError(t(r.error));
      return;
    }
    toast(g("noteSaved"), undefined, "success");
    onSaved();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      size="md"
      title={note ? g("editNote") : g("addNote")}
      labels={{ close: t("common.close") }}
      busy={busy}
      footer={
        <>
          {note ? (
            <Button variant="secondary" icon={Trash2} onClick={() => onDelete(note)} disabled={busy}>
              {g("deleteNote")}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={g("noteSubject")} required error={error ?? undefined}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="ds-input w-full"
              maxLength={120}
              value={subject}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              onChange={(e) => {
                setSubject(e.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
        <Field label={g("noteKind")}>
          {({ id }) => (
            <Combobox
              id={id}
              value={kind}
              width="sm"
              labels={comboboxLabels(t)}
              options={KINDS.map((k) => ({ value: k, label: g(`memKind_${k}`) }))}
              onChange={(v) => setKind((v as (typeof KINDS)[number] | null) ?? "fact")}
            />
          )}
        </Field>
        <Field label={g("noteBody")} required>
          {({ id }) => (
            <textarea
              id={id}
              className="ds-input w-full"
              rows={5}
              maxLength={2000}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
