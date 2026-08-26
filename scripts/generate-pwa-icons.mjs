/**
 * Generates PNG PWA icons from public/icons/icon.svg (requires sharp).
 * Run: node scripts/generate-pwa-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const svgPath = path.join(root, "public", "icons", "icon.svg");
const outDir = path.join(root, "public", "icons");

async function main() {
  const { default: sharp } = await import("sharp");
  const svg = fs.readFileSync(svgPath);

  const sizes = [
    ["icon-192x192.png", 192],
    ["icon-512x512.png", 512],
    ["icon-maskable-512x512.png", 512],
    ["apple-touch-icon.png", 180],
  ];

  for (const [name, size] of sizes) {
    const padding = name.includes("maskable") ? Math.round(size * 0.1) : 0;
    const inner = size - padding * 2;
    await sharp(svg)
      .resize(inner, inner, { fit: "contain", background: { r: 7, g: 11, b: 20, alpha: 1 } })
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: name.includes("maskable")
          ? { r: 7, g: 11, b: 20, alpha: 1 }
          : { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(path.join(outDir, name));
    console.log("Wrote", name);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
