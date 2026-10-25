/** Screens of the CRM module, for the thin route files in src/app. */
export { default as CrmPipelinePage } from "./components/CrmPipelinePage";
export { default as CrmSettingsPage } from "./components/CrmSettingsPage";
/** New UI (NEW_UI, prompt 17): deals on the view engine. */
export { default as CrmDealsScreen } from "./components/DealsScreen";
export { default as CrmDealFormScreen } from "./components/DealFormScreen";
/** New CRM (NEW_CRM, prompt 21): pipeline, leads, one deal, reports and settings. */
export { PipelineScreen as CrmPipelineScreen, LeadsScreen as CrmLeadsScreen } from "./components/pipeline/PipelineScreens";
export { PipelineDealScreen as CrmPipelineDealScreen } from "./components/pipeline/PipelineDealScreen";
export { CrmReportsScreen } from "./components/pipeline/CrmReportsScreen";
export { CrmConfigScreen } from "./components/pipeline/CrmConfigScreen";
