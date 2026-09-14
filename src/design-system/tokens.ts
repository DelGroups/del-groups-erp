/**
 * TypeScript mirror of `tokens.css` for documentation, tests, and tooling.
 * Runtime styling MUST use CSS variables (`var(--erp-*)`), not these literals.
 */

export const erpTokens = {
  color: {
    primary: "var(--erp-color-primary)",
    primaryHover: "var(--erp-color-primary-hover)",
    secondary: "var(--erp-color-secondary)",
    success: "var(--erp-color-success)",
    warning: "var(--erp-color-warning)",
    danger: "var(--erp-color-danger)",
    info: "var(--erp-color-info)",
    link: "var(--erp-color-link)",
  },
  bg: {
    main: "var(--erp-bg-main)",
    panel: "var(--erp-bg-panel)",
    sidebar: "var(--erp-bg-sidebar)",
    topbar: "var(--erp-bg-topbar)",
    tableHeader: "var(--erp-bg-table-header)",
  },
  text: {
    main: "var(--erp-text-main)",
    muted: "var(--erp-text-muted)",
    inverse: "var(--erp-text-inverse)",
  },
  border: {
    default: "var(--erp-border-default)",
    strong: "var(--erp-border-strong)",
    focus: "var(--erp-border-focus)",
  },
  radius: {
    sm: "var(--erp-radius-sm)",
    md: "var(--erp-radius-md)",
    lg: "var(--erp-radius-lg)",
  },
  shadow: {
    sm: "var(--erp-shadow-sm)",
    md: "var(--erp-shadow-md)",
    lg: "var(--erp-shadow-lg)",
  },
  layout: {
    sidebarWidth: "var(--erp-sidebar-width)",
    topbarHeight: "var(--erp-topbar-height)",
    contentPaddingX: "var(--erp-content-padding-x)",
    contentPaddingY: "var(--erp-content-padding-y)",
  },
} as const;

export type ErpTokenPath = typeof erpTokens;
