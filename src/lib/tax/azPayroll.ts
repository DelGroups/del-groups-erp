/** Azerbaijan statutory payroll deductions for 2026 (non-oil private sector). */

export const AZ_PAYROLL_YEAR = 2026;

export const AZ_DSMF_BAND_AZN = 200;
export const AZ_PIT_MID_AZN = 2500;
export const AZ_PIT_HIGH_AZN = 8000;

export const AZ_DSMF_EE_LOW = 0.03;
export const AZ_DSMF_EE_HIGH = 0.1;
export const AZ_DSMF_ER_LOW = 0.22;
export const AZ_DSMF_ER_HIGH = 0.15;
export const AZ_DSMF_ER_OVER_8000 = 0.11;

export const AZ_ITS_RATE = 0.005;

export const AZ_PIT_LOW_RATE_2026 = 0.03;
export const AZ_PIT_MID_RATE = 0.1;
export const AZ_PIT_HIGH_RATE = 0.14;

export interface AzPayrollBreakdown {
  grossSalary: number;
  dsmfEmployee: number;
  dsmfEmployer: number;
  itsEmployee: number;
  itsEmployer: number;
  incomeTax: number;
  taxableIncome: number;
  employeeDeductions: number;
  employerCost: number;
  netSalary: number;
}

function money(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100) / 100;
}

export function calcDsmf(gross: number): { employee: number; employer: number } {
  const g = Math.max(0, Number(gross) || 0);
  const first = Math.min(g, AZ_DSMF_BAND_AZN);
  const mid = Math.min(Math.max(g - AZ_DSMF_BAND_AZN, 0), AZ_PIT_HIGH_AZN - AZ_DSMF_BAND_AZN);
  const above = Math.max(g - AZ_PIT_HIGH_AZN, 0);
  return {
    employee: money(first * AZ_DSMF_EE_LOW + mid * AZ_DSMF_EE_HIGH + above * AZ_DSMF_EE_HIGH),
    employer: money(first * AZ_DSMF_ER_LOW + mid * AZ_DSMF_ER_HIGH + above * AZ_DSMF_ER_OVER_8000),
  };
}

export function calcIts(gross: number): { employee: number; employer: number } {
  const g = Math.max(0, Number(gross) || 0);
  return {
    employee: money(g * AZ_ITS_RATE),
    employer: money(g * AZ_ITS_RATE),
  };
}

/** 2026 non-oil private PIT: 3% ≤ 2500; 75 + 10% of excess ≤ 8000; 625 + 14% above 8000. */
export function calcIncomeTax(taxable: number, year = AZ_PAYROLL_YEAR): number {
  const amount = Math.max(0, Number(taxable) || 0);
  const lowRate = year >= 2028 ? 0.07 : year >= 2027 ? 0.05 : AZ_PIT_LOW_RATE_2026;
  const lowBracketTax = money(AZ_PIT_MID_AZN * lowRate);

  if (amount <= AZ_PIT_MID_AZN) {
    return money(amount * lowRate);
  }
  if (amount <= AZ_PIT_HIGH_AZN) {
    return money(lowBracketTax + (amount - AZ_PIT_MID_AZN) * AZ_PIT_MID_RATE);
  }
  const midBracketTax = money((AZ_PIT_HIGH_AZN - AZ_PIT_MID_AZN) * AZ_PIT_MID_RATE);
  return money(lowBracketTax + midBracketTax + (amount - AZ_PIT_HIGH_AZN) * AZ_PIT_HIGH_RATE);
}

export function calcAzPayroll(input: {
  baseSalary: number;
  bonusesCommissions?: number;
  advancesDeducted?: number;
  otherDeductions?: number;
  year?: number;
}): AzPayrollBreakdown {
  const grossSalary = money(
    Math.max(0, (Number(input.baseSalary) || 0) + (Number(input.bonusesCommissions) || 0))
  );
  const dsmf = calcDsmf(grossSalary);
  const its = calcIts(grossSalary);
  const taxableIncome = money(Math.max(0, grossSalary - dsmf.employee - its.employee));
  const incomeTax = calcIncomeTax(taxableIncome, input.year ?? AZ_PAYROLL_YEAR);
  const employeeDeductions = money(dsmf.employee + its.employee + incomeTax);
  const advances = money(Number(input.advancesDeducted) || 0);
  const other = money(Number(input.otherDeductions) || 0);
  const netSalary = money(Math.max(0, grossSalary - employeeDeductions - advances - other));

  return {
    grossSalary,
    dsmfEmployee: dsmf.employee,
    dsmfEmployer: dsmf.employer,
    itsEmployee: its.employee,
    itsEmployer: its.employer,
    incomeTax,
    taxableIncome,
    employeeDeductions,
    employerCost: money(grossSalary + dsmf.employer + its.employer),
    netSalary,
  };
}

export function payrollRunToBreakdown(row: {
  base_salary: number;
  bonuses_commissions: number;
  advances_deducted: number;
  other_deductions: number;
  net_salary: number;
  period_year?: number;
  gross_salary?: number | null;
  dsmf_employee?: number | null;
  dsmf_employer?: number | null;
  its_employee?: number | null;
  its_employer?: number | null;
  income_tax?: number | null;
  taxable_income?: number | null;
}): AzPayrollBreakdown {
  const computed = calcAzPayroll({
    baseSalary: row.base_salary,
    bonusesCommissions: row.bonuses_commissions,
    advancesDeducted: row.advances_deducted,
    otherDeductions: row.other_deductions,
    year: row.period_year,
  });
  const storedGross = Number(row.gross_salary) || 0;
  const storedDsmf = Number(row.dsmf_employee) || 0;
  if (storedGross <= 0 && storedDsmf <= 0) {
    return { ...computed, netSalary: money(Number(row.net_salary) || computed.netSalary) };
  }

  const dsmfEmployee = money(Number(row.dsmf_employee) || 0);
  const dsmfEmployer = money(Number(row.dsmf_employer) || computed.dsmfEmployer);
  const itsEmployee = money(Number(row.its_employee) || 0);
  const itsEmployer = money(Number(row.its_employer) || computed.itsEmployer);
  const incomeTax = money(Number(row.income_tax) || 0);
  const grossSalary = storedGross || computed.grossSalary;

  return {
    grossSalary,
    dsmfEmployee,
    dsmfEmployer,
    itsEmployee,
    itsEmployer,
    incomeTax,
    taxableIncome: money(Number(row.taxable_income) || computed.taxableIncome),
    employeeDeductions: money(dsmfEmployee + itsEmployee + incomeTax),
    employerCost: money(grossSalary + dsmfEmployer + itsEmployer),
    netSalary: money(Number(row.net_salary) || computed.netSalary),
  };
}
