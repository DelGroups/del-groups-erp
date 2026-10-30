/**
 * LIST_COLUMNS (prompt 24c): the column picker on invoice and document lists and the four
 * standard columns (Issued at, Invoice/document date, Salesperson, Created by). Server-only
 * switch, off unless the env value is "true"; while off every list shows today's columns and no
 * picker. The Excel export (.xlsx instead of .csv) does not depend on it.
 */
export function isListColumnsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.LIST_COLUMNS ?? "").trim().toLowerCase() === "true";
}
