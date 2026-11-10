import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isInvoiceToolsEnabled } from "../src/lib/features/invoiceTools.ts";
import {
  createdProductTarget,
  isEmptyPurchaseLine,
  isEmptySaleLine,
  showInvoiceNewProduct,
} from "../src/lib/invoices/newProduct.ts";
import { canQuickCreate } from "../src/components/lookups/registry.ts";
import { azMessages } from "../src/i18n/messages/az.ts";
import { enMessages } from "../src/i18n/messages/en.ts";
import { ruMessages } from "../src/i18n/messages/ru.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const user = (permissions, isAdmin = false) => ({ isAdmin, can: (p) => permissions.includes(p) });
const byId = (row) => row.id;

// ── Flag ────────────────────────────────────────────────────────────────────

test("INVOICE_TOOLS is off unless the env value is true", () => {
  assert.equal(isInvoiceToolsEnabled({}), false);
  assert.equal(isInvoiceToolsEnabled({ INVOICE_TOOLS: "" }), false);
  assert.equal(isInvoiceToolsEnabled({ INVOICE_TOOLS: "false" }), false);
  assert.equal(isInvoiceToolsEnabled({ INVOICE_TOOLS: "1" }), false);
  assert.equal(isInvoiceToolsEnabled({ INVOICE_TOOLS: " TRUE " }), true);
});

test("the root layout passes INVOICE_TOOLS to client screens", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /<InvoiceToolsProvider enabled=\{isInvoiceToolsEnabled\(\)\}>/);
  assert.match(read(".env.saas.example"), /^INVOICE_TOOLS=$/m);
});

// ── Who sees the button ─────────────────────────────────────────────────────

test("New product shows only with the flag on and the product permission", () => {
  assert.equal(showInvoiceNewProduct({ flag: true, canCreate: true }), true);
  assert.equal(showInvoiceNewProduct({ flag: false, canCreate: true }), false);
  assert.equal(showInvoiceNewProduct({ flag: true, canCreate: false }), false);
  assert.equal(showInvoiceNewProduct({ flag: false, canCreate: false }), false);
});

test("New product is hidden in the polywood-only sales mode, like Select products", () => {
  assert.equal(showInvoiceNewProduct({ flag: true, canCreate: true, polywoodOnly: true }), false);
  assert.equal(showInvoiceNewProduct({ flag: true, canCreate: true, polywoodOnly: false }), true);
});

test("the permission is the product quick-create one (can_manage_products, or admin)", () => {
  assert.equal(canQuickCreate("product", user(["can_manage_products"])), true);
  assert.equal(canQuickCreate("product", user(["can_create_invoice", "can_create_purchase"])), false);
  assert.equal(canQuickCreate("product", user([], true)), true);
});

// ── Where the created product goes ──────────────────────────────────────────

test("a sales line is empty when it has no product", () => {
  assert.equal(isEmptySaleLine({ product_id: "" }), true);
  assert.equal(isEmptySaleLine({ product_id: null }), true);
  assert.equal(isEmptySaleLine({}), true);
  assert.equal(isEmptySaleLine({ product_id: "p1" }), false);
});

test("a purchase line is empty when it has no product and no typed name", () => {
  assert.equal(isEmptyPurchaseLine({ product_id: "", product_name: "" }), true);
  assert.equal(isEmptyPurchaseLine({ product_id: "", product_name: "   " }), true);
  assert.equal(isEmptyPurchaseLine({ product_id: "", product_name: "Typed" }), false);
  assert.equal(isEmptyPurchaseLine({ product_id: "p1", product_name: "" }), false);
});

test("the created product goes on the first empty sales line", () => {
  const lines = [
    { id: "a", product_id: "p1" },
    { id: "b", product_id: "" },
    { id: "c", product_id: "" },
  ];
  assert.deepEqual(createdProductTarget(lines, isEmptySaleLine, byId), { kind: "line", id: "b" });
});

test("with no empty line a new line is added", () => {
  const sales = [
    { id: "a", product_id: "p1" },
    { id: "b", product_id: "p2" },
  ];
  assert.deepEqual(createdProductTarget(sales, isEmptySaleLine, byId), { kind: "new" });
  assert.deepEqual(createdProductTarget([], isEmptySaleLine, byId), { kind: "new" });
});

test("a purchase line with only a typed name is kept, the next empty one is used", () => {
  const lines = [
    { id: "a", product_id: "", product_name: "Typed by hand" },
    { id: "b", product_id: "", product_name: "" },
  ];
  assert.deepEqual(createdProductTarget(lines, isEmptyPurchaseLine, byId), { kind: "line", id: "b" });
  assert.deepEqual(createdProductTarget(lines.slice(0, 1), isEmptyPurchaseLine, byId), { kind: "new" });
});

// ── The forms keep today's behaviour while the flag is off ──────────────────

test("both forms render the button only when allowed and reuse their product-pick handler", () => {
  const sales = read("src/modules/sales/components/InvoiceForm.tsx");
  assert.match(sales, /useInvoiceNewProductAllowed\(\{ polywoodOnly \}\)/);
  assert.equal(sales.match(/\{newProductAllowed \? \(\s*<InvoiceNewProductButton/g)?.length, 2, "page and modal layouts");
  assert.match(sales, /void applyPickedProduct\(rowId, product\);/);
  assert.match(sales, /await applyPickedProduct\(targetRowId, product, quantity\);/);
  assert.match(sales, /canCreateProduct=\{newProductAllowed && !documentLocked\}/);

  const purchase = read("src/modules/purchases/components/PurchaseForm.tsx");
  assert.match(purchase, /const newProductAllowed = useInvoiceNewProductAllowed\(\);/);
  assert.match(purchase, /\{newProductAllowed \? \(\s*<InvoiceNewProductButton/);
  assert.match(purchase, /handleProductRecord\(rowId, record\);/);
});

test("the selector shows New product only when the caller allows it", () => {
  const selector = read("src/components/invoices/InvoiceProductSelectorModal.tsx");
  assert.match(selector, /canCreateProduct = false,/);
  assert.match(selector, /\{canCreateProduct \? \(\s*<div/);
  assert.match(selector, /setCreateQuery\(filteredProducts\.length === 0 \? query\.trim\(\) : ""\)/);
  // The quick-create owns Escape and Enter while it is open.
  assert.match(selector, /if \(createOpen\) return;/);
});

test("the button opens the shared product quick-create, not a second product form", () => {
  const button = read("src/components/invoices/InvoiceNewProductButton.tsx");
  assert.match(button, /<QuickCreateDialog\s+entity="product"/);
  assert.match(button, /canQuickCreate\("product"/);
  assert.doesNotMatch(button, /ProductForm|QuickAddProductModal/);
});

// ── Texts ───────────────────────────────────────────────────────────────────

test("the INV-1 texts exist in az, en and ru, without a + next to the Plus icon", () => {
  for (const messages of [azMessages, enMessages, ruMessages]) {
    const texts = messages.invoiceTools;
    for (const key of ["newProduct", "newProductNamed", "newProductHint"]) {
      assert.equal(typeof texts[key], "string", key);
      assert.ok(texts[key].trim().length > 0, key);
      assert.ok(!texts[key].startsWith("+"), key);
    }
    assert.match(texts.newProductNamed, /\{name\}/);
  }
  assert.doesNotMatch(Object.values(azMessages.invoiceTools).join(" "), /[Ѐ-ӿ]/);
});
