/**
 * Canonical form control tokens — use across pages, modals, and drawers.
 */
export const formLabelClass =
  "mb-1.5 block text-sm font-medium text-slate-700 dark:text-app";

export const formControlClass =
  "h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-600 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-app dark:bg-app-card dark:text-app dark:placeholder:text-app-muted";

export const formInputClass = formControlClass;

export const formNumberInputClass =
  `${formControlClass} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

export const formSelectClass =
  `${formControlClass} cursor-pointer appearance-auto pr-9`;

export const formTextareaClass =
  `${formControlClass} min-h-[5.5rem] resize-y py-2.5`;

/** Wrapper for a single labeled field — prevents grid/flex collapse. */
export const formFieldClass = "min-w-0 w-full";

/** Standard two-column field row inside a section card. */
export const formRowClass = "grid grid-cols-1 gap-4 sm:grid-cols-2";

/** Input + trailing select (price, unit, etc.) */
export const formInputGroupClass =
  "grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8.5rem] sm:items-center";
