#!/usr/bin/env node
/**
 * Wraps client `page.tsx` files with a server page that exports `dynamic = 'force-dynamic'`.
 * Run once: node scripts/wrap-dynamic-pages.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app");

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "page.tsx") wrapPage(full);
  }
}

function wrapPage(pagePath) {
  const clientPath = path.join(path.dirname(pagePath), "page.client.tsx");
  if (fs.existsSync(clientPath)) return;

  const content = fs.readFileSync(pagePath, "utf8");
  const trimmed = content.trimStart().replace(/^\uFEFF/, "");
  const isClient =
    trimmed.startsWith('"use client"') || trimmed.startsWith("'use client'");
  if (!isClient) return;

  fs.writeFileSync(clientPath, content, "utf8");
  fs.writeFileSync(
    pagePath,
    `export const dynamic = "force-dynamic";

import Page from "./page.client";

export default Page;
`,
    "utf8"
  );
  console.log(`Wrapped ${path.relative(APP_DIR, pagePath)}`);
}

walk(APP_DIR);
console.log("Done.");
