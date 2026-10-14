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

/**
 * Tokens of the new UI (prompt 15), defined in `theme.css` and only set inside a
 * `[data-ds]` scope (<DesignScope>). Theme (light / dark / system), density
 * (comfortable / compact) and the tenant brand colour switch their values.
 */
export const dsTokens = {
  brand: {
    base: "var(--ds-brand)",
    hover: "var(--ds-brand-hover)",
    foreground: "var(--ds-brand-fg)",
    soft: "var(--ds-brand-soft)",
  },
  surface: {
    bg: "var(--ds-bg)",
    base: "var(--ds-surface)",
    sunken: "var(--ds-surface-sunken)",
    raised: "var(--ds-surface-raised)",
    overlay: "var(--ds-overlay)",
  },
  text: { main: "var(--ds-text)", muted: "var(--ds-text-muted)", subtle: "var(--ds-text-subtle)" },
  border: { default: "var(--ds-border)", strong: "var(--ds-border-strong)" },
  status: {
    success: "var(--ds-success)",
    warning: "var(--ds-warning)",
    danger: "var(--ds-danger-strong)",
    info: "var(--ds-info)",
  },
  font: { sans: "var(--ds-font-sans)", mono: "var(--ds-font-mono)" },
  radius: {
    xs: "var(--ds-radius-xs)",
    sm: "var(--ds-radius-sm)",
    md: "var(--ds-radius-md)",
    lg: "var(--ds-radius-lg)",
    xl: "var(--ds-radius-xl)",
    full: "var(--ds-radius-full)",
  },
  elevation: {
    0: "var(--ds-elevation-0)",
    1: "var(--ds-elevation-1)",
    2: "var(--ds-elevation-2)",
    3: "var(--ds-elevation-3)",
    4: "var(--ds-elevation-4)",
  },
  density: {
    controlHeight: "var(--ds-control-h)",
    rowHeight: "var(--ds-row-h)",
    padX: "var(--ds-pad-x)",
    padY: "var(--ds-pad-y)",
    gap: "var(--ds-gap)",
  },
  motion: {
    fast: "var(--ds-duration-fast)",
    base: "var(--ds-duration-base)",
    slow: "var(--ds-duration-slow)",
    easeOut: "var(--ds-ease-out)",
    easeInOut: "var(--ds-ease-in-out)",
  },
} as const;

export type DsTokenPath = typeof dsTokens;
