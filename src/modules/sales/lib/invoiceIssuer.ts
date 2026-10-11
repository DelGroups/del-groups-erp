import type { ProfileRow, Role } from "@/types/database.types";
import { canDelegateInvoiceIssuer, isAdminRole, isManagerRole } from "@/types/database.types";

export type IssuerEmployeeLike = {
  id: string;
  full_name?: string | null;
  name?: string | null;
};

export function employeeDisplayName(employee: IssuerEmployeeLike): string {
  return employee.full_name || employee.name || "";
}

export function profileIdForEmployee(
  employeeId: string,
  profiles: Pick<ProfileRow, "id" | "employee_id" | "is_active">[]
): string | null {
  if (!employeeId) return null;
  const match = profiles.find(
    (profile) => profile.employee_id === employeeId && profile.is_active !== false
  );
  return match?.id ?? null;
}

export function resolveIssuedByProfileId(input: {
  selectedEmployeeId: string;
  profiles: Pick<ProfileRow, "id" | "employee_id" | "is_active">[];
  currentProfileId?: string | null;
  role?: Role | null;
}): string | null {
  const { selectedEmployeeId, profiles, currentProfileId, role } = input;
  if (!canDelegateInvoiceIssuer(role)) {
    return currentProfileId || null;
  }
  if (selectedEmployeeId) {
    return profileIdForEmployee(selectedEmployeeId, profiles) || currentProfileId || null;
  }
  return currentProfileId || null;
}

export { canDelegateInvoiceIssuer, isAdminRole, isManagerRole };
