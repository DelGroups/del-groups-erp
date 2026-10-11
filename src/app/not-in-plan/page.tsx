import PageClient from "./page.client";
import { isModuleId } from "@/modules/enabled";

export const dynamic = "force-dynamic";

/** Shown (via a rewrite in src/proxy.ts) for pages of a module the tenant does not have. */
export default async function Page({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const { module: requested } = await searchParams;
  return <PageClient moduleId={requested && isModuleId(requested) ? requested : null} />;
}
