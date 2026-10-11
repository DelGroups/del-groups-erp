import { SaleDetailPage } from "@/modules/sales/pages";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SaleDetailPage saleId={id} />;
}
