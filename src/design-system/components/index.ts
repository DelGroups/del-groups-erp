/**
 * Design-system components of the new UI (prompt 15). Use them inside <DesignScope>; texts
 * come from the caller (src/i18n), never from here.
 */
export { DesignScope, useDesignScope, type DesignScopeProps } from "./DesignScope";
export { CommandPalette, type CommandPaletteProps, type CommandPaletteLabels, type PaletteAction } from "./CommandPalette";
export { ToastProvider, useToast } from "./Toast";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { Skeleton, SkeletonList } from "./Skeleton";
export { FileDropzone, type DropzoneLabels, type UploadFn } from "./FileDropzone";
export { TypeToConfirmDialog, type TypeToConfirmDialogProps, type TypeToConfirmLabels } from "./TypeToConfirmDialog";
export { MetricCard, DeltaChip, RingGauge, FunnelSteps, GoalProgress, CohortHeatmap, type MetricCardProps, type RingGaugeProps, type GaugeTone, type Goal, type Cohort, type FunnelLabels } from "./Stats";
export { CountUp, MetricsBand, type BandMetric } from "./CountUp";
export { ChartCard, type ChartCardProps, type ChartRange } from "./ChartCard";
// UI standard (UI-1, docs/ui-standard.md)
export { UiStandardProvider, useUiStandard } from "./UiStandard";
export { Truncate, type TruncateProps } from "./Truncate";
export { IconButton, type IconButtonProps } from "./IconButton";
export { Field, FormGrid, FieldRow, InlineGroup, Section, Card, Toolbar, type FieldProps, type FieldSpan, type SectionProps, type ToolbarProps } from "./Layout";
export { Chip, MoneyCell, NumberCell, DateCell, type ChipTone } from "./Cells";
export { DateField, DateTimeField, type DateFieldLabels, type ControlWidth } from "./DateField";
export { Combobox, type ComboboxProps, type ComboboxLabels, type ComboOption } from "./Combobox";
// DataGrid (UI-2, docs/ui-standard.md "Lists")
export { RowActionsMenu, type RowActionsMenuProps, type RowMenuItem } from "./RowActionsMenu";
export { DataGrid, type DataGridProps, type DataGridLabels, type GridColumn, type GridItem, type GridSelection } from "./DataGrid";
// Unified UI (UI-7 phase 2, docs/ui-standard.md): the UI rulebook's shared parts
export { Button, buttonClass, type ButtonProps, type ButtonVariant, type ButtonSize } from "./Button";
export { PageHeader, PageFrame, type PageHeaderProps, type PageFrameProps, type HeaderAction } from "./PageHeader";
export { PageChromeProvider, usePageChrome, useClaimCrumbs, type PageChromeValue, type PageChromeLabels, type ChromeCrumb } from "./PageChrome";
export { Breadcrumbs, type BreadcrumbsProps } from "./Breadcrumbs";
export { Tabs, SegmentedControl, type TabsProps, type TabItem, type SegmentedControlProps, type SegmentOption } from "./Tabs";
export { Dialog, Drawer, ConfirmDialog, type DialogProps, type DialogSize, type DrawerProps, type ConfirmDialogProps, type DialogLabels, type ConfirmDialogLabels } from "./Dialog";
export { FormSaveBar, useUnsavedChangesGuard, type FormSaveBarProps, type FormSaveBarLabels, type LeaveDialogLabels } from "./FormSaveBar";
export { ErrorState, LoadingState, type ErrorStateProps, type LoadingStateProps } from "./States";
