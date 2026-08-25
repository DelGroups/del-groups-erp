"use client";

import { useMemo } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

export interface EmployeeLike {
  id: string;
  full_name?: string | null;
  name?: string | null;
}

export interface ResponsiblePersonState {
  /** Signed-in user may only file documents under their own name. */
  locked: boolean;
  /** Employee row matching the signed-in profile, empty when unmatched. */
  lockedEmployeeId: string;
  /** Name to stamp on the document while locked. */
  lockedName: string;
  /** False until the session and profile have loaded. */
  ready: boolean;
}

function employeeName(employee: EmployeeLike): string {
  return employee.full_name || employee.name || "";
}

/**
 * Everyone except Admins is pinned to their own name on document forms.
 * The profile is matched to an `employees` row by explicit link first and by
 * name second, so commission tracking keeps working.
 */
export function useResponsiblePerson(employees: EmployeeLike[]): ResponsiblePersonState {
  const { profile, isAdmin, loading, displayName } = useAuth();

  return useMemo(() => {
    const locked = !loading && !isAdmin && !!profile;
    if (!locked) {
      return { locked: false, lockedEmployeeId: "", lockedName: "", ready: !loading };
    }

    const linked = profile?.employee_id
      ? employees.find((employee) => employee.id === profile.employee_id)
      : undefined;

    const profileName = (profile?.full_name || displayName || "").trim();
    const byName = profileName
      ? employees.find(
          (employee) =>
            employeeName(employee).trim().toLowerCase() === profileName.toLowerCase()
        )
      : undefined;

    const match = linked ?? byName;

    return {
      locked: true,
      lockedEmployeeId: match?.id ?? "",
      lockedName: match ? employeeName(match) : profileName,
      ready: true,
    };
  }, [employees, profile, isAdmin, loading, displayName]);
}
