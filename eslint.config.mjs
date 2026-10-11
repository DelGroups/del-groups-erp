import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Module boundaries (src/modules/<id>, docs/SaaS-Commercialization-Plan.md §5.3):
// from outside a module, import only its public API `@/modules/<id>` (index.ts) or,
// for route files in src/app, `@/modules/<id>/pages`. Inside a module use relative
// imports, and never climb into another module's folders.
const MODULE_PUBLIC_API = {
  regex: "^@/modules/[^/]+/(?!pages$).+",
  message:
    "Import a module only through its public API: @/modules/<id> (index.ts), or @/modules/<id>/pages from src/app. Inside a module use relative imports.",
};
const crossModule = (regex) => ({
  regex,
  message: "Do not import another module's internals; use its public API @/modules/<id> (or erp_events).",
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [MODULE_PUBLIC_API] }] },
  },
  {
    // Files directly in a module folder (index.ts, pages.ts, manifest.ts).
    files: ["src/modules/*/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [MODULE_PUBLIC_API, crossModule("^\\.\\./[^./][^/]*/")] }],
    },
  },
  {
    // Files in a module's components/, lib/, actions/, hooks/ (one level; keep them flat).
    files: ["src/modules/*/*/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [MODULE_PUBLIC_API, crossModule("^\\.\\./\\.\\./[^./][^/]*/")] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Separate app with its own lint config (control-panel/eslint.config.mjs).
    "control-panel/**",
  ]),
]);

export default eslintConfig;
