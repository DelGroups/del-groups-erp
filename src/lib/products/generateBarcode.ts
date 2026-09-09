/** Internal-use EAN-13 prefix (restricted circulation). */
const EAN_PREFIX = "200";

export function ean13CheckDigit(digits12: string): string {
  const body = digits12.replace(/\D/g, "").slice(0, 12).padStart(12, "0");
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const n = Number(body[i]);
    sum += i % 2 === 0 ? n : n * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function generateEan13(seed?: string): string {
  const numeric = (seed || `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`).replace(/\D/g, "");
  const body = (EAN_PREFIX + numeric.padStart(9, "0").slice(-9)).slice(0, 12);
  return body + ean13CheckDigit(body);
}

export function generateShortBarcode(prefix: string): string {
  const raw = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return `${prefix}${raw.slice(0, 11)}`;
}

export function generateProductBarcode(): string {
  return generateEan13();
}

export function generatePieceBarcode(): string {
  return generateShortBarcode("PW");
}

export function barcodeOrQr(value: string | null | undefined, fallback?: string | null): string {
  return (value || fallback || "").trim();
}
