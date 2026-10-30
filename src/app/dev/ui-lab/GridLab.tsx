"use client";

import { useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { dataGridLabels } from "@/i18n/uiStandardLabels";
import StatusBadge from "@/components/ui/status-badge";
import { Table, TableWrap, THead, TBody, Th, Td, Tr } from "@/components/ui/table";
import { DataGrid, IconButton, type GridColumn } from "@/design-system/components";
import type { GridDensity } from "@/design-system/grid";
import { formatGridDate, formatGridDateTime, formatMoney, formatQuantity } from "@/lib/dates/localeDate";

/*
 * UI lab (UI-2): a sales-invoice-like list with 20 columns and long Azerbaijani texts, through
 * DataGrid and, for comparison, through the classic table. Fixture data, fixed in az on purpose
 * (the longest real texts); the lab's own texts come from src/i18n.
 */

export interface LabInvoice {
  id: string;
  docNo: string;
  date: string;
  issuedAt: string;
  customer: string;
  company: string;
  warehouse: string;
  salesperson: string;
  createdBy: string;
  status: string;
  sendStatus: string;
  total: number;
  paid: number;
  remaining: number;
  vat: number;
  currency: string;
  paymentType: string;
  dueDate: string;
  quantity: number;
  region: string;
  note: string;
}

const CUSTOMERS = [
  "Abbasov Rəşad Elman oğlu",
  "Gəncə Tikinti və Təmir Xidmətləri MMC",
  "Mehdiyeva Gülnarə",
  "Beynəlxalq Logistika və Gömrük Brokerliyi ASC",
];

export const LAB_INVOICES: LabInvoice[] = Array.from({ length: 8 }, (_, i) => ({
  id: `inv-${i}`,
  docNo: `SAT-2026-${String(1040 + i).padStart(5, "0")}`,
  date: `2026-10-${String(10 + i).padStart(2, "0")}`,
  issuedAt: `2026-10-${String(10 + i).padStart(2, "0")}T0${i % 9}:30:00Z`,
  customer: CUSTOMERS[i % CUSTOMERS.length],
  company: i % 2 ? "Azərbaycan Alüminium Kompozit Panelləri" : "—",
  warehouse: i % 3 ? "Bakı mərkəzi anbar (Binəqədi rayonu)" : "Sumqayıt filialı",
  salesperson: "Hüseynova Səbinə Rauf qızı",
  createdBy: "Əliyev Tural",
  status: i % 3 === 0 ? "Qaralama" : "Təsdiqlənib",
  sendStatus: i % 2 ? "Anbara göndərilib" : "Təsdiq gözləyir",
  total: 1234567.891 / (i + 1),
  paid: (i % 3) * 1000,
  remaining: 1234567.891 / (i + 1) - (i % 3) * 1000,
  vat: 222222.22 / (i + 1),
  currency: "AZN",
  paymentType: i % 2 ? "Bank köçürməsi" : "Nağd",
  dueDate: `2026-11-${String(1 + i).padStart(2, "0")}`,
  quantity: 125.5 * (i + 1),
  region: "Abşeron-Xızı iqtisadi rayonu",
  note: "Müştəri ilə razılaşdırılmış xüsusi endirim və çatdırılma şərtləri tətbiq edilib",
}));

export function GridLab() {
  const { t, locale } = useI18n();
  const [density, setDensity] = useState<GridDensity>("comfortable");
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const l = (key: string) => t(`uiStandard.lab.${key}`);

  const columns = useMemo<GridColumn<LabInvoice>[]>(() => {
    const l = (key: string) => t(`uiStandard.lab.${key}`);
    return [
      { key: "docNo", header: l("docNo"), type: "code", sortable: true, cell: (r) => r.docNo, className: "font-mono font-semibold" },
      { key: "date", header: l("date"), type: "date", sortable: true, cell: (r) => formatGridDate(r.date) },
      { key: "customer", header: l("partner"), sortable: true, cell: (r) => r.customer },
      { key: "company", header: l("company"), cell: (r) => r.company },
      { key: "warehouse", header: l("warehouse"), cell: (r) => r.warehouse },
      { key: "total", header: l("amount"), type: "money", sortable: true, samples: [formatMoney(1234567.89, locale)], cell: (r) => formatMoney(r.total, locale) },
      { key: "paid", header: l("paid"), type: "money", samples: [formatMoney(2000, locale)], cell: (r) => formatMoney(r.paid, locale) },
      { key: "remaining", header: l("remaining"), type: "money", samples: [formatMoney(1234567.89, locale)], cell: (r) => formatMoney(r.remaining, locale) },
      { key: "status", header: l("status"), type: "status", samples: ["Təsdiqlənib", "Qaralama"], cell: (r) => <StatusBadge tone={r.status === "Qaralama" ? "draft" : "posted"}>{r.status}</StatusBadge> },
      { key: "sendStatus", header: l("sendStatus"), type: "status", samples: ["Anbara göndərilib", "Təsdiq gözləyir"], cell: (r) => <StatusBadge tone={r.sendStatus === "Anbara göndərilib" ? "success" : "warning"}>{r.sendStatus}</StatusBadge> },
      { key: "issuedAt", header: l("issuedAt"), type: "datetime", cell: (r) => formatGridDateTime(r.issuedAt, { timeZone: "Asia/Baku" }) },
      { key: "salesperson", header: l("salesperson"), cell: (r) => r.salesperson },
      { key: "createdBy", header: l("createdBy"), cell: (r) => r.createdBy },
      { key: "vat", header: l("vat"), type: "money", samples: [formatMoney(222222.22, locale)], cell: (r) => formatMoney(r.vat, locale) },
      { key: "currency", header: l("currency"), type: "code", cell: (r) => r.currency },
      { key: "paymentType", header: l("paymentType"), cell: (r) => r.paymentType },
      { key: "dueDate", header: l("dueDate"), type: "date", cell: (r) => formatGridDate(r.dueDate) },
      { key: "quantity", header: l("quantity"), type: "number", samples: [formatQuantity(1004, locale)], cell: (r) => formatQuantity(r.quantity, locale) },
      { key: "region", header: l("region"), cell: (r) => r.region },
      { key: "note", header: l("note"), cell: (r) => r.note },
    ];
  }, [t, locale]);
  const totals = { total: formatMoney(LAB_INVOICES.reduce((s, r) => s + r.total, 0), locale), remaining: formatMoney(LAB_INVOICES.reduce((s, r) => s + r.remaining, 0), locale) };
  const toggle = (r: LabInvoice) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r.id)) next.delete(r.id);
      else next.add(r.id);
      return next;
    });

  return (
    <div data-ui-grid-lab="" className="min-w-0">
      <DataGrid<LabInvoice>
        columns={columns}
        rows={LAB_INVOICES}
        rowKey={(r) => r.id}
        label={l("grid")}
        labels={dataGridLabels(t)}
        widths={widths}
        onWidthChange={(key, w) => setWidths((prev) => (w === null ? {} : { ...prev, [key]: w }))}
        density={density}
        onDensityChange={setDensity}
        selection={{
          isSelected: (r) => selected.has(r.id),
          toggle,
          allSelected: selected.size === LAB_INVOICES.length,
          someSelected: selected.size > 0,
          toggleAll: () => setSelected((prev) => (prev.size === LAB_INVOICES.length ? new Set() : new Set(LAB_INVOICES.map((r) => r.id)))),
        }}
        rowActions={() => <IconButton size="sm" label={l("actions")} icon={<MoreHorizontal className="h-4 w-4" />} />}
        totals={totals}
        count={t("uiStandard.grid.count", { count: LAB_INVOICES.length })}
        onExport={() => undefined}
        sort={{ key: "date", dir: "desc" }}
        onSort={() => undefined}
      />
    </div>
  );
}

/** The same rows in today's classic table (Table/Th/Td), for the before / after comparison. */
export function ClassicInvoiceTable() {
  const { t, locale } = useI18n();
  const l = (key: string) => t(`uiStandard.lab.${key}`);
  return (
    // The classic theme's own background and text, as on a classic page.
    <div data-ui-classic-lab="" className="min-w-0" style={{ background: "var(--app-bg)", color: "var(--app-text)" }}>
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <Th>{l("docNo")}</Th>
              <Th>{l("date")}</Th>
              <Th>{l("partner")}</Th>
              <Th>{l("warehouse")}</Th>
              <Th numeric>{l("amount")}</Th>
              <Th numeric>{l("remaining")}</Th>
              <Th>{l("status")}</Th>
              <Th>{l("sendStatus")}</Th>
              <Th>{l("issuedAt")}</Th>
              <Th>{l("salesperson")}</Th>
            </tr>
          </THead>
          <TBody>
            {LAB_INVOICES.map((r) => (
              <Tr key={r.id}>
                <Td className="font-mono font-bold">{r.docNo}</Td>
                <Td>{r.date}</Td>
                <Td>
                  <div className="font-medium">{r.customer}</div>
                  <div className="text-xs text-app-muted">{r.company}</div>
                </Td>
                <Td>{r.warehouse}</Td>
                <Td numeric>{formatMoney(r.total, locale)}</Td>
                <Td numeric>{formatMoney(r.remaining, locale)}</Td>
                <Td>
                  <StatusBadge tone={r.status === "Qaralama" ? "draft" : "posted"}>{r.status}</StatusBadge>
                </Td>
                <Td>
                  <StatusBadge tone={r.sendStatus === "Anbara göndərilib" ? "success" : "warning"}>{r.sendStatus}</StatusBadge>
                </Td>
                <Td>{formatGridDateTime(r.issuedAt, { timeZone: "Asia/Baku" })}</Td>
                <Td>{r.salesperson}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </div>
  );
}
