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
};

/** Files the rules never apply to: the formatting module itself. */
export const UI_GUARD_EXEMPT = { localeFormat: ["src/lib/dates/localeDate.ts"] };

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
  const groups = new Map();
  for (const [file, categories] of byFile) {
    const key = [...new Set(categories)].sort().join(",");
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  return [
    { files: ["src/**/*.{ts,tsx}"], rules: { "no-restricted-syntax": ["error", ...restrictedSyntax()] } },
    ...[...groups].map(([key, files]) => ({ files, rules: { "no-restricted-syntax": ["error", ...restrictedSyntax(key.split(","))] } })),
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
      if (UI_GUARD_EXEMPT[category]?.includes(file)) continue;
      const n = countViolations(text, category);
      if (n) out[category][file] = n;
    }
  }
  for (const k of Object.keys(out)) out[k] = Object.fromEntries(Object.entries(out[k]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return out;
}
