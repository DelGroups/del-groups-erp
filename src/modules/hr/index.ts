/**
 * Public API of the HR module. Other modules import HR only from here
 * (`@/modules/hr`), never from its components/, lib/ or actions/.
 *
 * The employees table itself stays in core (sales, production and other modules
 * point to it); HR owns the employee screens, departments editor and leave.
 */
export { fetchEmployees } from "./lib/employees";
