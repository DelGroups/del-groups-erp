# Modules

Each area of the ERP is a module with a manifest in `src/modules/<id>/manifest.ts`
(plan: `docs/SaaS-Commercialization-Plan.md` §5). The registry (`registry.ts`) collects
the manifests, checks them and generates:

| Generated | Used by |
| --- | --- |
| `NAV_SECTIONS` (`src/lib/navigation/navConfig.ts`) | sidebar, command palette |
| `ROUTE_RULES`, `NAV_PATH_PERMISSIONS` (`src/lib/auth/routePermissions.ts`) | page guards, menu filtering |
| `GRANULAR_PERMISSION_MODULES` (`src/lib/auth/permissionMatrix.ts`) | role editor, permission checks |

## Code layout

Modules move here one at a time (moved so far: **crm**, **contracts**, **consignment**, **commissions**, **expenses**, **hr**, **payroll**, **production**, **polywood**, **purchases**). A moved module looks like:

```
src/modules/crm/
  manifest.ts      what the module owns (registry)
  index.ts         public API for other modules: import "@/modules/crm"
  pages.ts         screens for the thin route files in src/app: import "@/modules/crm/pages"
  components/  lib/  actions/  hooks/     internals (keep each folder flat)
```

Its SQL is in `supabase/modules/<id>/` (see the README there).

**Import rule** (ESLint `no-restricted-imports`, `eslint.config.mjs`): outside a module, import
only `@/modules/<id>` or, from `src/app`, `@/modules/<id>/pages`. Inside a module use relative
imports and never reach into another module's folders; call its public API or emit an
`erp_events` event instead. Core code (`src/lib`, `src/components`) must not import modules.

**Tabs on another module's screen:** a module that builds on another can add tabs to its screen when the
host offers a slot, without the host importing it. HR's employees screen takes `EmployeesPageTab`s
(`@/modules/hr`); payroll exports its tabs from `@/modules/payroll/pages`, and the route file
`src/app/employees/page.client.tsx` passes them in when payroll is enabled.

## Adding to a manifest

- **Menu item:** `{ path, label (i18n key), icon (lucide name, also add it to NAV_ICONS in navConfig.ts), section, order }`.
  `order` places it inside the section, which can hold items of several modules.
- **Page access:** a `routes` entry `{ prefix, permission }` covers the prefix and everything below it.
  The most specific prefix wins.
- **Permissions:** list the flat keys the module owns in `permissions` (each key has exactly one owner)
  and its role-editor checkboxes in `matrix` (`group`, `key`, `order`). Matrix group ids are stored
  in the database: never rename them.
- A module may only use permissions of itself or of modules in its `depends`. Exception:
  `borrowsPermissionsFrom` lists modules whose permissions it may use because they depend on it
  (contracts uses `can_view_sales`; sales and purchases depend on contracts, so contracts is
  always on together with them).

## Checks

`npm run build` runs `npm run modules:check` first; it fails on an unknown dependency, a cycle,
a permission with no owner or two owners, a route using a permission of a module that is not a
dependency, a duplicate path/route/checkbox, or a menu item without an access rule.
`tests/moduleRegistry.test.mjs` also checks that the generated menu, route permissions and matrix
equal the hand-written ones they replaced (`tests/fixtures/module-registry-baseline.json`).
