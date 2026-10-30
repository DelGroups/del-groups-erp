// Prints how scripts/ui-guard-allowlist.json compares with src/ today. With --write it lowers
// the counts to what is left (after replacing native controls); it never adds files or raises a
// count, so the allowlist can only shrink (new code must use the standard components instead).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { scanSources } from "./ui-guard-rules.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWLIST = join(ROOT, "scripts", "ui-guard-allowlist.json");

export function sourceEntries(dir = join(ROOT, "src")) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceEntries(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push([relative(ROOT, path).split("\\").join("/"), readFileSync(path, "utf8")]);
  }
  return out;
}

/** Differences: files over their allowance (or not listed) and entries that can shrink. */
export function compareAllowlist(allowlist, found) {
  const over = [];
  const shrink = [];
  for (const [category, files] of Object.entries(found)) {
    for (const [file, n] of Object.entries(files)) {
      const allowed = allowlist[category]?.[file] ?? 0;
      if (n > allowed) over.push({ category, file, found: n, allowed });
    }
  }
  for (const [category, files] of Object.entries(allowlist)) {
    for (const [file, allowed] of Object.entries(files)) {
      const n = found[category]?.[file] ?? 0;
      if (n < allowed) shrink.push({ category, file, found: n, allowed });
    }
  }
  return { over, shrink };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST, "utf8"));
  const found = scanSources(sourceEntries());
  const { over, shrink } = compareAllowlist(allowlist, found);
  for (const o of over) console.log(`over   ${o.category} ${o.file}: ${o.found} (allowed ${o.allowed}) → use the standard component`);
  for (const s of shrink) console.log(`shrink ${s.category} ${s.file}: ${s.found} (allowed ${s.allowed})`);
  if (process.argv.includes("--write") && shrink.length) {
    for (const s of shrink) {
      if (s.found) allowlist[s.category][s.file] = s.found;
      else delete allowlist[s.category][s.file];
    }
    writeFileSync(ALLOWLIST, JSON.stringify(allowlist, null, 2) + "\n");
    console.log("allowlist lowered");
  }
  if (!over.length && !shrink.length) console.log("allowlist matches src/");
  process.exitCode = over.length ? 1 : 0;
}
