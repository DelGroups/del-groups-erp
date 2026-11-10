// INV-2: test invoices for tests/invoiceExport.test.mjs and scripts/invoice-export-samples.mjs.
// Made-up data (no real customers); Azerbaijani letters on purpose: ə ğ ı ö ş ü ç.

export const BRANDING = {
  companyName: "Nümunə Mebel MMC",
  logoUrl: null,
  voen: "1234567890",
  address: "Bakı şəh., Nəsimi r-nu, Şövkət Ələkbərova küç. 12",
  phone: "+994 12 555 00 00",
  email: null,
  bankName: null,
  iban: null,
};

/** Official sales invoice in USD: line discounts (percent and fixed), VAT, extra costs, two payments. */
export function saleFixture(overrides = {}) {
  return {
    id: "s1",
    doc_no: "SAT-2026/0042",
    doc_date: "2026-11-09",
    customer_id: "c1",
    customer_name: "Gülşən Əliyeva — Şüşə Dünyası",
    seller_name: "Ömər Çələbiyev",
    issued_by_name: "Ömər Çələbiyev",
    created_by_name: "Səbinə Qasımova",
    warehouse_name: "Əsas anbar (Xırdalan)",
    subtotal: 1250,
    discount_total: 75,
    vat_total: 211.5,
    total_amount: 1426.5,
    paid_amount: 1000,
    remaining_balance: 426.5,
    delivery_address: null,
    delivery_type: null,
    delivery_fee: 0,
    note: "Çatdırılma şənbə günü, saat 10:00-da.",
    created_at: "2026-11-09T08:30:00Z",
    warehouse_sent: false,
    warehouse_slip_status: null,
    status: "posted",
    is_official: true,
    vat_mode: "exclusive",
    vat_rate: 18,
    vat_amount: 211.5,
    grand_total: 1426.5,
    additional_expenses_total: 40,
    currency: "USD",
    exchange_rate: 1.7,
    items: [
      { id: "i1", product_id: "p1", product_code: "LAM-105", product_name: "Laminat lövhə 105 MATT DOUBLE", warehouse_id: "w1", warehouse_name: "Əsas anbar", quantity: 10, unit: "vərəq", unit_price: 85, discount_percent: 5, discount_type: "percentage", vat_rate: 18, total: 807.5, extra_info: "" },
      { id: "i2", product_id: "p2", product_code: "KNT-22", product_name: "Kənar lenti, ağ (22 mm)", warehouse_id: "w1", warehouse_name: "Əsas anbar", quantity: 120.5, unit: "m", unit_price: 2, discount_percent: 32.5, discount_type: "fixed", vat_rate: 18, total: 208.5, extra_info: "" },
      { id: "i3", product_id: "p3", product_code: "", product_name: "Kəsim xidməti", warehouse_id: "w1", warehouse_name: "Əsas anbar", quantity: 1, unit: "xidmət", unit_price: 159, discount_percent: 0, vat_rate: 18, total: 159, extra_info: "", sale_item_type: "service" },
    ],
    payments: [
      { id: "pay1", account_id: "a1", method: "Nağd", amount: 600, date: "2026-11-09" },
      { id: "pay2", account_id: "a2", method: "Bank köçürməsi", amount: 400, date: "2026-11-10" },
    ],
    ...overrides,
  };
}

/** Regular (not official) AZN sales invoice, no VAT, no payments. */
export function plainSaleFixture(overrides = {}) {
  return saleFixture({
    doc_no: "SAT-2026/0043",
    is_official: false,
    vat_mode: "none",
    vat_total: 0,
    vat_amount: 0,
    currency: "AZN",
    exchange_rate: 1,
    additional_expenses_total: 0,
    subtotal: 170,
    discount_total: 0,
    total_amount: 170,
    grand_total: 170,
    paid_amount: 0,
    remaining_balance: 170,
    items: [{ id: "j1", product_id: "p1", product_code: "LAM-105", product_name: "Laminat lövhə", warehouse_id: "w1", warehouse_name: "Əsas anbar", quantity: 2, unit: "vərəq", unit_price: 85, discount_percent: 0, vat_rate: 0, total: 170, extra_info: "" }],
    payments: [],
    ...overrides,
  });
}

/** Official purchase invoice with VAT, extra costs and one EUR line. */
export function purchaseFixture(overrides = {}) {
  return {
    id: "pu1",
    invoice_number: "AL-2026/0108",
    supplier_id: "sup1",
    supplier_name: "Şəki Ağac Emalı ASC",
    warehouse_id: "w1",
    warehouse_name: "Əsas anbar (Xırdalan)",
    doc_date: "2026-11-05",
    responsible_name: "Rəşad Hüseynov",
    created_by_name: "Səbinə Qasımova",
    total_amount: 2419,
    paid_amount: 1500,
    debt_amount: 919,
    status: "posted",
    notes: "Yük maşını ilə gəldi, 2 palet.",
    additional_expenses: [
      { id: "e1", category_id: "c", label: "Daşınma", amount: 120, paid_immediately: true, account_id: "a1" },
      { id: "e2", category_id: "c", label: "Yükləmə", amount: 30, paid_immediately: false, account_id: "" },
    ],
    created_at: "2026-11-05T09:00:00Z",
    is_official: true,
    vat_mode: "exclusive",
    subtotal_amount: 1922.88,
    vat_rate: 18,
    vat_amount: 346.12,
    grand_total: 2269,
    items: [
      { id: "l1", product_id: "p1", product_code: "LAM-105", product_name: "Laminat lövhə 105 MATT DOUBLE", quantity: 20, unit: "vərəq", unit_price: 55, total: 1100 },
      { id: "l2", product_id: "p4", product_code: "MNT-01", product_name: "Mentesə (yumşaq bağlanan)", quantity: 300, unit: "ədəd", unit_price: 2.743, total: 822.88, currency: "EUR", exchange_rate: 1.85 },
    ],
    ...overrides,
  };
}
