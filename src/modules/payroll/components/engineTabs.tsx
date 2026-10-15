import React from "react";
import { Banknote, Calculator } from "lucide-react";
import type { EmployeesPageTab } from "@/modules/hr";
import { AdvancesEngineTab, PayrollEngineTab } from "./PayrollEngineTabs";

/** New UI (NEW_UI): payroll's tabs on the HR employees screen, on the view engine. */
export const PAYROLL_ENGINE_TABS: EmployeesPageTab[] = [
  { id: "payroll", labelKey: "employees.tabs.payroll", icon: <Calculator className="h-4 w-4" />, Component: PayrollEngineTab, ownsPage: true },
  { id: "advances", labelKey: "employees.tabs.advances", icon: <Banknote className="h-4 w-4" />, Component: AdvancesEngineTab, ownsPage: true },
];
