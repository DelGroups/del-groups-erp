"use client";

import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { SettingsV2Page, useSettingsV2 } from "@/components/settings/v2/SettingsV2Page";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button, Chip, Combobox, ConfirmDialog, Dialog, ErrorState, Field, PageHeader, RowActionsMenu, ToastProvider, useToast } from "@/design-system/components";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { useI18n } from "@/i18n/I18nProvider";
import { comboboxLabels } from "@/i18n/uiStandardLabels";
import { formatGridDateTime } from "@/lib/dates/localeDate";
import { getSupabaseClient } from "@/lib/supabase";
import { checkNote, MEMORY_KINDS, MEMORY_SCOPES, type MemoryKind } from "@/lib/assistant/memory";
import { evidenceKind, filterNotes, type MemoryNote } from "@/lib/assistant/memoryPage";

type T = (key: string, params?: Record<string, string | number>) => string;

async function loadNotes(): Promise<{ notes: MemoryNote[]; names: Record<string, string> }> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("assistant_memory" as never)
    .select("id, scope, subject_id, kind, subject, body, source, confidence, evidence, use_count, last_used_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  const notes = (data ?? []) as unknown as MemoryNote[];
  const ids = (scope: string[]) => [...new Set(notes.filter((n) => scope.includes(n.scope) && n.subject_id).map((n) => n.subject_id as string))];
  const names: Record<string, string> = {};
  const people = ids(["user", "employee_note"]);
  const customers = ids(["partner"]);
  const products = ids(["product"]);
  const [p, c, pr] = await Promise.all([
    people.length ? db.from("profiles").select("id, full_name, email").in("id", people) : Promise.resolve({ data: [] }),
    customers.length ? db.from("customers" as never).select("id, full_name, company_name").in("id", customers) : Promise.resolve({ data: [] }),
    products.length ? db.from("products" as never).select("id, name").in("id", products) : Promise.resolve({ data: [] }),
  ]);
  for (const r of (p.data ?? []) as Array<{ id: string; full_name?: string | null; email?: string | null }>) names[r.id] = r.full_name || r.email || "";
  for (const r of (c.data ?? []) as Array<{ id: string; full_name?: string | null; company_name?: string | null }>) names[r.id] = r.full_name || r.company_name || "";
  for (const r of (pr.data ?? []) as Array<{ id: string; name?: string | null }>) names[r.id] = r.name || "";
  return { notes, names };
}

/**
 * AST-3: Settings → Assistant memory. Everything Del Assistant remembers, for admins only (Del, 2026-11-14):
 * filter by scope, kind and employee (a person's notes are their profile), edit, delete, add a company note.
 * Writes go through assistant_memory_update / _delete / _save, which check the admin and log the change.
 */
export default function AssistantMemoryPage() {
  const { t } = useI18n();
  return (
    <ToastProvider closeLabel={t("uiUnified.dialog.close")}>
      <MemoryPage />
    </ToastProvider>
  );
}

function MemoryPage() {
  const { t, locale } = useI18n();
  const { isAdmin } = useAuth();
  const settingsV2 = useSettingsV2();
  const { toast } = useToast();
  const [scope, setScope] = useState("all");
  const [kind, setKind] = useState("all");
  const [person, setPerson] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<MemoryNote | "new" | null>(null);
  const [deleting, setDeleting] = useState<MemoryNote | null>(null);
  const ids = { scope: useId(), kind: useId(), person: useId(), search: useId() };

  const query = useQuery({ queryKey: ["assistant_memory"], enabled: isAdmin, queryFn: loadNotes });
  const notes = useMemo(() => query.data?.notes ?? [], [query.data]);
  const names = useMemo(() => query.data?.names ?? {}, [query.data]);
  const shown = useMemo(() => filterNotes(notes, { scope, kind, person, search }), [notes, scope, kind, person, search]);
  const peopleOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const n of notes) if ((n.scope === "user" || n.scope === "employee_note") && n.subject_id) seen.set(n.subject_id, names[n.subject_id] || t("assistant.memory.employee"));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], locale)).map(([value, label]) => ({ value, label }));
  }, [notes, names, t, locale]);
  const filtered = scope !== "all" || kind !== "all" || person !== "all" || search.trim() !== "";

  const about = (n: MemoryNote) => (n.scope === "company" ? t("assistant.memory.company") : (n.subject_id && names[n.subject_id]) || "—");
  const columns: StandardColumn<MemoryNote>[] = [
    { key: "subject", header: t("assistant.memory.subject"), type: "text", cell: (n) => n.subject, sortValue: (n) => n.subject },
    { key: "body", header: t("assistant.memory.note"), type: "text", cell: (n) => n.body },
    { key: "scope", header: t("assistant.memory.scope"), type: "status", cell: (n) => <Chip tone="neutral">{t(`assistant.memory.scope_${n.scope}`)}</Chip>, sortValue: (n) => n.scope },
    { key: "about", header: t("assistant.memory.about"), type: "text", cell: about, sortValue: about },
    { key: "kind", header: t("assistant.memory.kind"), type: "status", cell: (n) => t(`assistant.memory.kind_${n.kind}`), sortValue: (n) => n.kind },
    { key: "source", header: t("assistant.memory.source"), type: "text", cell: (n) => t(`assistant.memory.source_${n.source}`), sortValue: (n) => n.source },
    { key: "used", header: t("assistant.memory.used"), type: "number", cell: (n) => n.use_count, sortValue: (n) => n.use_count },
    { key: "updated", header: t("assistant.memory.updated"), type: "datetime", cell: (n) => formatGridDateTime(n.updated_at, { timeZone: "Asia/Baku" }), sortValue: (n) => n.updated_at },
  ];

  const remove = async () => {
    if (!deleting) return;
    const { error } = await getSupabaseClient().rpc("assistant_memory_delete" as never, { p_id: deleting.id } as never);
    if (error) {
      toast(t("assistant.memory.failed"), undefined, "error");
      throw new Error(error.message);
    }
    toast(t("assistant.memory.deleted"), undefined, "success");
    setDeleting(null);
    await query.refetch();
  };

  const filters = (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t("assistant.memory.scope")} htmlFor={ids.scope}>
        <Combobox
          id={ids.scope}
          value={scope}
          onChange={(v) => setScope(v ?? "all")}
          options={[{ value: "all", label: t("assistant.memory.all") }, ...MEMORY_SCOPES.map((s) => ({ value: s, label: t(`assistant.memory.scope_${s}`) }))]}
          labels={comboboxLabels(t)}
          locale={locale}
          width="md"
        />
      </Field>
      <Field label={t("assistant.memory.kind")} htmlFor={ids.kind}>
        <Combobox
          id={ids.kind}
          value={kind}
          onChange={(v) => setKind(v ?? "all")}
          options={[{ value: "all", label: t("assistant.memory.all") }, ...MEMORY_KINDS.map((k) => ({ value: k, label: t(`assistant.memory.kind_${k}`) }))]}
          labels={comboboxLabels(t)}
          locale={locale}
          width="md"
        />
      </Field>
      <Field label={t("assistant.memory.employee")} htmlFor={ids.person}>
        <Combobox
          id={ids.person}
          value={person}
          onChange={(v) => setPerson(v ?? "all")}
          options={[{ value: "all", label: t("assistant.memory.all") }, ...peopleOptions]}
          labels={comboboxLabels(t)}
          locale={locale}
          width="md"
        />
      </Field>
      <Field label={t("assistant.memory.search")} htmlFor={ids.search}>
        <input id={ids.search} className="ds-input ds-w-md" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
    </div>
  );

  const body = !isAdmin ? (
    <p role="alert" className="m-6">{t("permission.deniedBody")}</p>
  ) : (
    <div className="flex flex-col gap-4" data-assistant-memory-page="">
      <p className="ds-muted text-[length:var(--ds-text-sm)]">{t("assistant.memory.privacy")}</p>
      {filters}
      {person !== "all" ? (
        <p className="font-semibold">{t("assistant.memory.profile", { name: names[person] || t("assistant.memory.employee"), count: shown.length })}</p>
      ) : null}
      {query.error ? (
        <ErrorState title={t("assistant.memory.loadError")} retryLabel={t("assistant.memory.retry")} onRetry={() => void query.refetch()} />
      ) : (
        <StandardGrid<MemoryNote>
          id="settings-assistant-memory"
          label={t("settingsNav.assistantMemory.title")}
          columns={columns}
          rows={shown}
          rowKey={(n) => n.id}
          loading={query.isFetching}
          onOpen={(n) => setEditing(n)}
          countText={t("assistant.memory.count", { count: shown.length })}
          empty={
            filtered ? (
              <span className="flex flex-col items-center gap-2">
                {t("assistant.memory.emptyFiltered")}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setScope("all");
                    setKind("all");
                    setPerson("all");
                    setSearch("");
                  }}
                >
                  {t("assistant.memory.clearFilters")}
                </Button>
              </span>
            ) : (
              t("assistant.memory.empty")
            )
          }
          rowActions={(n) => (
            <RowActionsMenu
              label={t("assistant.memory.actions")}
              items={[
                { key: "edit", label: t("assistant.memory.edit"), icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(n) },
                { key: "delete", label: t("assistant.memory.delete"), icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => setDeleting(n) },
              ]}
            />
          )}
        />
      )}
      {editing ? (
        <NoteDialog
          key={editing === "new" ? "new" : editing.id}
          note={editing === "new" ? null : editing}
          t={t}
          locale={locale}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            toast(t("assistant.memory.saved"), undefined, "success");
            setEditing(null);
            await query.refetch();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={t("assistant.memory.deleteTitle", { subject: deleting?.subject ?? "" })}
        description={t("assistant.memory.deleteBody")}
        labels={{ close: t("uiUnified.dialog.close"), cancel: t("uiUnified.dialog.cancel"), working: t("uiUnified.dialog.working"), confirm: t("assistant.memory.deleteConfirm") }}
        onConfirm={remove}
      />
    </div>
  );

  const primary = isAdmin ? (
    <Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>
      {t("assistant.memory.newNote")}
    </Button>
  ) : null;

  if (settingsV2) {
    return (
      <SettingsV2Page id="assistant-memory" actions={primary}>
        {body}
      </SettingsV2Page>
    );
  }
  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="assistant-memory" />
        <div className="space-y-5 p-6">
          <PageHeader title={t("settingsNav.assistantMemory.title")} description={t("settingsNav.assistantMemory.description")} primary={primary ?? undefined} />
          {body}
        </div>
      </PermissionGuard>
    </PageLayout>
  );
}

/** Edit a note, or write a new company note; shows where a note was learned from. */
function NoteDialog({ note, t, locale, onClose, onSaved }: { note: MemoryNote | null; t: T; locale: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [subject, setSubject] = useState(note?.subject ?? "");
  const [text, setText] = useState(note?.body ?? "");
  const [kind, setKind] = useState<MemoryKind>((note?.kind as MemoryKind) ?? "fact");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { subject: useId(), body: useId(), kind: useId() };
  const source = note ? evidenceKind(note) : null;

  const save = async () => {
    const check = checkNote({ scope: "company", subject, body: text, kind });
    if (!check.ok) {
      setError(t(check.reason === "forbidden" ? "assistant.memory.forbidden" : "assistant.memory.invalid"));
      return;
    }
    setSaving(true);
    setError(null);
    const db = getSupabaseClient();
    const { error: err } = note
      ? await db.rpc("assistant_memory_update" as never, { p_id: note.id, p_subject: check.note.subject, p_body: check.note.body, p_kind: kind } as never)
      : await db.rpc("assistant_memory_save" as never, { p_scope: "company", p_subject: check.note.subject, p_body: check.note.body, p_kind: kind, p_source: "admin" } as never);
    setSaving(false);
    if (err) {
      setError(t(/forbidden_memory/.test(err.message) ? "assistant.memory.forbidden" : "assistant.memory.failed"));
      return;
    }
    await onSaved();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      size="md"
      title={note ? t("assistant.memory.editTitle") : t("assistant.memory.newTitle")}
      labels={{ close: t("uiUnified.dialog.close") }}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("uiUnified.dialog.cancel")}
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            {t("assistant.memory.saveNote")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={t("assistant.memory.subjectLabel")} htmlFor={ids.subject} required>
          <input id={ids.subject} className="ds-input w-full" value={subject} maxLength={120} aria-required onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label={t("assistant.memory.bodyLabel")} htmlFor={ids.body} required error={error}>
          <textarea id={ids.body} className="ds-input w-full" rows={4} value={text} maxLength={1000} aria-required onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label={t("assistant.memory.kindLabel")} htmlFor={ids.kind}>
          <Combobox
            id={ids.kind}
            value={kind}
            onChange={(v) => setKind((v as MemoryKind) ?? "fact")}
            options={MEMORY_KINDS.map((k) => ({ value: k, label: t(`assistant.memory.kind_${k}`) }))}
            labels={comboboxLabels(t)}
            locale={locale}
            width="md"
          />
        </Field>
        {note && source ? (
          <p className="ds-muted text-[length:var(--ds-text-sm)]">
            {t("assistant.memory.evidence")}: {source.key === "evidenceAudit" ? t("assistant.memory.evidenceAudit", { table: source.table }) : t(`assistant.memory.${source.key}`)}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
