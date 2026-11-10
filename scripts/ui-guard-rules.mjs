// UI standard guard (UI-1, docs/ui-standard.md): the lint rules eslint.config.mjs builds from
// scripts/ui-guard-allowlist.json. Plain data, so tests/uiStandard.test.mjs can use it too.

export const UI_GUARD_RULES = {
  select: {
    message: "UI standard: use Combobox from @/design-system/components, not a native <select> (docs/ui-standard.md).",
    selectors: ['JSXOpeningElement[name.name="select"]'],
    // What tests/uiStandard.test.mjs counts per file for the allowlist (a superset of the selectors).
    pattern: /<select\b/g,
  },
  dateInput: {
    message: "UI standard: use DateField / DateTimeField from @/design-system/components, not <input type=\"date\"> (docs/ui-standard.md).",
    selectors: [
      'JSXOpeningElement[name.name=/^(input|Input)$/] > JSXAttribute[name.name="type"][value.value=/^(date|datetime-local)$/]',
      'JSXOpeningElement[name.name=/^(input|Input)$/] > JSXAttribute[name.name="type"] > JSXExpressionContainer Literal[value=/^(date|datetime-local)$/]',
    ],
    pattern: /type=(?:"(?:date|datetime-local)"|\{[^}]*"(?:date|datetime-local)")/g,
  },
  datalist: {
    message: "UI standard: use Combobox from @/design-system/components, not <datalist> (docs/ui-standard.md).",
    selectors: ['JSXOpeningElement[name.name="datalist"]'],
    pattern: /<datalist\b/g,
  },
  localeFormat: {
    message:
      "UI standard: format dates and numbers with src/lib/dates/localeDate.ts (formatGridDate, formatGridDateTime, formatMoney…), not toLocaleString / toLocaleDateString / Intl.DateTimeFormat.",
    selectors: [
      "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]",
      'NewExpression[callee.object.name="Intl"][callee.property.name="DateTimeFormat"]',
      'CallExpression[callee.object.name="Intl"][callee.property.name="DateTimeFormat"]',
    ],
    pattern: /\.toLocale(?:Date|Time)?String\(|Intl\.DateTimeFormat\b/g,
  },
  // UI-6: every list, report and line table is a DataGrid (StandardGrid / ListGrid / ListView) or a
  // LineGrid. A raw <table> or the old src/components/ui/table.tsx counts once per occurrence.
  rawTable: {
    message:
      "UI standard: render tables with DataGrid (StandardGrid from @/components/lists/StandardGrid) or LineGrid (@/components/line-grid), not a raw <table> or @/components/ui/table (docs/ui-standard.md).",
    selectors: ['JSXOpeningElement[name.name="table"]', 'ImportDeclaration[source.value="@/components/ui/table"]'],
    pattern: /<table\b|from\s+["']@\/components\/ui\/table["']/g,
  },
  // ── UI-7 phase 2: the UI rulebook (docs/ui-standard.md). Files that break a rule today are in
  // the allowlist with their count; it may only shrink, so new code follows the rule. ──
  windowDialog: {
    message: "UI rulebook ACT-5: ask with ConfirmDialog and report with useToast (@/design-system/components), not window.confirm / alert / prompt.",
    selectors: [
      'CallExpression[callee.object.name="window"][callee.property.name=/^(confirm|alert|prompt)$/]',
      'CallExpression[callee.type="Identifier"][callee.name=/^(alert|prompt)$/]',
    ],
    pattern: /\bwindow\.(?:confirm|alert|prompt)\(|(?<![.\w])(?:alert|prompt)\(/g,
  },
  appModal: {
    message: "UI rulebook OVL-1: use Dialog / Drawer / ConfirmDialog from @/design-system/components, not an .app-modal overlay.",
    selectors: ["Literal[value=/(^|\s)app-modal(\s|$)/]", "TemplateElement[value.raw=/(^|\s)app-modal(\s|$)/]"],
    pattern: /(?<![\w-])app-modal(?![\w-])/g,
  },
  fixedOverlay: {
    message: "UI rulebook OVL-1: overlays come from Dialog / Drawer / Popover (Radix, one layer), not a hand-made `fixed inset-0` box.",
    selectors: ["Literal[value=/(^|\s)fixed inset-0(\s|$)/]", "TemplateElement[value.raw=/(^|\s)fixed inset-0(\s|$)/]"],
    pattern: /(?<![\w-])fixed inset-0(?![\w-])/g,
  },
  tinyText: {
    message: "UI rulebook TOK-2: nothing below 12 px; use text-[length:var(--ds-text-xs)] (12 px) or larger.",
    // esquery cannot read "[" in a selector regex: "." stands for the brackets.
    selectors: ["Literal[value=/text-.(9|10|11)px./]", "TemplateElement[value.raw=/text-.(9|10|11)px./]"],
    pattern: /text-\[(?:9|10|11)px\]/g,
  },
  uppercase: {
    message: "UI rulebook TXT-1: sentence case; no `uppercase` class (it also makes labels wider than their column).",
    selectors: ["Literal[value=/(^|\s)uppercase(\s|$)/]", "TemplateElement[value.raw=/(^|\s)uppercase(\s|$)/]"],
    pattern: /(?<=^|[\s"'`])uppercase(?=[\s"'`]|$)/gm,
  },
  legacyButton: {
    message: "UI rulebook ACT-1: use Button / buttonClass from @/design-system/components; no btn-primary, gradient or app-gradient buttons.",
    selectors: [
      "Literal[value=/(^|\s)(btn-primary|app-gradient|bg-gradient-to-[a-z]+)(\s|$)/]",
      "TemplateElement[value.raw=/(^|\s)(btn-primary|app-gradient|bg-gradient-to-[a-z]+)(\s|$)/]",
    ],
    pattern: /(?<![\w-])(?:btn-primary|app-gradient|bg-gradient-to-[a-z]+)(?![\w-])/g,
  },
  rawPalette: {
    message: "UI rulebook TOK-1: colours come from tokens by meaning (var(--ds-danger), ds-muted …), not Tailwind palette classes such as text-rose-500.",
    selectors: [
      "Literal[value=/(^|[\s:])(text|bg|border|ring|fill|stroke|from|via|to)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}/]",
      "TemplateElement[value.raw=/(^|[\s:])(text|bg|border|ring|fill|stroke|from|via|to)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}/]",
    ],
    pattern: /(?<=^|[\s"'`:])(?:text|bg|border|ring|fill|stroke|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/gm,
  },
  toastMessage: {
    message: "UI rulebook OVL-3: report with useToast from @/design-system/components, not the old ToastMessage.",
    selectors: ["ImportDeclaration[source.value=/ToastMessage$/]"],
    pattern: /from\s+["'][^"']*ToastMessage["']/g,
  },
  rawH1: {
    message: "UI rulebook PAGE-1: the page title is PageHeader's <h1> (@/design-system/components); no other <h1>.",
    selectors: ['JSXOpeningElement[name.name="h1"]'],
    pattern: /<h1\b/g,
  },
  rawTabRole: {
    message: "UI rulebook NAV-5: in-page tabs are Tabs / SegmentedControl from @/design-system/components, not a hand-made role=\"tab\".",
    selectors: ['JSXAttribute[name.name="role"][value.value="tab"]'],
    pattern: /role=["']tab["']/g,
  },
};

/** Files a rule never applies to: the formatting module, the Escape bridge of the old dialogs. */
export const UI_GUARD_EXEMPT = {
  localeFormat: ["src/lib/dates/localeDate.ts"],
  // The Escape bridge for the old dialogs names their class to find them (it goes away with them).
  appModal: ["src/lib/ui/legacyModal.ts", "src/components/ui/LegacyModalEscape.tsx"],
};

/**
 * Folders and file names a rule never applies to: the grid components themselves and print
 * layouts (a printed document is a real table on paper). Globs for lint, matched by
 * globToRegExp for the allowlist counts.
 */
export const UI_GUARD_EXEMPT_GLOBS = {
  // The design system builds the standard parts these rules point to.
  rawTabRole: ["src/design-system/**"],
  fixedOverlay: ["src/design-system/**"],
  // Print layouts are paper: their own type, colours and headings.
  tinyText: ["src/components/print/**", "src/**/*PrintTemplate.tsx", "src/**/*PrintLayout.tsx"],
  uppercase: ["src/components/print/**", "src/**/*PrintTemplate.tsx", "src/**/*PrintLayout.tsx"],
  rawPalette: ["src/components/print/**", "src/**/*PrintTemplate.tsx", "src/**/*PrintLayout.tsx"],
  rawH1: ["src/design-system/**", "src/components/print/**", "src/**/*PrintTemplate.tsx", "src/**/*PrintLayout.tsx"],
  rawTable: [
    "src/design-system/**",
    "src/components/print/**",
    "src/components/line-grid/**",
    "src/**/*PrintTemplate.tsx",
    "src/**/*PrintLayout.tsx",
    "src/**/*Sheet.tsx",
  ],
};

const REGEXP_SPECIAL = new Set([".", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);

/** A glob (`**` + slash, `**`, `*`) as a regular expression over a repo-relative path. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    if (glob.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      re += ".*";
      i += 1;
    } else if (glob[i] === "*") re += "[^/]*";
    else re += REGEXP_SPECIAL.has(glob[i]) ? `\\${glob[i]}` : glob[i];
  }
  return new RegExp(`^${re}$`);
}

/** The file is exempt from the category through one of its globs. */
export function isExemptPath(file, category) {
  return (UI_GUARD_EXEMPT_GLOBS[category] ?? []).some((glob) => globToRegExp(glob).test(file));
}

/** no-restricted-syntax entries for every category not in `allowed`. */
export function restrictedSyntax(allowed = []) {
  return Object.entries(UI_GUARD_RULES)
    .filter(([category]) => !allowed.includes(category))
    .flatMap(([, rule]) => rule.selectors.map((selector) => ({ selector, message: rule.message })));
}

/**
 * Flat-config blocks: the full rule for src/, then one block per set of allowlisted categories
 * with only the other rules. `allowlist` is { category: { "src/file.tsx": count } }.
 */
export function uiGuardConfigs(allowlist) {
  const byFile = new Map();
  const add = (file, category) => byFile.set(file, [...(byFile.get(file) ?? []), category]);
  for (const [category, files] of Object.entries(allowlist)) {
    if (!UI_GUARD_RULES[category]) continue;
    for (const file of Object.keys(files)) add(file, category);
  }
  for (const [category, files] of Object.entries(UI_GUARD_EXEMPT)) for (const file of files) add(file, category);
  // A listed file inside an exempt folder keeps that exemption too (flat config: the last matching
  // block wins, and the file blocks come after the glob blocks).
  for (const [file, categories] of byFile) {
    for (const category of Object.keys(UI_GUARD_EXEMPT_GLOBS)) if (isExemptPath(file, category)) categories.push(category);
  }
  const blocks = (entries) => {
    const groups = new Map();
    for (const [file, categories] of entries) {
      const key = [...new Set(categories)].sort().join(",");
      groups.set(key, [...(groups.get(key) ?? []), file]);
    }
    return [...groups].map(([key, files]) => ({ files, rules: { "no-restricted-syntax": ["error", ...restrictedSyntax(key.split(","))] } }));
  };
  // One block per glob with all its categories: in flat config the last block for a file wins, so
  // a glob listed under several categories must lift them together.
  const byGlob = new Map();
  for (const [category, globs] of Object.entries(UI_GUARD_EXEMPT_GLOBS)) for (const glob of globs) byGlob.set(glob, [...(byGlob.get(glob) ?? []), category]);
  const globEntries = [...byGlob];
  return [
    { files: ["src/**/*.{ts,tsx}"], rules: { "no-restricted-syntax": ["error", ...restrictedSyntax()] } },
    ...blocks(globEntries),
    // Paths are globs to ESLint: "[id]" in a route folder must match itself, not one of "i" / "d".
    ...blocks([...byFile].map(([file, categories]) => [file.replace(/[[\]]/g, (c) => `[${c}]`), categories])),
  ];
}

/** How many times a category occurs in a file's text (the allowlist counts). */
export function countViolations(text, category) {
  return (text.match(UI_GUARD_RULES[category].pattern) ?? []).length;
}

/** { category: { file: count } } for the given files ([path, text] pairs), exempt files skipped. */
export function scanSources(entries) {
  const out = Object.fromEntries(Object.keys(UI_GUARD_RULES).map((k) => [k, {}]));
  for (const [file, text] of entries) {
    for (const category of Object.keys(UI_GUARD_RULES)) {
      if (UI_GUARD_EXEMPT[category]?.includes(file) || isExemptPath(file, category)) continue;
      const n = countViolations(text, category);
      if (n) out[category][file] = n;
    }
  }
  for (const k of Object.keys(out)) out[k] = Object.fromEntries(Object.entries(out[k]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return out;
}
