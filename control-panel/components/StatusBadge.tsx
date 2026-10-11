import type { TenantStatus } from "@/lib/tenants";

const TONE: Record<TenantStatus, string> = {
  provisioning: "cp-badge-info",
  trial: "cp-badge-info",
  active: "cp-badge-success",
  past_due: "cp-badge-warning",
  read_only: "cp-badge-warning",
  suspended: "cp-badge-danger",
  cancelled: "cp-badge-muted",
};

export default function StatusBadge({ status, label }: { status: TenantStatus; label: string }) {
  return <span className={`cp-badge ${TONE[status] ?? "cp-badge-muted"}`}>{label}</span>;
}
