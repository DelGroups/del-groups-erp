/**
 * The metadata-driven view engine (prompt 17, plan §6.1). A screen writes a ViewDefinition
 * (model, fields, filters, group by, list/kanban/form/pivot/graph/calendar parts) and renders
 * <ViewEngine> for the list side and <FormView> for one record; data comes through the
 * TanStack Query layer in ./data (user session, so RLS applies; nothing read while the module
 * is off or the user lacks the read permission). New-UI only: use inside <DesignScope>.
 */
export * from "./types";
export { useViewData, useViewRecord, useViewAccess, useRecordMutation, useFavorites, invalidateModel, type ViewData, type RecordData, type ViewStatus } from "./data";
export { ViewEngine, type ViewEngineProps } from "./components/ViewEngine";
export { FormView, StatusBar, Tabs, type FormAction, type FormTab, type FormViewProps } from "./components/FormView";
export { ListView } from "./components/ListView";
export { KanbanView } from "./components/KanbanView";
export { PivotView } from "./components/PivotView";
export { GraphView } from "./components/GraphView";
export { CalendarView } from "./components/CalendarView";
export { SearchPanel } from "./components/SearchPanel";
export { validateDefinition, type Formatter } from "./logic";
export { ViewScope, useFormatter, useFilterContext } from "./components/ViewScope";
export { EngineScreen, RECORD_PARAM, type EngineScreenProps } from "./components/EngineScreen";
export { KpiCards, type Kpi } from "./components/KpiCards";
export { RecordPanel } from "./components/RecordPanel";
export { weeklySeries, monthTotals, countIf, sumIf, money, figure } from "./logic";
