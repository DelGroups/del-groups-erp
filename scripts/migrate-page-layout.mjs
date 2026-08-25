import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const appDir = path.join(__dirname, "..", "src", "app");

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name === "page.tsx") files.push(full);
  }
  return files;
}

const openPatterns = [
  /<div className="flex h-screen overflow-hidden bg-slate-100">\s*<Sidebar\s\/>\s*<div className="flex flex-1 flex-col overflow-y-auto">/g,
  /<div className="flex h-screen overflow-hidden bg-slate-100">\s*<Sidebar\s\/>\s*<div className="flex flex-1 flex-col overflow-hidden">/g,
  /<div className="flex h-screen bg-slate-100 overflow-hidden">\s*<Sidebar\s\/>\s*<div className="flex flex-1 flex-col overflow-y-auto">/g,
  /<div className="flex h-screen bg-slate-100 overflow-hidden">\s*<Sidebar\s\/>\s*<div className="flex flex-1 flex-col overflow-hidden">/g,
  /<div className="flex h-screen bg-slate-100 overflow-hidden">\s*\n\s*<Sidebar\s\/>\s*\n\s*<div className="flex flex-1 flex-col overflow-y-auto">/g,
  /<div className="flex h-screen bg-slate-100 overflow-hidden">\s*\n\s*<Sidebar\s\/>\s*\n\s*<div className="flex flex-1 flex-col overflow-hidden">/g,
];

for (const file of walk(appDir)) {
  let content = fs.readFileSync(file, "utf8");
  if (!content.includes("@/components/Sidebar")) continue;

  const original = content;

  content = content.replace(
    /import Sidebar from "@\/components\/Sidebar";\n?/,
    'import PageLayout from "@/components/layout/PageLayout";\n'
  );

  let replaced = false;
  for (const pattern of openPatterns) {
    if (pattern.test(content)) {
      content = content.replace(pattern, "<PageLayout>");
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    console.warn("SKIP (no open pattern):", path.relative(process.cwd(), file));
    continue;
  }

  // Remove the inner wrapper closing tag (first standalone </div> before modals or end)
  // Heuristic: after PageLayout, the next block often ends with </div> closing the old inner flex col.
  // Replace the last two consecutive closing divs before `);` with one PageLayout close.
  content = content.replace(/\n(\s*)<\/div>\s*\n(\s*)<\/div>\s*\n(\s*)\);(\s*\n\s*\})/, "\n$1</PageLayout>\n$3);$4");

  if (content === original) {
    console.warn("NO CHANGE:", path.relative(process.cwd(), file));
    continue;
  }

  fs.writeFileSync(file, content);
  console.log("UPDATED:", path.relative(process.cwd(), file));
}
