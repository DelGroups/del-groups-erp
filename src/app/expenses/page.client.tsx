"use client";

import dynamic from "next/dynamic";
import { ExpensesPage } from "@/modules/expenses/pages";
import { useNewUi } from "@/components/shell/NewUiProvider";

// The view engine is loaded only by users of the new shell.
const ExpensesScreen = dynamic(() => import("@/modules/expenses/pages").then((m) => m.ExpensesScreen), { ssr: false });

/** With NEW_UI on: the screen on the view engine for users of the new shell, the classic page otherwise. */
export default function NewUiSwitch() {
  const { active } = useNewUi();
  return active ? <ExpensesScreen /> : <ExpensesPage />;
}
