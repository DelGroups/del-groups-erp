import React from "react";
import { Banknote, Calculator } from "lucide-react";
import type { EmployeesPageTab } from "@/modules/hr";
import PayrollTab from "./PayrollTab";
import AdvancesTab from "./AdvancesTab";

/** Payroll's tabs on the HR employees screen, after the employee directory. */
export const PAYROLL_EMPLOYEE_TABS: EmployeesPageTab[] = [
  { id: "payroll", labelKey: "employees.tabs.payroll", icon: <Calculator className="h-4 w-4" />, Component: PayrollTab },
  {
    id: "advances",
    labelKey: "employees.tabs.advances",
    icon: <Banknote className="h-4 w-4" />,
    createLabelKey: "employees.advance.newTitle",
    Component: AdvancesTab,
  },
];
