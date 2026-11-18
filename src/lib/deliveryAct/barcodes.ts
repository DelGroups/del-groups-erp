/**
 * Barcodes on the delivery act: each product's barcode drawn as a scannable Code 128 image with its
 * number underneath, the way the product card and labels draw it (JsBarcode). Drawn in the browser on a canvas as PNG, so the printed page and the Word
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

/**
 * Code 128 for every barcode (Del, 18.11): one plain, standard look on every row, read by every scanner,
 * and the default of the product labels. EAN-13 is not used: many codes have 12 digits, and mixing types
 * gave rows different looks.
 */
export function barcodeFormat(_value: string): "CODE128" {
  void _value;
  return "CODE128";
}

/** Drawn at twice the printed size, so the bars stay sharp on paper. */
export const BARCODE_OPTIONS = { width: 2, height: 56, fontSize: 20, margin: 10, textMargin: 2, background: "#ffffff", lineColor: "#000000", displayValue: true } as const;
/**
 * The barcode column on paper (Del, 18.11: narrow): 32 mm wide, the picture 28 mm (with its quiet zone),
 * so a 12-13 digit Code 128 stays scannable and the product name gets the room.
 */
export const BARCODE_COLUMN_MM = 32;
export const BARCODE_PRINT_MM = 28;

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
