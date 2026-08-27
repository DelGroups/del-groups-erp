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
 * Browser tab favicon:
 * - public/favicon.ico
 * - public/favicon-16x16.png
 * - public/favicon-32x32.png
 * - src/app/icon.png (Next.js file-based metadata)
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
const appDir = path.join(root, "src", "app");

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

/** Wrap a PNG buffer in a single-size ICO container (PNG-in-ICO, Vista+). */
function pngToIco(pngBuffer, size = 32) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, pngBuffer]);
}

async function writeFaviconFiles(sharp, sourcePath, isRaster, input) {
  const faviconSizes = [
    ["favicon-16x16.png", 16],
    ["favicon-32x32.png", 32],
  ];

  let favicon32Buffer = null;

  for (const [name, size] of faviconSizes) {
    const buffer = isRaster
      ? await sharp(sourcePath).resize(size, size, { fit: "cover" }).png().toBuffer()
      : await sharp(input)
          .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
          .png()
          .toBuffer();

    if (size === 32) favicon32Buffer = buffer;

    const outPath = path.join(publicDir, name);
    fs.writeFileSync(outPath, buffer);
    console.log("Wrote", path.relative(root, outPath));
  }

  if (favicon32Buffer) {
    const icoPath = path.join(publicDir, "favicon.ico");
    fs.writeFileSync(icoPath, pngToIco(favicon32Buffer, 32));
    console.log("Wrote", path.relative(root, icoPath));
  }

  const appIconPath = path.join(appDir, "icon.png");
  const appIconBuffer = isRaster
    ? await sharp(sourcePath).resize(32, 32, { fit: "cover" }).png().toBuffer()
    : await sharp(input)
        .resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
        .png()
        .toBuffer();

  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(appIconPath, appIconBuffer);
  console.log("Wrote", path.relative(root, appIconPath));
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

  await writeFaviconFiles(sharp, sourcePath, isRaster, input);

  if (isRaster) {
    await writeAppleTouchCopies(sourcePath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
