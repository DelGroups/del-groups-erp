import type { ReportDatePreset, ReportFilters } from "@/types/database.types";

export interface DateRangeBounds {
  startDate: string;
  endDate: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getDateRangeBounds(
  preset: ReportDatePreset,
  customStart?: string,
  customEnd?: string
): DateRangeBounds {
  const now = new Date();
  const today = toDateString(now);

  switch (preset) {
    case "today":
      return { startDate: today, endDate: today };
    case "week": {
      const start = new Date(now);
      const day = start.getDay();
      const diff = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diff);
      return { startDate: toDateString(start), endDate: today };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { startDate: toDateString(start), endDate: toDateString(end) };
    }
    case "custom":
      return {
        startDate: customStart || today,
        endDate: customEnd || today,
      };
    default:
      return { startDate: today, endDate: today };
  }
}

export function resolveReportDateRange(filters: ReportFilters): DateRangeBounds {
  return getDateRangeBounds(filters.datePreset, filters.startDate, filters.endDate);
}

/** Prefer doc_date, fall back to created_at date portion. */
export function getRecordDate(docDate: string | null | undefined, createdAt: string | null | undefined): string {
  if (docDate) return docDate.slice(0, 10);
  if (createdAt) return createdAt.slice(0, 10);
  return "";
}

export function isDateInRange(dateStr: string, start: string, end: string): boolean {
  if (!dateStr) return false;
  return dateStr >= start && dateStr <= end;
}

export function getTransactionDate(createdAt: string | null | undefined): string {
  return createdAt ? createdAt.slice(0, 10) : "";
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  datePreset: "month",
  startDate: toDateString(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  endDate: toDateString(new Date()),
  warehouseId: "",
  category: "",
  employeeId: "",
};

export const DATE_PRESET_LABELS: Record<ReportDatePreset, string> = {
  today: "Bu gün",
  week: "Bu həftə",
  month: "Bu ay",
  custom: "Xüsusi tarix",
};
