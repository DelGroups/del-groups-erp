import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "src");

const REPLACEMENTS = [
  // Modals
  [
    "flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl",
    "app-modal flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden",
  ],
  [
    "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl",
    "app-modal max-h-[90vh] w-full max-w-lg overflow-y-auto",
  ],
  [
    "flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl",
    "app-modal flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden",
  ],
  [
    "my-6 w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl",
    "app-modal my-6 w-full max-w-2xl overflow-hidden",
  ],
  [
    "my-10 w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm",
    "app-modal my-10 w-full max-w-md space-y-4 p-6",
  ],
  [
    "w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl",
    "app-modal w-full max-w-md",
  ],
  [
    "w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl",
    "app-modal w-full max-w-md overflow-hidden",
  ],
  // Cards & panels
  [
    "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm",
    "app-table-wrap",
  ],
  [
    "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm",
    "app-table-wrap",
  ],
  [
    "rounded-2xl border border-slate-200 bg-white p-12 text-center text-xs text-app-muted",
    "app-card app-card-elevated p-12 text-center text-xs text-app-muted",
  ],
  [
    "rounded-2xl border border-slate-200 bg-white p-12 text-center",
    "app-card app-card-elevated p-12 text-center",
  ],
  [
    "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm",
    "app-card app-card-elevated p-5",
  ],
  [
    "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm",
    "app-card app-card-elevated p-4",
  ],
  [
    "rounded-2xl border border-slate-200 bg-white shadow-sm",
    "app-card app-card-elevated",
  ],
  [
    "rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-app-muted",
    "app-card p-12 text-center text-sm text-app-muted",
  ],
  [
    "rounded-xl border border-slate-200 bg-white p-6 shadow-sm",
    "app-card app-card-elevated p-6",
  ],
  [
    "rounded-xl border border-slate-200 bg-white p-5 shadow-sm",
    "app-card app-card-elevated p-5",
  ],
  [
    "rounded-xl border border-slate-200 bg-white p-4 shadow-sm",
    "app-card app-card-elevated p-4",
  ],
  [
    "rounded-xl border border-slate-200 bg-white shadow-sm",
    "app-card app-card-elevated",
  ],
  [
    "bg-white p-5 rounded-xl border border-slate-200 shadow-sm",
    "app-card app-card-elevated p-5",
  ],
  [
    "space-y-2 rounded-2xl border border-slate-200 bg-white p-4",
    "app-card space-y-2 p-4",
  ],
  [
    "space-y-4 rounded-2xl border border-slate-200 bg-white p-5",
    "app-card space-y-4 p-5",
  ],
  [
    "space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm",
    "app-card app-card-elevated space-y-5 p-6",
  ],
  // Form sections
  [
    "flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3",
    "app-card flex items-center justify-between px-4 py-3",
  ],
  [
    "grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-4",
    "app-card grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-4",
  ],
  [
    "grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2",
    "app-card grid grid-cols-1 gap-4 p-4 md:grid-cols-2",
  ],
  [
    "space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-xs",
    "app-card space-y-2 p-4 text-xs",
  ],
  [
    "block rounded-xl border border-slate-200 bg-white p-4 text-xs font-semibold text-app",
    "app-card block p-4 text-xs font-semibold text-app",
  ],
  [
    "block rounded-xl border border-slate-200 bg-white p-4 text-xs font-semibold text-app shadow-sm",
    "app-card block p-4 text-xs font-semibold text-app",
  ],
  [
    "overflow-visible rounded-xl border border-slate-200 bg-white",
    "app-table-wrap overflow-visible",
  ],
  // Inputs
  [
    "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs",
    "app-input mt-1 text-xs",
  ],
  [
    "mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm",
    "app-input mt-1 text-sm",
  ],
  [
    "w-full rounded-lg border bg-white px-3 py-2 text-sm",
    "app-input text-sm",
  ],
  [
    "rounded-lg border bg-white px-3 py-2 text-sm",
    "app-input text-sm",
  ],
  [
    "rounded-lg border bg-white px-3 py-2 text-xs",
    "app-input text-xs",
  ],
  [
    "bg-white px-3 py-2 text-sm",
    "app-input text-sm",
  ],
  [
    "rounded border bg-white px-2 py-1 text-app-muted",
    "app-input px-2 py-1 text-app-muted",
  ],
  [
    "mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm",
    "app-input mt-1 text-sm",
  ],
  // Dropdowns & combobox
  [
    "absolute left-0 top-full z-[9999] mt-1 max-h-56 w-[min(420px,70vw)] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg",
    "app-dropdown-panel absolute left-0 top-full z-[9999] mt-1 max-h-56 w-[min(420px,70vw)] overflow-y-auto py-1",
  ],
  ['active ? "bg-blue-50" : "bg-white"', 'active ? "app-dropdown-item-active" : "bg-app-card"'],
  [
    "absolute right-0 z-30 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg",
    "app-dropdown-panel absolute right-0 z-30 mt-2 w-64 p-3",
  ],
  [
    "flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-app hover:bg-slate-50",
    "btn-ghost text-xs",
  ],
  // Table headers
  [
    "sticky top-0 bg-white font-bold uppercase text-slate-500",
    "sticky top-0 bg-app-card font-bold uppercase text-app-muted",
  ],
  [
    "sticky top-0 bg-white font-bold uppercase text-app-muted",
    "sticky top-0 bg-app-card font-bold uppercase text-app-muted",
  ],
  // Gray/slate remnants
  ["hover:bg-slate-50", "hover:bg-app-card-hover"],
  ["hover:bg-slate-100", "hover:bg-app-card-hover"],
  ["bg-gray-100", "bg-app-card-hover"],
  ["border-gray-200", "border-app"],
  ["text-black", "text-app"],
  ["border-slate-300", "border-app"],
  ["border-slate-200", "border-app"],
  // Barcode field
  [
    "w-full rounded-xl border-2 border-amber-300 bg-white px-4 py-3 font-mono text-sm text-app shadow-sm outline-none ring-amber-200 focus:border-amber-500 focus:ring-2 disabled:opacity-60",
    "app-input w-full border-2 border-amber-500/40 px-4 py-3 font-mono text-sm shadow-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30 disabled:opacity-60",
  ],
  // Auth pages
  [
    "w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm",
    "app-card app-card-elevated w-full max-w-sm space-y-4 p-7",
  ],
  ["bg-slate-100 p-4", "bg-app p-4"],
  ["min-h-screen items-center justify-center bg-slate-100", "min-h-screen items-center justify-center bg-app"],
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, files);
    } else if (
      /\.(tsx|ts|jsx|js)$/.test(entry.name) &&
      !/PrintTemplate|BarcodePrintTemplate/.test(full)
    ) {
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
