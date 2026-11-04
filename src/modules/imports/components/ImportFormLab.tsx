"use client";

import { DEFAULT_IMPORTS_CONFIG } from "@/lib/imports/config";
import { stockQuantity } from "@/lib/imports/landedCost";
import type { ImportLookups, ShipmentView } from "../actions/imports";
import { newCost, type CostLineDraft, type ShipmentDraft } from "../lib/shipment";
import { ImportShipmentForm } from "./ImportFormScreen";
import { ViewScope } from "@/views";

/*
 * ?frame=import (IMP-4): the import form as the app builds it, with the mockup's sample numbers
 * (docs/mockups/imports-mockup-v2): 3 sheet products, the first split over two warehouses, and
 * 6 costs. Fixtures (like demo data), not UI texts. Nothing here is saved: the lab has no draft id.
 */
const W1 = "00000000-0000-4000-8000-0000000000a1";
const W2 = "00000000-0000-4000-8000-0000000000a2";
const SUPPLIER = "00000000-0000-4000-8000-0000000000d1";
const CARRIER = "00000000-0000-4000-8000-0000000000d2";
const CUSTOMS = "00000000-0000-4000-8000-0000000000d3";
const P = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;

const LOOKUPS: ImportLookups = {
  suppliers: [
    { id: SUPPLIER, name: "Marmara Board Ltd." },
    { id: CARRIER, name: "Trans Kargo MMC" },
    { id: CUSTOMS, name: "Dövlət Gömrük Komitəsi" },
  ],
  products: [
    { id: P(1), code: "PW-101-PD", name: "101 PARLAQ DOUBLE", unit: "vərəq", sheetLengthM: 4 },
    { id: P(2), code: "PW-103-M", name: "103 MATT", unit: "vərəq", sheetLengthM: 4 },
    { id: P(3), code: "PW-103-MD", name: "103 MATT DOUBLE", unit: "vərəq", sheetLengthM: 4 },
  ],
  warehouses: [
    { id: W1, name: "Əsas anbar (Bakı)", isDefault: true },
    { id: W2, name: "Sumqayıt anbarı", isDefault: false },
  ],
  accounts: [],
};

const line = (n: number, qty: number, price: number, kg: number, extra: Partial<ShipmentDraft["lines"][number]> = {}) => ({
  key: `lab-l${n}`,
  productId: P(n),
  qtyPurchase: qty,
  purchaseUnit: "vərəq",
  qtyStock: stockQuantity(qty, 4),
  unitPriceFc: price,
  weightKg: kg,
  volumeM3: null,
  hsCode: "4412",
  dutyRatePct: 5,
  warehouseId: null,
  warehouses: [],
  ...extra,
});

const cost = (key: string, type: CostLineDraft["costType"], patch: Partial<CostLineDraft>): CostLineDraft => ({
  ...newCost(type, DEFAULT_IMPORTS_CONFIG),
  key,
  ...patch,
});

const DRAFT: ShipmentDraft = {
  id: null,
  number: "IMP-2026-0003",
  status: "draft",
  supplierId: SUPPLIER,
  currencyCode: "USD",
  invoiceNo: "MB-2026-118",
  invoiceDate: "2026-10-06",
  invoiceRate: 1.7,
  incoterm: "FCA",
  customsDeclarationNo: null,
  customsDeclarationDate: null,
  customsRate: null,
  defaultWarehouseId: W1,
  notes: null,
  lines: [
    line(1, 100, 25, 3000, {
      warehouses: [
        { key: "lab-w1", warehouseId: W1, qtyPurchase: 60 },
        { key: "lab-w2", warehouseId: W2, qtyPurchase: 40 },
      ],
    }),
    line(2, 60, 22, 1800),
    line(3, 40, 27.5, 1200, { warehouseId: W2 }),
  ],
  costs: [
    cost("lab-c1", "freight_international", { description: "İstanbul → Bakı, TIR", partnerId: CARRIER, amount: 800, currencyCode: "USD", rateToAzn: 1.7, splitMethod: "by_weight" }),
    cost("lab-c2", "insurance", { description: "Yük sığortası", amount: 60, currencyCode: "USD", rateToAzn: 1.7, splitMethod: "by_value" }),
    cost("lab-c3", "customs_duty", { description: "HS 4412, sətir faizi ilə", partnerId: CUSTOMS, isEstimate: true }),
    cost("lab-c4", "customs_fee", { description: "Bəyannamə yığımı", partnerId: CUSTOMS, amount: 30, isEstimate: true }),
    cost("lab-c5", "freight_local", { description: "Terminal → Əsas anbar", amount: 300, vatAmountAzn: 54, splitMethod: "by_weight", isEstimate: true }),
    cost("lab-c6", "labour", { description: "Fəhlə, 200 vərəq", amount: 150, splitMethod: "by_quantity" }),
  ],
};

const VIEW: ShipmentView = { draft: DRAFT, financials: true, createdByName: "Sura", createdAt: "2026-10-03T10:42:00Z", updatedAt: null, splitsAvailable: true };

export function ImportFormLab() {
  // The same scope as the real page (theme, toasts), so the lab shows what users see.
  return (
    <ViewScope>
      <div data-ui-frame="import">
        <ImportShipmentForm view={VIEW} lookups={LOOKUPS} config={DEFAULT_IMPORTS_CONFIG} />
      </div>
    </ViewScope>
  );
}
