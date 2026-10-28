import type { ComponentType } from "react";
import type { WidgetProps } from "./types";
import { AgendaWidget, ApprovalsWidget, CalendarWidget, ClockWidget, GreetingWidget, MyActivitiesWidget, MyTodosWidget, QuickActionsWidget, RecentDocumentsWidget, SavedViewsWidget, WeatherWidget } from "./PersonalWidgets";
import { AppsWidget, AwayTodayWidget, LowStockWidget, MyPipelineWidget, ProductionStatusWidget } from "./OperationsWidgets";
import {
  ArDiscrepancyWidget,
  CashBalancesWidget,
  ExpensesByCategoryWidget,
  InventoryValueWidget,
  NetProfitWidget,
  PayablesDueWidget,
  PipelineValueWidget,
  PurchasesMonthWidget,
  ReceivablesWidget,
  RevenueTrendWidget,
  SalesBySellerWidget,
  SalesMonthWidget,
  SalesTargetWidget,
  TopCustomersWidget,
  TopProductsWidget,
  WeekOverWeekWidget,
} from "./ManagementWidgets";

/** The component of every registered widget (src/lib/home/registry.ts). */
export const WIDGET_COMPONENTS: Record<string, ComponentType<WidgetProps>> = {
  greeting: GreetingWidget,
  clock: ClockWidget,
  weather: WeatherWidget,
  calendar: CalendarWidget,
  my_activities: MyActivitiesWidget,
  my_todos: MyTodosWidget,
  agenda: AgendaWidget,
  quick_actions: QuickActionsWidget,
  approvals: ApprovalsWidget,
  saved_views: SavedViewsWidget,
  recent_documents: RecentDocumentsWidget,
  apps: AppsWidget,
  low_stock: LowStockWidget,
  production_status: ProductionStatusWidget,
  away_today: AwayTodayWidget,
  my_pipeline: MyPipelineWidget,
  sales_month: SalesMonthWidget,
  revenue_trend: RevenueTrendWidget,
  net_profit: NetProfitWidget,
  purchases_month: PurchasesMonthWidget,
  cash_balances: CashBalancesWidget,
  receivables: ReceivablesWidget,
  payables_due: PayablesDueWidget,
  top_customers: TopCustomersWidget,
  top_products: TopProductsWidget,
  sales_by_seller: SalesBySellerWidget,
  expenses_by_category: ExpensesByCategoryWidget,
  inventory_value: InventoryValueWidget,
  week_over_week: WeekOverWeekWidget,
  ar_discrepancy: ArDiscrepancyWidget,
  sales_target: SalesTargetWidget,
  pipeline_value: PipelineValueWidget,
};

export type { WidgetProps } from "./types";
