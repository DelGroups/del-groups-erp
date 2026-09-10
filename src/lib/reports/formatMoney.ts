export function formatReportMoney(value: number, currency = "AZN"): string {
  if (value === 0) return "—";
  return `${value.toFixed(2)} ${currency}`;
}

export function formatReportQty(value: number): string {
  if (value === 0) return "—";
  return value % 1 === 0 ? String(value) : value.toFixed(4);
}
