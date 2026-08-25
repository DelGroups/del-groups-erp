#!/usr/bin/env node
/**
 * Creates source.zip for Hostinger Web Apps (Next.js) deployment.
 * Files are placed at the zip root (no parent wrapper folder).
 *
 * Excludes: node_modules, .next, .git, .env.local (and .env.*.local), source.zip
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_ZIP = path.join(ROOT, "source.zip");

const EXCLUDE_DIRS = new Set(["node_modules", ".next", ".git"]);
const EXCLUDE_FILES = new Set(["source.zip"]);

function isExcludedEnvLocal(name) {
  return name === ".env.local" || /^\.env\..+\.local$/.test(name);
}

function shouldExclude(name, isDirectory) {
  if (isDirectory && EXCLUDE_DIRS.has(name)) return true;
  if (EXCLUDE_FILES.has(name)) return true;
  if (isExcludedEnvLocal(name)) return true;
  return false;
}

function copyProject(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (shouldExclude(entry.name, entry.isDirectory())) continue;

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyProject(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function main() {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "del-groups-erp-zip-"));

  console.log("Packaging project for Hostinger Web Apps...");
  console.log(`  Root:    ${ROOT}`);
  console.log(`  Output:  ${OUTPUT_ZIP}`);
  console.log("  Excluded: node_modules, .next, .git, .env.local, .env.*.local");

  try {
    copyProject(ROOT, stagingDir);

    if (fs.existsSync(OUTPUT_ZIP)) {
      fs.unlinkSync(OUTPUT_ZIP);
    }

    // tar -a creates a zip archive; -C ensures files sit at zip root (no wrapper folder)
    execSync(`tar -a -c -f "${OUTPUT_ZIP}" -C "${stagingDir}" .`, {
      stdio: "inherit",
      shell: true,
    });

    const { size } = fs.statSync(OUTPUT_ZIP);
    console.log(`\nDone: source.zip (${formatBytes(size)})`);
    console.log("Upload this file to Hostinger Web Apps.");
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

main();
