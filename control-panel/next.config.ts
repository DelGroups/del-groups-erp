import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  // Standalone server for the Docker image (control-panel/Dockerfile).
  output: "standalone",
  // The design tokens are shared with the ERP (src/design-system), one folder up:
  // Turbopack only resolves files inside its root, and tracing must include them too.
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // Don't let `next dev` write AGENTS.md / CLAUDE.md here; the repo root has them.
  agentRules: false,
};

export default nextConfig;
