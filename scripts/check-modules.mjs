// Build-time check of the module registry: unknown dependencies, cycles,
// permission ownership, route coverage. Runs before `next build` (npm run build).
//   node --import ./scripts/node-ts/register.mjs scripts/check-modules.mjs
import { MODULES, validateRegistry } from "../src/modules/registry.ts";
import { allPermissionKeys } from "../src/types/database.types.ts";

const errors = validateRegistry(MODULES, allPermissionKeys());
if (errors.length) {
  console.error(`Module registry is invalid:\n  - ${errors.join("\n  - ")}`);
  process.exit(1);
}
console.log(`Module registry OK: ${MODULES.length} modules.`);
