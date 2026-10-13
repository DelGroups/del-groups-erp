/** Badge colours of invoice, payment and email statuses (labels come from i18n). */
export const INVOICE_STATUS_BADGE: Record<string, string> = {
  draft: "cp-badge-muted",
  issued: "cp-badge-info",
  paid: "cp-badge-success",
  overdue: "cp-badge-danger",
  void: "cp-badge-muted",
};

export const EMAIL_STATUS_BADGE: Record<string, string> = {
  pending: "cp-badge-info",
  sent: "cp-badge-success",
  skipped: "cp-badge-warning",
  failed: "cp-badge-danger",
};

export const PAYMENT_STATUS_BADGE: Record<string, string> = {
  pending: "cp-badge-info",
  succeeded: "cp-badge-success",
  failed: "cp-badge-danger",
  refunded: "cp-badge-muted",
};
