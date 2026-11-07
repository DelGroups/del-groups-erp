/**
 * Custom SMTP for the tenants' own Supabase Auth (invites, password resets).
 *
 * Supabase's built-in email service only delivers to members of the Supabase organization
 * and is heavily rate limited, so a real company's admin never gets the invite. When the
 * TENANT_SMTP_* settings are in the control panel's env, configure_auth (and "Re-apply email
 * settings") also sends them to the tenant project through the Management API. Without them
 * the tenant keeps Supabase's default email, as before.
 *
 * The password is only read here and only sent in the PATCH body; callers pass
 * smtpSecrets() to redactSecrets() so it can never reach a log or an error message.
 */

export interface TenantSmtp {
  host: string;
  port: number;
  user: string;
  pass: string;
  senderEmail: string;
  /** Optional; the tenant's company name is used when empty. */
  senderName: string;
}

export const REQUIRED_SMTP_SETTINGS = [
  "TENANT_SMTP_HOST",
  "TENANT_SMTP_PORT",
  "TENANT_SMTP_USER",
  "TENANT_SMTP_PASS",
  "TENANT_SMTP_SENDER_EMAIL",
] as const;
export type SmtpSetting = (typeof REQUIRED_SMTP_SETTINGS)[number];

/** Auth emails a tenant project may send per hour (invites and resets of one company). */
export const TENANT_EMAIL_RATE_PER_HOUR = 30;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reads TENANT_SMTP_* from env. All unset: { smtp: null, missing: [] } (default email).
 * Partly set or invalid: { smtp: null, missing: [...] } so the panel can say what to fix.
 */
export function tenantSmtpFromEnv(env: Readonly<Record<string, string | undefined>>): {
  smtp: TenantSmtp | null;
  missing: SmtpSetting[];
} {
  const value = (name: string) => (env[name] ?? "").trim();
  const anySet = REQUIRED_SMTP_SETTINGS.some((name) => value(name)) || Boolean(value("TENANT_SMTP_SENDER_NAME"));
  if (!anySet) return { smtp: null, missing: [] };

  const missing: SmtpSetting[] = REQUIRED_SMTP_SETTINGS.filter((name) => !value(name));
  const port = Number(value("TENANT_SMTP_PORT"));
  if (value("TENANT_SMTP_PORT") && !(Number.isInteger(port) && port > 0 && port <= 65535)) missing.push("TENANT_SMTP_PORT");
  if (value("TENANT_SMTP_SENDER_EMAIL") && !EMAIL.test(value("TENANT_SMTP_SENDER_EMAIL"))) missing.push("TENANT_SMTP_SENDER_EMAIL");
  if (missing.length) return { smtp: null, missing: [...new Set(missing)] };

  return {
    smtp: {
      host: value("TENANT_SMTP_HOST"),
      port,
      user: value("TENANT_SMTP_USER"),
      // Not trimmed beyond the edges: an SMTP password may contain any character.
      pass: value("TENANT_SMTP_PASS"),
      senderEmail: value("TENANT_SMTP_SENDER_EMAIL"),
      senderName: value("TENANT_SMTP_SENDER_NAME"),
    },
    missing: [],
  };
}

/** The SMTP part of PATCH /v1/projects/{ref}/config/auth (smtp_port is a string there). */
export function smtpAuthConfig(smtp: TenantSmtp, company: string): Record<string, string | number> {
  return {
    smtp_host: smtp.host,
    smtp_port: String(smtp.port),
    smtp_user: smtp.user,
    smtp_pass: smtp.pass,
    smtp_admin_email: smtp.senderEmail,
    smtp_sender_name: smtp.senderName || `${company} ERP`,
    rate_limit_email_sent: TENANT_EMAIL_RATE_PER_HOUR,
  };
}

/** Values redactSecrets() must remove from anything written to a log. */
export function smtpSecrets(smtp: TenantSmtp | null | undefined): string[] {
  return smtp?.pass ? [smtp.pass] : [];
}

/** One line for the provisioning log, without the password or the user name. */
export function describeEmailSetup(smtp: TenantSmtp | null | undefined): string {
  return smtp
    ? `emails via ${smtp.host}:${smtp.port} from ${smtp.senderEmail}`
    : "emails via Supabase's default service (only reaches members of the Supabase organization)";
}
