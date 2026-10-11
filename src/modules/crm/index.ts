/**
 * Public API of the CRM module. Other modules import CRM only from here
 * (`@/modules/crm`), never from its components/, lib/, actions/ or hooks/.
 */
export { CRM_CONFIG_KEY, DEFAULT_CRM_CONFIG, parseCrmConfig } from "./lib/config";
export type { CrmConfig, CrmPipelineStage, CrmStageKind } from "./lib/config";
