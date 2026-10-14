import { SaleDetailPage } from "@/modules/sales/pages";
import { isNewUiEnabled } from "@/lib/features/newUi";
import SaleNewUiSwitch from "./page.client";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // NEW_UI off (production): exactly the classic detail page.
  if (!isNewUiEnabled()) return <SaleDetailPage saleId={id} />;
  return <SaleNewUiSwitch id={id} />;
}
