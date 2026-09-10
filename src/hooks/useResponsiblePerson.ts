"use client";

import { useMemo } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { canDelegateInvoiceIssuer } from "@/types/database.types";

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
 * Sales reps (User role) are pinned to their own name on document forms.
 * Admins and Managers may delegate the invoice issuer to another employee.
 */
export function useResponsiblePerson(employees: EmployeeLike[]): ResponsiblePersonState {
  const { profile, loading, displayName } = useAuth();

  return useMemo(() => {
    const locked = !loading && !canDelegateInvoiceIssuer(profile?.role) && !!profile;
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
  }, [employees, profile, loading, displayName]);
}
