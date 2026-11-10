import type { ConfirmDialogLabels, DialogLabels, FormSaveBarLabels, LeaveDialogLabels } from "@/design-system/components";

type T = (key: string, params?: Record<string, string | number>) => string;

/*
 * Texts of the unified UI's shared parts (UI-7, group uiUnified) in the current language. The
 * design-system components take their texts from the caller; pages pass these.
 */

/** Dialog and Drawer: the close button. */
export function dialogLabels(t: T): DialogLabels {
  return { close: t("uiUnified.dialog.close") };
}

/**
 * ConfirmDialog. `confirm` is the action itself, a verb and the object ("Delete invoice"): it
 * comes from the page, never a generic "OK" (ACT-6).
 */
export function confirmDialogLabels(t: T, confirm: string): ConfirmDialogLabels {
  return { close: t("uiUnified.dialog.close"), cancel: t("uiUnified.dialog.cancel"), working: t("uiUnified.dialog.working"), confirm };
}

/** FormSaveBar. */
export function saveBarLabels(t: T): FormSaveBarLabels {
  return {
    unsaved: t("uiUnified.saveBar.unsaved"),
    discard: t("uiUnified.saveBar.discard"),
    save: t("uiUnified.saveBar.save"),
    saving: t("uiUnified.saveBar.saving"),
  };
}

/** useUnsavedChangesGuard's dialog. */
export function leaveDialogLabels(t: T): LeaveDialogLabels {
  return {
    title: t("uiUnified.leave.title"),
    body: t("uiUnified.leave.body"),
    stay: t("uiUnified.leave.stay"),
    leave: t("uiUnified.leave.leave"),
    close: t("uiUnified.dialog.close"),
  };
}

/** ErrorState and LoadingState. */
export function stateLabels(t: T): { loading: string; errorTitle: string; errorBody: string; retry: string } {
  return {
    loading: t("uiUnified.states.loading"),
    errorTitle: t("uiUnified.states.errorTitle"),
    errorBody: t("uiUnified.states.errorBody"),
    retry: t("uiUnified.states.retry"),
  };
}
