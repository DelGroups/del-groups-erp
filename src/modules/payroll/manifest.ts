import { defineModule } from "../types";

/** Salary calculation and payments (Azerbaijan rules); its screens live inside HR → Employees for now. */
export default defineModule({
  id: "payroll",
  name: "Payroll",
  version: "1.0.0",
  depends: ["core", "hr", "accounting", "tax-az"],
  permissions: [],
  matrix: [],
  menus: [],
  routes: [],
  aiTools: [],
  settings: [],
});
