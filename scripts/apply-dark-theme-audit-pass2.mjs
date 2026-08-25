import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "src");

const REPLACEMENTS = [
  ["bg-slate-50", "bg-app-card-hover"],
  ["text-slate-500", "text-app-muted"],
  ["hover:bg-blue-50", "hover:bg-[color:var(--app-accent-soft)]"],
  ["bg-blue-50", "bg-[color:var(--app-accent-soft)]"],
  ["border-blue-200", "border-[color:var(--app-accent-ring)]"],
  ["border-slate-100", "border-app"],
  ["disabled:bg-slate-100 disabled:text-slate-500", "disabled:opacity-50"],
  ["disabled:bg-slate-50", "disabled:opacity-50"],
  ["bg-slate-100 text-slate-500", "bg-app-card-hover text-app-muted"],
  ["bg-slate-100", "bg-app-card-hover"],
  ["border border-app bg-white", "app-card"],
  ["rounded-2xl border border-app bg-white", "app-card app-card-elevated"],
  ["bg-white p-3 rounded-xl border border-app", "app-card p-3"],
  ["hover:bg-white", "hover:bg-app-card-hover"],
  ["bg-white px-2 py-1.5", "app-input px-2 py-1.5"],
  ["focus:ring-blue-500", "focus:ring-[color:var(--app-accent-ring)]"],
  ["focus:ring-2 focus:ring-blue-500", "focus:ring-2 ring-app-accent"],
  ["text-blue-600 hover:bg-[color:var(--app-accent-soft)]", "text-app-accent hover:bg-[color:var(--app-accent-soft)]"],
  ["text-blue-600", "text-app-accent"],
  ["text-blue-700", "text-app-accent"],
  ["? \"border-blue-400 bg-[color:var(--app-accent-soft)] text-blue-700\"", "? \"border-[color:var(--app-accent)] bg-[color:var(--app-accent-soft)] text-app-accent\""],
  ["hover:text-blue-600", "hover:text-app-accent"],
  ["hover:border-blue-300", "hover:border-[color:var(--app-border-hover)]"],
  ["group rounded-2xl border border-app bg-white p-6", "group app-card app-card-elevated p-6"],
  ["w-full max-w-lg overflow-hidden rounded-2xl border border-app bg-white shadow-xl", "app-modal w-full max-w-lg overflow-hidden"],
  ["w-full max-w-sm space-y-4 rounded-2xl border border-app bg-white p-7 shadow-sm", "app-card app-card-elevated w-full max-w-sm space-y-4 p-7"],
  ["w-full max-w-sm space-y-3 rounded-2xl border border-app bg-white p-7 text-center shadow-sm", "app-card app-card-elevated w-full max-w-sm space-y-3 p-7 text-center"],
  ["flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-3 rounded-xl border border-app shadow-sm", "app-card flex flex-col items-center justify-between gap-4 p-3 md:flex-row"],
  ["w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-rose-500 bg-white", "app-input text-sm focus:ring-rose-500/40"],
  ["rounded-xl border border-app bg-white p-3 shadow-sm", "app-card p-3"],
  [": \"border border-app bg-white text-app-muted hover:bg-app-card-hover\"", ": \"border border-app bg-app-card text-app-muted hover:bg-app-card-hover\""],
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, files);
    } else if (/\.(tsx|ts)$/.test(entry.name) && !/PrintTemplate|BarcodePrintTemplate/.test(full)) {
      files.push(full);
    }
  }
  return files;
}

let changedFiles = 0;
for (const file of walk(ROOT)) {
  let content = fs.readFileSync(file, "utf8");
  const original = content;
  for (const [from, to] of REPLACEMENTS) {
    content = content.split(from).join(to);
  }
  if (content !== original) {
    fs.writeFileSync(file, content);
    changedFiles += 1;
    console.log("updated:", path.relative(process.cwd(), file));
  }
}

console.log(`Done. ${changedFiles} file(s) updated.`);
