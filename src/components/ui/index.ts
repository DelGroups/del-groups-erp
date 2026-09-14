/**
 * Gentelella ERP — unified UI component library.
 * Import from `@/components/ui` for all new pages and features.
 */

export { Button, buttonVariants, type ButtonProps, type ButtonAppearance, type ButtonColor } from "./button";
export { default as Input, FIELD_CLASS, type InputProps } from "./input";
export { default as Select, type SelectProps } from "./select";
export { default as SelectBox, type SelectBoxProps } from "./select-box";
export { Checkbox, type CheckboxProps } from "./checkbox";
export { Radio, type RadioProps } from "./radio";
export { FormLabel, type FormLabelProps } from "./form-label";
export { ErrorMessage } from "./error-message";
export { FormField, type FormFieldProps } from "./form-field";
export * from "./form-field-styles";

export { Card, CardHeader, CardTitle, CardContent, CardFooter, CardMeta, cardShellClass } from "./card";
export { Panel, panelShellClass, type PanelProps } from "./panel";

export { DataTable, type DataTableColumn, type DataTableProps } from "./data-table";
export {
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  TableWrap,
  TablePagination,
  DataTableLayout,
  BulkActionBar,
} from "./table";
export { Pagination, type PaginationProps } from "./pagination";
export { TableRowActionsMenu, type TableRowActionItem } from "./table-row-actions-menu";

export { Badge, badgeVariants, type BadgeVariant } from "./badge";
export { Alert, alertVariants } from "./alert";
export { Modal, type ModalProps } from "./modal";
export { default as ToastMessage } from "./ToastMessage";
