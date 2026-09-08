import { formatReferenceTypeLabel, type UnifiedLedgerTransaction } from "@/lib/finance/unifiedLedger";

function formatTypeLabel(type: string): string {
  if (type === "INCOME") return "Gəlir / Mədaxil";
  if (type === "EXPENSE") return "Xərc / Məxaric";
  if (type === "TRANSFER") return "Transfer";
  return type;
}

export function printLedgerReceipt(
  tx: UnifiedLedgerTransaction,
  options?: { companyName?: string; title?: string }
): void {
  const companyName = options?.companyName || "DEL GROUPS MMC";
  const title = options?.title || "Maliyyə Qəbzi";
  const dateText = (tx.transaction_date || tx.created_at).slice(0, 16).replace("T", " ");
  const amountPrefix = tx.type === "INCOME" ? "+" : "-";
  const html = `<!DOCTYPE html>
<html lang="az">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #111; margin: 0; padding: 24px; }
    .receipt { max-width: 720px; margin: 0 auto; border: 1px solid #ddd; padding: 24px; }
    .header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
    .header h1 { margin: 0 0 4px; font-size: 20px; }
    .header p { margin: 0; color: #555; font-size: 12px; }
    .row { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; border-bottom: 1px dashed #ddd; font-size: 13px; }
    .row strong { min-width: 140px; }
    .amount { font-size: 24px; font-weight: bold; text-align: right; margin-top: 16px; }
    .footer { margin-top: 24px; font-size: 11px; color: #666; text-align: center; }
    @media print {
      body { padding: 0; }
      .receipt { border: none; max-width: none; }
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1>${companyName}</h1>
      <p>${title}</p>
      <p>Tranzaksiya ID: ${tx.id}</p>
    </div>
    <div class="row"><strong>Tarix</strong><span>${dateText}</span></div>
    <div class="row"><strong>Növ</strong><span>${formatTypeLabel(tx.type)}</span></div>
    <div class="row"><strong>Kateqoriya</strong><span>${tx.category || "—"}</span></div>
    <div class="row"><strong>Hesab</strong><span>${tx.account_name || "—"}</span></div>
    <div class="row"><strong>Mənbə</strong><span>${formatReferenceTypeLabel(tx.reference_type)}</span></div>
    <div class="row"><strong>Təsvir</strong><span>${tx.description || tx.notes || "—"}</span></div>
    <div class="amount">${amountPrefix}${tx.amount.toFixed(2)} AZN</div>
    <div class="footer">Çap tarixi: ${new Date().toLocaleString("az-AZ")}</div>
  </div>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;

  const popup = window.open("", "_blank", "width=820,height=900");
  if (!popup) return;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}
