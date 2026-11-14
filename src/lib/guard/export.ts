import { formatGridDate } from "@/lib/dates/localeDate";
import type { SheetColumn } from "@/lib/reports/debtorReport";
import { findingDay, type GuardFinding, type GuardQuery } from "./findings";

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Columns of the findings in Excel and on paper: one list for both, so the file and the print
 * always agree. Texts come from the user's language (guard.*). Pure: `node --test` covers it.
 */
export function findingColumns(t: T): SheetColumn<GuardFinding>[] {
  const g = (key: string) => t(`guard.ui.${key}`);
  return [
    { header: g("colSeverity"), kind: "text", value: (f) => t(`guard.severity.${f.severity}`) },
    { header: g("colRule"), kind: "text", value: (f) => `${f.rule} · ${t(`guard.rule.${f.rule}`)}` },
    { header: g("colStatus"), kind: "text", value: (f) => t(`guard.status.${f.status}`) },
    { header: g("colDocument"), kind: "text", value: (f) => f.docNo },
    { header: g("colDate"), kind: "date", value: (f) => f.docDate },
    { header: g("colPartner"), kind: "text", value: (f) => f.partnerName },
    { header: g("colAmount"), kind: "money", value: (f) => f.amount },
    { header: g("colCreatedBy"), kind: "text", value: (f) => f.createdByName },
    { header: g("colFirstSeen"), kind: "date", value: (f) => f.firstSeenAt.slice(0, 10) || null },
    { header: g("colNote"), kind: "text", value: (f) => f.note },
  ];
}

/** The header lines of the Excel file and the print: every filter that is set (names, not ids). */
export function findingFilterLines(q: GuardQuery, t: T, names: { partner?: string | null; creator?: string | null } = {}): [string, string][] {
  const g = (key: string) => t(`guard.ui.${key}`);
  const lines: [string, string][] = [[g("colStatus"), q.status === "active" ? g("statusActive") : q.status === "all" ? g("statusAll") : t(`guard.status.${q.status}`)]];
  if (q.severity) lines.push([g("colSeverity"), t(`guard.severity.${q.severity}`)]);
  if (q.category) lines.push([g("colCategory"), t(`guard.category.${q.category}`)]);
  if (q.rule) lines.push([g("colRule"), `${q.rule} · ${t(`guard.rule.${q.rule}`)}`]);
  if (q.from) lines.push([g("from"), formatGridDate(q.from)]);
  if (q.to) lines.push([g("to"), formatGridDate(q.to)]);
  if (q.partner) lines.push([g("colPartner"), names.partner || q.partner]);
  if (q.creator) lines.push([g("colCreatedBy"), names.creator || q.creator]);
  if (q.entity) lines.push([g("colDocumentType"), q.entity]);
  if (q.search) lines.push([g("search"), q.search]);
  return lines;
}

/** guard-findings-yyyy-mm-dd.xlsx */
export function findingsFileName(today: string, ext: "xlsx" = "xlsx"): string {
  return `accounting-guard-findings-${today}.${ext}`;
}

/** The oldest and newest day of a list of findings (for a report's period line); null when empty. */
export function findingsPeriod(list: readonly GuardFinding[]): { from: string; to: string } | null {
  if (list.length === 0) return null;
  const days = list.map(findingDay).sort();
  return { from: days[0], to: days[days.length - 1] };
}
