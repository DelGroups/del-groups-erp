import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "src");
const SKIP = new Set(["globals.css"]);

const REPLACEMENTS = [
  [
    "bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between",
    "flex items-center justify-between border-b border-app bg-app-surface px-6 py-4 backdrop-blur-md",
  ],
  [
    "bg-white border-b border-slate-200 px-6 py-4",
    "border-b border-app bg-app-surface px-6 py-4 backdrop-blur-md",
  ],
  ["border-b border-slate-200 bg-white px-6 py-4", "border-b border-app bg-app-surface px-6 py-4 backdrop-blur-md"],
  ["flex-1 overflow-y-auto bg-slate-950 p-6", "flex-1 overflow-y-auto bg-app p-6"],
  ["text-xl font-bold text-slate-800", "text-xl font-bold text-app"],
  ["text-sm text-slate-500", "text-sm text-app-muted"],
  ["text-xs text-slate-500", "text-xs text-app-muted"],
  ["text-[11px] text-slate-400", "text-[11px] text-app-muted"],
  ["text-xs text-slate-400", "text-xs text-app-muted"],
  [
    "flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm",
    "app-card app-card-elevated flex flex-col items-center justify-between gap-4 p-4 sm:flex-row",
  ],
  [
    "bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden",
    "app-table-wrap",
  ],
  [
    "bg-white p-6 rounded-2xl border border-slate-200 shadow-sm",
    "app-card app-card-elevated p-6",
  ],
  [
    "bg-white p-6 rounded-xl border border-slate-200 shadow-sm",
    "app-card app-card-elevated p-6",
  ],
  [
    "rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-lg",
    "app-card app-card-elevated p-6",
  ],
  [
    "bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center space-x-2 transition-colors",
    "btn-primary",
  ],
  [
    "bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold",
    "btn-primary",
  ],
  [
    "px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50",
    "btn-primary disabled:opacity-50",
  ],
  [
    "fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4",
    "app-modal-overlay",
  ],
  [
    "bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden",
    "app-modal w-full max-w-md",
  ],
  ['<table className="w-full text-left text-sm text-slate-600">', '<table className="app-table">'],
  [
    "w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500",
    "app-input pl-9",
  ],
  [
    "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500",
    "app-input",
  ],
  ["p-8 text-center text-slate-500 text-sm", "p-8 text-center text-app-muted text-sm"],
  ["p-8 text-center text-slate-500", "p-8 text-center text-app-muted"],
  ["p-12 text-center text-xs text-slate-500", "p-12 text-center text-xs text-app-muted"],
  ['<thead className="bg-slate-50 text-xs text-app-muted uppercase border-b border-slate-200">', "<thead>"],
  ['<thead className="bg-slate-50 text-slate-700 text-xs uppercase border-b border-slate-200">', "<thead>"],
  ['<tbody className="divide-y divide-slate-200">', "<tbody>"],
  ['className="hover:bg-slate-50 transition-colors"', ""],
  ["text-slate-700", "text-app"],
  ["text-slate-900", "text-app"],
  ["text-slate-800", "text-app"],
  ["text-slate-600", "text-app-muted"],
  ["text-slate-400", "text-app-muted"],
  [
    "px-6 py-4 border-b border-slate-200 flex justify-between items-center",
    "app-modal-header flex justify-between items-center",
  ],
  ["block text-xs font-medium text-slate-700 mb-1", "app-label"],
  [
    "px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50",
    "btn-ghost",
  ],
  ["p-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50", "btn-ghost !p-2"],
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, files);
    } else if (
      /\.(tsx|ts|jsx|js)$/.test(entry.name) &&
      !SKIP.has(entry.name) &&
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
