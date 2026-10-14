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
