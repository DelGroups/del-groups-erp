// Module resolution for running src/ TypeScript under plain Node (tests, build checks):
// extensionless relative imports try .ts/.tsx/index.ts, and "@/x" maps to src/x like tsconfig.
const SRC = new URL("../../src/", import.meta.url);
const CANDIDATES = ["", ".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, nextResolve) {
  const isAlias = specifier.startsWith("@/");
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (!isAlias && !isRelative) return nextResolve(specifier, context);

  const base = isAlias ? new URL(specifier.slice(2), SRC).href : specifier;
  let lastError;
  for (const suffix of CANDIDATES) {
    try {
      return await nextResolve(base + suffix, context);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw error;
      lastError = error;
    }
  }
  throw lastError;
}
