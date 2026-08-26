import { redirect } from "next/navigation";
import PageClient from "./page.client";
import { getServerAuthContext } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { user, profile } = await getServerAuthContext();

  if (!user || !profile) {
    redirect("/login");
  }

  return <PageClient />;
}
