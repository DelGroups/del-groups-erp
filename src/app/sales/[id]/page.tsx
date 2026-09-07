import SaleDetailPageClient from "./page.client";

export const dynamic = "force-dynamic";

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SaleDetailPageClient saleId={id} />;
}
