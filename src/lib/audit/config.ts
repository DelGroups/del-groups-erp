export const AUDIT_CONFIG_KEY = "audit_config";

export const AUDIT_RETENTION_DAYS = [30, 90, 180, 365, 0] as const;
export type AuditRetentionDays = (typeof AUDIT_RETENTION_DAYS)[number];

export interface AuditConfig {
  /** 0 = unlimited (never purge). */
  log_retention_days: AuditRetentionDays;
  track_read_events: boolean;
  alert_on_record_deletion: boolean;
}

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  log_retention_days: 0,
  track_read_events: false,
  alert_on_record_deletion: true,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseAuditConfig(raw: unknown): AuditConfig {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const days = Number(source.log_retention_days);
  const retention = (AUDIT_RETENTION_DAYS as readonly number[]).includes(days)
    ? (days as AuditRetentionDays)
    : DEFAULT_AUDIT_CONFIG.log_retention_days;
  return {
    log_retention_days: retention,
    track_read_events: asBoolean(source.track_read_events, false),
    alert_on_record_deletion: asBoolean(source.alert_on_record_deletion, true),
  };
}

export function auditRetentionCutoffIso(days: number, now = new Date()): string | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.round(days));
  return cutoff.toISOString();
}
