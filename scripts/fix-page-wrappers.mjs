#!/usr/bin/env node
/**
 * Fixes server page.tsx wrappers: wrap client pages in a Server Component function
 * instead of re-exporting the client module as default (Vercel RSC 500 fix).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app");

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "page.tsx") fixPage(full);
  }
}

function fixPage(pagePath) {
  const clientPath = path.join(path.dirname(pagePath), "page.client.tsx");
  if (!fs.existsSync(clientPath)) return;

  const content = fs.readFileSync(pagePath, "utf8");
  if (content.includes("return <PageClient />") || content.includes("return <Page />")) {
    return;
  }

  const wrapped = `import PageClient from "./page.client";

export const dynamic = "force-dynamic";

export default function Page() {
  return <PageClient />;
}
`;

  fs.writeFileSync(pagePath, wrapped, "utf8");
  console.log(`Fixed ${path.relative(APP_DIR, pagePath)}`);
}

walk(APP_DIR);
console.log("Done.");
