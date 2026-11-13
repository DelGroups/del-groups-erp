"use client";

import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { SettingsV2Page, useSettingsV2 } from "@/components/settings/v2/SettingsV2Page";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button, DateField, Drawer, Field, PageHeader, SegmentedControl } from "@/design-system/components";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { useI18n } from "@/i18n/I18nProvider";
import { dateFieldLabels } from "@/i18n/uiStandardLabels";
import { formatGridDateTime } from "@/lib/dates/localeDate";
import { isoToDots } from "@/lib/documents/dateChange";
import { getSupabaseClient } from "@/lib/supabase";
import { RECORD_PARAM } from "@/views";

interface MovedRow {
  table: string;
  id: string;
  column: string;
  old: string;
  new: string;
  group?: string;
}

interface DateChangeRow {
  id: string;
  document_type: "sale" | "purchase";
  document_id: string;
  document_label: string | null;
  old_date: string;
  new_date: string;
  reason: string;
  moved_rows: MovedRow[];
  changed_by_name: string | null;
  changed_at: string;
}

type TypeFilter = "all" | "sale" | "purchase";

/** Where a document opens: the sale page, or the purchase list with the record panel. */
export function documentHref(row: Pick<DateChangeRow, "document_type" | "document_id">): string {
  return row.document_type === "sale" ? `/sales/${row.document_id}` : `/purchases?${RECORD_PARAM}=${encodeURIComponent(row.document_id)}`;
}

/**
 * DATE-1: who changed the date of which posted invoice, when and why (document_date_changes,
 * admins only by RLS). Filters: document type, user, period; a row opens the moved rows.
 */
export default function DateChangesPage() {
  const { t, locale } = useI18n();
  const { isAdmin } = useAuth();
  const settingsV2 = useSettingsV2();
  const [type, setType] = useState<TypeFilter>("all");
  const [user, setUser] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [open, setOpen] = useState<DateChangeRow | null>(null);
  const userId = useId();
  const fromId = useId();
  const toId = useId();

  // RLS shows the rows to admins only; the query runs for admins.
  const query = useQuery({
    queryKey: ["document_date_changes", type, from, to],
    enabled: isAdmin,
    queryFn: async (): Promise<DateChangeRow[]> => {
    let q = getSupabaseClient()
      .from("document_date_changes" as never)
      .select("id, document_type, document_id, document_label, old_date, new_date, reason, moved_rows, changed_by_name, changed_at")
      .order("changed_at", { ascending: false })
      .limit(500);
    if (type !== "all") q = q.eq("document_type", type);
    if (from) q = q.gte("changed_at", `${from}T00:00:00+04:00`);
    if (to) q = q.lte("changed_at", `${to}T23:59:59+04:00`);
    const { data, error: err } = await q;
    if (err) throw new Error(err.message);
    return (data ?? []) as unknown as DateChangeRow[];
    },
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const loading = query.isFetching;
  const error = query.error instanceof Error ? query.error.message : null;
  const load = () => void query.refetch();

  const shown = useMemo(() => {
    const needle = user.trim().toLocaleLowerCase(locale);
    return needle ? rows.filter((r) => (r.changed_by_name ?? "").toLocaleLowerCase(locale).includes(needle)) : rows;
  }, [rows, user, locale]);

  const columns: StandardColumn<DateChangeRow>[] = [
    { key: "changed_at", header: t("dateChange.history.when"), type: "datetime", cell: (r) => formatGridDateTime(r.changed_at, { timeZone: "Asia/Baku" }), sortValue: (r) => r.changed_at },
    { key: "changed_by", header: t("dateChange.history.who"), type: "text", cell: (r) => r.changed_by_name ?? "—", sortValue: (r) => r.changed_by_name ?? "" },
    {
      key: "document",
      header: t("dateChange.history.document"),
      type: "text",
      cell: (r) => (
        <Link href={documentHref(r)} className="underline-offset-2 hover:underline">
          {t(`dateChange.history.types.${r.document_type}`)} {r.document_label ?? ""}
        </Link>
      ),
      sortValue: (r) => r.document_label ?? "",
    },
    { key: "dates", header: t("dateChange.history.dates"), type: "text", cell: (r) => `${isoToDots(r.old_date)} → ${isoToDots(r.new_date)}`, sortValue: (r) => r.new_date },
    { key: "reason", header: t("dateChange.history.reason"), type: "text", cell: (r) => r.reason },
    { key: "moved", header: t("dateChange.history.moved"), type: "number", cell: (r) => r.moved_rows?.length ?? 0, sortValue: (r) => r.moved_rows?.length ?? 0 },
  ];

  const filters = (
    <div className="flex flex-wrap items-end gap-3">
      <SegmentedControl
        label={t("dateChange.history.type")}
        value={type}
        onValueChange={(id) => setType(id as TypeFilter)}
        options={[
          { id: "all", label: t("dateChange.history.types.all") },
          { id: "sale", label: t("dateChange.history.types.sale") },
          { id: "purchase", label: t("dateChange.history.types.purchase") },
        ]}
      />
      <Field label={t("dateChange.history.who")} htmlFor={userId}>
        <input id={userId} className="ds-input" value={user} onChange={(e) => setUser(e.target.value)} />
      </Field>
      <Field label={t("dateChange.history.from")} htmlFor={fromId}>
        <DateField id={fromId} value={from} onChange={setFrom} locale={locale} labels={dateFieldLabels(t)} width="sm" />
      </Field>
      <Field label={t("dateChange.history.to")} htmlFor={toId}>
        <DateField id={toId} value={to} onChange={setTo} locale={locale} labels={dateFieldLabels(t)} width="sm" />
      </Field>
    </div>
  );

  const body = !isAdmin ? (
    <p role="alert" className="m-6">{t("permission.deniedBody")}</p>
  ) : (
    <div className="flex flex-col gap-4" data-date-changes-page="">
      {filters}
      {error ? (
        <p role="alert" style={{ color: "var(--ds-danger-strong)" }}>
          {error}
        </p>
      ) : null}
      <StandardGrid<DateChangeRow>
        id="settings-date-changes"
        label={t("dateChange.history.title")}
        columns={columns}
        rows={shown}
        rowKey={(r) => r.id}
        loading={loading}
        onOpen={setOpen}
        empty={t("dateChange.history.empty")}
      />
      <Drawer open={open !== null} onOpenChange={(next) => (next ? undefined : setOpen(null))} title={t("dateChange.history.movedTitle")} description={open ? `${open.document_label ?? ""} · ${isoToDots(open.old_date)} → ${isoToDots(open.new_date)}` : undefined} labels={{ close: t("common.close") }}>
        {open ? (
          <ul className="flex flex-col gap-1 text-[length:var(--ds-text-sm)]" data-date-change-moved="">
            {open.moved_rows.map((m) => (
              <li key={`${m.table}:${m.id}:${m.column}`} className="flex flex-col border-b py-1.5" style={{ borderColor: "var(--ds-border)" }}>
                <span className="font-semibold">{t(`dateChange.history.tables.${m.table}`)}</span>
                <span className="ds-muted tabular-nums">
                  {formatGridDateTime(m.old, { timeZone: "Asia/Baku" })} → {formatGridDateTime(m.new, { timeZone: "Asia/Baku" })}
                </span>
                <span className="ds-mono text-[length:var(--ds-text-xs)] ds-muted">{m.id}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Drawer>
    </div>
  );

  const refresh = (
    <Button variant="secondary" icon={RefreshCw} onClick={() => void load()} loading={loading}>
      {t("dateChange.history.refresh")}
    </Button>
  );

  if (settingsV2) {
    return (
      <SettingsV2Page id="date-changes" actions={isAdmin ? refresh : null}>
        {body}
      </SettingsV2Page>
    );
  }
  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="date-changes" />
        <div className="space-y-5 p-6">
          <PageHeader title={t("settingsNav.dateChanges.title")} description={t("settingsNav.dateChanges.description")} primary={isAdmin ? refresh : undefined} />
          {body}
        </div>
      </PermissionGuard>
    </PageLayout>
  );
}
