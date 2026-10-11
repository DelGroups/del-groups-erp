import TenantStatusPage from "@/components/tenant/TenantStatusPage";

export const dynamic = "force-dynamic";

export default function Page() {
  return <TenantStatusPage kind="unavailable" />;
}
