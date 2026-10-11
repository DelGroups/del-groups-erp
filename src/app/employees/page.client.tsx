"use client";

import { EmployeesPage } from "@/modules/hr/pages";
import { PAYROLL_EMPLOYEE_TABS } from "@/modules/payroll/pages";
import { useEnabledModules } from "@/hooks/useEnabledModules";

/** The HR employees screen, with the payroll tabs when the payroll module is enabled. */
export default function EmployeesPageClient() {
  const { isEnabled } = useEnabledModules();
  return <EmployeesPage extraTabs={isEnabled("payroll") ? PAYROLL_EMPLOYEE_TABS : []} />;
}
