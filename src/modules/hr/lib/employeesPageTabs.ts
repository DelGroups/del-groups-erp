import type { ComponentType, ReactNode } from "react";
import type { Employee } from "@/types/database.types";

/**
 * Extra tabs on the employees screen, added by modules that build on HR (payroll adds
 * "Payroll" and "Advances"). HR does not know those modules: the route file in src/app
 * passes their tabs in, and only when the module is enabled.
 */
export interface EmployeesPageTabProps {
  employees: Employee[];
  accounts: { id: string; name: string; balance: number }[];
  canManageHr: boolean;
  /** The tab's "create" form, opened by the page header button or by the tab itself. */
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
  /** New UI only: the screen's tab bar, for tabs that render their own page (ownsPage). */
  header?: ReactNode;
}

export interface EmployeesPageTab {
  id: string;
  /** i18n key of the tab label. */
  labelKey: string;
  icon: ReactNode;
  /** i18n key of the page header button shown on this tab to users who can manage HR. */
  createLabelKey?: string;
  Component: ComponentType<EmployeesPageTabProps>;
  /**
   * New UI only: the tab renders its own page frame (a view-engine screen) and shows `header`;
   * the classic screen ignores this.
   */
  ownsPage?: boolean;
}
