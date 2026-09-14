/**
 * Canonical form control tokens — Gentelella ERP design system.
 * All values reference `--erp-*` CSS variables from `src/design-system/tokens.css`.
 */

export const formLabelClass = "erp-label";

export const formControlClass =
  "h-10 w-full min-w-0 rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-input)] px-3 text-[length:var(--erp-text-sm)] text-[color:var(--erp-text-main)] shadow-[var(--erp-shadow-sm)] placeholder:text-[color:var(--erp-text-placeholder)] transition-[border-color,box-shadow] duration-[var(--erp-duration-normal)] focus:border-[color:var(--erp-color-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--erp-border-focus)] disabled:cursor-not-allowed disabled:opacity-60";

export const formControlErrorClass =
  "border-[color:var(--erp-color-danger)] focus:border-[color:var(--erp-color-danger)] focus:ring-[color:var(--erp-color-danger)]/25";

export const formInputClass = formControlClass;

export const formNumberInputClass =
  `${formControlClass} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

export const formSelectClass = `${formControlClass} cursor-pointer appearance-auto pr-9`;

export const formTextareaClass = `${formControlClass} min-h-[5.5rem] resize-y py-2.5`;

export const formFieldClass = "min-w-0 w-full";

export const formSectionStackClass = "space-y-4";

export const formRowClass = "grid grid-cols-1 gap-4 sm:grid-cols-2";

export const formInputGroupClass =
  "grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8.5rem] sm:items-center";

export const formErrorClass = "mt-1 text-[length:var(--erp-text-xs)] font-medium text-[color:var(--erp-color-danger)]";

export const formHintClass =
  "mt-1 text-[length:var(--erp-text-xs)] font-normal text-[color:var(--erp-text-muted)]";

/** Compact but tappable controls inside editable data-table rows. */
export const formTableInputClass =
  "app-table-input [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
