/**
 * Generates PNG PWA icons for install prompts and home-screen tiles.
 *
 * Priority:
 * 1. public/icons/logo-source.png  (recommended)
 * 2. public/icons/Logo.svg
 * 3. public/icons/icon.svg
 *
 * Also writes iOS defaults:
 * - public/apple-touch-icon.png
 * - public/apple-touch-icon-precomposed.png
 *
 * Run: npm run pwa:icons
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "public", "icons");
const publicDir = path.join(root, "public");

const SOURCE_CANDIDATES = [
  path.join(outDir, "logo-source.png"),
  path.join(outDir, "Logo.svg"),
  path.join(outDir, "icon.svg"),
];

function resolveSource() {
  for (const candidate of SOURCE_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("No icon source found in public/icons/");
}

async function writeAppleTouchCopies(sourcePath) {
  const { default: sharp } = await import("sharp");
  const sizes = [180, 192];

  for (const size of sizes) {
    const buffer = await sharp(sourcePath).resize(size, size, { fit: "cover" }).png().toBuffer();
    const rootIcon = path.join(publicDir, size === 180 ? "apple-touch-icon.png" : "apple-touch-icon-192.png");
    fs.writeFileSync(rootIcon, buffer);
    console.log("Wrote", path.relative(root, rootIcon));
  }

  const precomposed = path.join(publicDir, "apple-touch-icon-precomposed.png");
  fs.copyFileSync(path.join(publicDir, "apple-touch-icon.png"), precomposed);
  console.log("Wrote", path.relative(root, precomposed));
}

async function main() {
  const { default: sharp } = await import("sharp");
  const sourcePath = resolveSource();
  const isRaster =
    sourcePath.endsWith(".png") || sourcePath.endsWith(".jpg") || sourcePath.endsWith(".webp");
  const input = isRaster ? sourcePath : fs.readFileSync(sourcePath);

  console.log("Using icon source:", path.basename(sourcePath));

  const sizes = [
    ["icon-192x192.png", 192, false],
    ["icon-512x512.png", 512, false],
    ["icon-maskable-512x512.png", 512, true],
    ["apple-touch-icon.png", 180, false],
  ];

  for (const [name, size, maskable] of sizes) {
    if (name === "apple-touch-icon.png" && isRaster) {
      await sharp(sourcePath).resize(size, size, { fit: "cover" }).png().toFile(path.join(outDir, name));
      console.log("Wrote", name);
      continue;
    }

    const padding = maskable ? Math.round(size * 0.12) : Math.round(size * 0.06);
    const inner = size - padding * 2;

    await sharp(input)
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .png()
      .toFile(path.join(outDir, name));

    console.log("Wrote", name);
  }

  if (isRaster) {
    await writeAppleTouchCopies(sourcePath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
