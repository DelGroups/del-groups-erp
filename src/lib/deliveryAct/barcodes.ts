/**
 * Barcodes on the delivery act: each product's barcode drawn as a scannable image (EAN-13 when the value
 * is a valid 13-digit EAN, otherwise Code 128), with its number underneath, the same way the product
 * card draws it (JsBarcode). Drawn in the browser on a canvas as PNG, so the printed page and the Word
 * file carry the same picture; nothing goes over the network. A value the library cannot draw stays as
 * plain text.
 */

/** One drawn barcode: PNG bytes as base64 (no data: prefix) and its size in pixels. */
export interface ActBarcode {
  png: string;
  width: number;
  height: number;
}

export type ActBarcodes = Readonly<Record<string, ActBarcode>>;

/** EAN-13 only when the 13th digit is the right check digit; anything else is Code 128. */
export function barcodeFormat(value: string): "EAN13" | "CODE128" {
  if (!/^\d{13}$/.test(value)) return "CODE128";
  const digits = value.split("").map(Number);
  const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === digits[12] ? "EAN13" : "CODE128";
}

/** Drawn at twice the printed size, so the bars stay sharp on paper. */
export const BARCODE_OPTIONS = { width: 2, height: 56, fontSize: 20, margin: 4, textMargin: 2, background: "#ffffff", lineColor: "#000000", displayValue: true } as const;
/** How wide the barcode is printed, in CSS pixels (the cell keeps rows compact). */
export const PRINT_WIDTH_PX = 132;

export async function drawBarcodes(values: readonly string[]): Promise<ActBarcodes> {
  if (typeof document === "undefined") return {};
  const { default: JsBarcode } = await import("jsbarcode");
  const out: Record<string, ActBarcode> = {};
  for (const value of new Set(values.map((v) => v.trim()).filter(Boolean))) {
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, value, { ...BARCODE_OPTIONS, format: barcodeFormat(value) });
      const url = canvas.toDataURL("image/png");
      const png = url.slice(url.indexOf(",") + 1);
      if (png) out[value] = { png, width: canvas.width, height: canvas.height };
    } catch {
      // Not drawable in either format: the number stays as text.
    }
  }
  return out;
}
