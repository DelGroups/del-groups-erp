import type { EditControls } from "../WidgetFrame";
import type { WidgetDef } from "@/lib/home/registry";
import type { WidgetPlacement } from "@/lib/home/layout";

export interface WidgetProps {
  def: WidgetDef;
  placement: WidgetPlacement;
  editing: boolean;
  controls?: EditControls;
  /** Change this widget's settings (saved with the layout). */
  setSettings: (settings: Record<string, string>) => void;
  /** In the "Add widget" panel: a small preview without loading data. */
  preview?: boolean;
}

/** The frame's share of a widget's props. */
export function frameProps(p: WidgetProps) {
  return { def: p.def, editing: p.editing, controls: p.controls, size: p.placement.size };
}
