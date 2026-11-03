/**
 * Public API of the consignment module. Other code imports consignment only from
 * here (`@/modules/consignment`), never from its components/, lib/ or actions/.
 */

// The lookup quick-create (src/components/lookups) creates partner shops with the same action
// as the partner form.
export { saveConsignmentPartnerAction } from "./actions/consignment";
