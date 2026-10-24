// Documents (phase 23): the folder tree, labels, storage paths, preview kinds, search and tags,
// record links, the request form's checks, the module's registration, the migration's access
// rules, the storage limit, and the az/en/ru texts. The RLS behaviour itself is checked in
// supabase/tests/documents.sql.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allTags,
  buildTree,
  checkFolderName,
  checkRequest,
  documentPath,
  fileBadge,
  fileSize,
  filterDocuments,
  folderLabel,
  folderPath,
  isLinkModel,
  LINK_MODELS,
  parseTags,
  previewKind,
  subtreeIds,
  SYSTEM_FOLDERS,
  visibleFolders,
  withTag,
} from "../src/modules/documents/lib/documents.ts";
import { MODULES } from "../src/modules/registry.ts";
import { SHELL_EXTRA_ITEMS } from "../src/lib/shell/shell.ts";
import { CHATTER_MODELS } from "../src/views/chatter/logic.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const MIGRATION = "supabase/migrations/20261024120000_documents.sql";

const F = (id, parent_id, name, extra = {}) => ({ id, parent_id, name, system_code: null, sequence: 100, created_by: "u", ...extra });
const FOLDERS = [
  F("sys", null, null, { system_code: "contracts", sequence: 910 }),
  F("b", null, "Banking"),
  F("a", null, "Accounts"),
  F("a1", "a", "2026"),
  F("a2", "a1", "Q1"),
  F("orphan", "hidden", "Shared with me"),
];

test("folder tree: user folders by name, system folders last, hidden parents lift children to the top", () => {
  const tree = buildTree(FOLDERS);
  assert.deepEqual(tree.map((n) => n.id), ["a", "b", "orphan", "sys"]);
  assert.deepEqual(tree[0].children.map((n) => [n.id, n.depth]), [["a1", 1]]);
  assert.deepEqual(visibleFolders(tree, new Set()).map((n) => n.id), ["a", "b", "orphan", "sys"]);
  assert.deepEqual(visibleFolders(tree, new Set(["a", "a1"])).map((n) => n.id), ["a", "a1", "a2", "b", "orphan", "sys"]);
  assert.deepEqual([...subtreeIds(FOLDERS, "a")].sort(), ["a", "a1", "a2"]);
  assert.deepEqual(folderPath(FOLDERS, "a2").map((f) => f.id), ["a", "a1", "a2"]);
  // A cycle in the data does not loop.
  assert.equal(buildTree([F("x", "y", "X"), F("y", "x", "Y")]).length, 0);
});

test("labels and folder names", () => {
  const t = (k) => `T(${k})`;
  assert.equal(folderLabel(FOLDERS[0], t), "T(library.system.contracts)");
  assert.equal(folderLabel(FOLDERS[1], t), "Banking");
  assert.deepEqual(checkFolderName("  Contracts 2026 "), { ok: true, name: "Contracts 2026" });
  assert.equal(checkFolderName(" ").ok, false);
  assert.equal(checkFolderName("x".repeat(121)).ok, false);
  const sql = read(MIGRATION);
  for (const code of SYSTEM_FOLDERS) assert.match(sql, new RegExp(`\\('${code}', 9\\d0\\)`), code);
});

test("files: storage paths under the folder, preview kinds, badges and sizes", () => {
  assert.equal(documentPath("f1", "Müqavilə (son).PDF", "u"), "f1/u-Muqavil-son.pdf");
  assert.equal(documentPath("f1", "../../etc/passwd", "u"), "f1/u-passwd");
  assert.equal(documentPath("f1", ".env", "u"), "f1/u-env");
  assert.equal(previewKind("image/png", "a.png"), "image");
  assert.equal(previewKind(null, "photo.JPG"), "image");
  assert.equal(previewKind("image/svg+xml", "logo.svg"), "none");
  assert.equal(previewKind("application/pdf", "x"), "pdf");
  assert.equal(previewKind(null, "report.pdf"), "pdf");
  assert.equal(previewKind("application/zip", "a.zip"), "none");
  assert.equal(fileBadge("Budget.xlsx"), "XLSX");
  assert.equal(fileBadge("README"), "FILE");
  assert.equal(fileSize(2.5 * 1024 * 1024), "2.5 MB");
});

test("search, tag filter, tags and bulk tagging", () => {
  const docs = [
    { name: "Invoice 12.pdf", tags: ["finance", "2026"] },
    { name: "Photo.png", tags: ["site"] },
    { name: "Contract.pdf", tags: [] },
  ];
  assert.deepEqual(filterDocuments(docs, "invoice", null).map((d) => d.name), ["Invoice 12.pdf"]);
  assert.deepEqual(filterDocuments(docs, "SITE", null).map((d) => d.name), ["Photo.png"]);
  assert.deepEqual(filterDocuments(docs, "", "2026").map((d) => d.name), ["Invoice 12.pdf"]);
  assert.deepEqual(allTags(docs), ["2026", "finance", "site"]);
  assert.deepEqual(parseTags(" #a, b , A,,"), ["a", "b"]);
  assert.deepEqual(withTag(["a"], "A"), ["a"]);
  assert.deepEqual(withTag(["a"], "b"), ["a", "b"]);
});

test("record links use known tables and chatter models; requests need a title and a person", () => {
  for (const model of Object.keys(LINK_MODELS)) assert.ok(CHATTER_MODELS.includes(model), model);
  assert.equal(isLinkModel("deals"), true);
  assert.equal(isLinkModel("profiles"), false);
  const base = { title: " Signed delivery note ", note: "", due_date: "", requested_user_id: "u1", partner: null };
  assert.deepEqual(checkRequest(base), { ok: true, value: { title: "Signed delivery note", note: null, due_date: null, requested_user_id: "u1", partner_model: null, partner_id: null, partner_name: null } });
  assert.equal(checkRequest({ ...base, title: " " }).error, "library.errors.requestTitle");
  assert.equal(checkRequest({ ...base, requested_user_id: "" }).error, "library.errors.requestWho");
  assert.equal(checkRequest({ ...base, due_date: "1.1.2026" }).error, "library.errors.dueDate");
  const partner = checkRequest({ ...base, requested_user_id: "", partner: { partner_model: "customers", partner_id: "c1", partner_name: "Acme" } });
  assert.equal(partner.value.partner_id, "c1");
});

test("the documents module is registered and new UI only; system folders check each module's permission", () => {
  const m = MODULES.find((x) => x.id === "documents");
  assert.deepEqual([m.depends, m.menus, m.routes], [["core"], [], [{ prefix: "/documents", permission: "can_view_dashboard" }]]);
  assert.ok(SHELL_EXTRA_ITEMS.some((i) => i.path === "/documents" && i.module === "documents"));
  assert.match(read("src/app/documents/page.tsx"), /if \(!isNewUiEnabled\(\)\) notFound\(\);/);
  const action = read("src/modules/documents/actions/systemFolders.ts");
  assert.match(action, /expenses: \{ module: "expenses", permissions: \["can_view_expenses", "can_manage_expenses"\] \}/);
  assert.match(action, /contracts: \{ module: "contracts", permissions: \["can_view_sales"\] \}/);
  assert.match(action, /products: \{ module: "core", permissions: \["can_view_products"\] \}/);
  assert.match(action, /if \(!rule\.permissions\.some\(\(p\) => userHasPermission\(profile, p\)\)\) throw new ActionAuthError/);
  assert.match(read("control-panel/supabase/migrations/20261024120000_documents_module.sql"), /\('documents', 'Documents', '\{core\}', false\)/);
});

test("one migration; RLS on every table; folder rules; private bucket; storage limit applies", () => {
  assert.equal(readdirSync(join(root, "supabase/migrations")).filter((f) => f.startsWith("20261024120000")).length, 1);
  const sql = read(MIGRATION);
  for (const table of ["document_folders", "document_folder_access", "documents", "document_requests"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`), table);
  }
  assert.match(sql, /create policy documents_select on public\.documents\s+for select to authenticated\s+using \(public\.document_folder_allowed\(folder_id, false\)\)/);
  assert.match(sql, /and split_part\(storage_path, '\/', 1\) = folder_id::text/);
  assert.match(sql, /values \('documents', 'documents', false, 52428800\)/);
  // System folders are read-only for everyone, checked before the admin shortcut.
  assert.ok(sql.indexOf("return not p_write;") < sql.search(/if public\.is_admin\(\) then\s+return true;/));
  // Policies call auth.uid() once per statement.
  assert.doesNotMatch(sql.slice(sql.indexOf("-- ── Row level security")), /(?<!select )auth\.uid\(\)/);
  // The plan's storage limit counts every bucket and blocks uploads at 100 % (prompt 12).
  const limits = read("supabase/migrations/20261014100000_tenant_limits.sql");
  assert.match(limits, /sum\(\(o\.metadata ->> 'size'\)::bigint\), 0\)::bigint from storage\.objects o;/);
  assert.match(limits, /create policy storage_quota_insert on storage\.objects/);
  assert.match(read("src/modules/documents/components/DocumentsScreen.tsx"), /storage === "blocked"/);
  assert.doesNotMatch(sql, /grant [^;]* to anon/);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/documents\.sql/);
  assert.match(read("supabase/scripts/tenant1_preflight.sql"), /20261024120000_documents/);
});

test("every documents text exists in az, en and ru", () => {
  const keys = new Set();
  for (const f of ["src/modules/documents/components/DocumentsScreen.tsx", "src/modules/documents/components/FolderTree.tsx", "src/modules/documents/components/DocumentPanel.tsx", "src/modules/documents/components/RequestsPanel.tsx", "src/modules/documents/lib/documents.ts", "src/app/documents/page.client.tsx"]) {
    for (const m of read(f).matchAll(/["'`](library\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g)) keys.add(m[1]);
  }
  for (const c of SYSTEM_FOLDERS) keys.add(`library.system.${c}`);
  for (const m of ["grid", "list"]) keys.add(`library.layouts.${m}`);
  for (const s of ["pending", "done", "cancelled"]) keys.add(`library.requests.status_${s}`);
  for (const k of ["modules.names.documents", "newShell.extra_documents"]) keys.add(k);
  const get = (messages, key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), messages);
  assert.ok(keys.size > 90, String(keys.size));
  for (const [name, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
    const missing = [...keys].filter((k) => typeof get(messages, k) !== "string");
    assert.deepEqual(missing, [], `${name} misses ${missing.join(", ")}`);
  }
});
