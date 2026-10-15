"use client";

import dynamic from "next/dynamic";
import { PAYROLL_ENGINE_TABS } from "@/modules/payroll/pages";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { useNewUi } from "@/components/shell/NewUiProvider";
import EmployeesPageClient from "./page.client";

// The view engine is loaded only by users of the new shell.
const EmployeesScreen = dynamic(() => import("@/modules/hr/pages").then((m) => m.EmployeesScreen), { ssr: false });

/** With NEW_UI on: HR on the view engine for users of the new shell (payroll tabs when enabled), the classic page otherwise. */
export default function EmployeesNewUiSwitch() {
  const { active } = useNewUi();
  const { isEnabled } = useEnabledModules();
  return active ? <EmployeesScreen extraTabs={isEnabled("payroll") ? PAYROLL_ENGINE_TABS : []} /> : <EmployeesPageClient />;
}
