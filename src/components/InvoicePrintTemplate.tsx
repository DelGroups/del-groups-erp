import React from 'react';

interface InvoiceItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface InvoiceData {
  invoice_number: string;
  date: string;
  customer_name: string;
  customer_phone?: string;
  warehouse_name?: string;
  items: InvoiceItem[];
  total_amount: number;
  paid_amount: number;
  remaining_debt: number;
}

interface PrintTemplateProps {
  invoice: InvoiceData;
}

export const InvoicePrintTemplate = React.forwardRef<HTMLDivElement, PrintTemplateProps>(
  ({ invoice }, ref) => {
    return (
      <div ref={ref} className="hidden print:block p-8 bg-white text-black font-sans w-[210mm] min-h-[297mm] mx-auto">
        {/* هدر فاکتور / مشخصات شرکت */}
        <div className="flex justify-between items-start border-b-2 pb-6 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-wider">DEL GROUPS</h1>
            <p className="text-sm text-gray-600 mt-1">İstehsalat, Dizayn və Satış Mərkəzi</p>
            <p className="text-xs text-gray-500">Bakı, Azərbaycan</p>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold text-gray-800">SATIŞ FAKTURASI</h2>
            <p className="text-sm font-semibold mt-1">Sənəd №: <span className="text-blue-600">{invoice.invoice_number}</span></p>
            <p className="text-xs text-gray-500">Tarix: {invoice.date}</p>
          </div>
        </div>

        {/* اطلاعات مشتری و انبار */}
        <div className="grid grid-cols-2 gap-4 mb-6 bg-gray-50 p-4 rounded-lg border">
          <div>
            <p className="text-xs text-gray-500 uppercase">Müştəri:</p>
            <p className="font-bold text-gray-900">{invoice.customer_name}</p>
            {invoice.customer_phone && <p className="text-sm text-gray-700">Tel: {invoice.customer_phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase">Anbar:</p>
            <p className="font-semibold text-gray-800">{invoice.warehouse_name || 'Əsas Anbar'}</p>
          </div>
        </div>

        {/* جدول اقلام فاکتور */}
        <table className="w-full mb-6 border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-800 text-left text-xs uppercase text-gray-700">
              <th className="py-2 px-3">№</th>
              <th className="py-2 px-3">Məhsulun Adı</th>
              <th className="py-2 px-3 text-center">Miqdar</th>
              <th className="py-2 px-3 text-right">Qiymət (AZN)</th>
              <th className="py-2 px-3 text-right">Cəmi (AZN)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 text-sm">
            {invoice.items?.map((item, index) => (
              <tr key={index}>
                <td className="py-3 px-3 text-gray-500">{index + 1}</td>
                <td className="py-3 px-3 font-medium text-gray-900">{item.product_name}</td>
                <td className="py-3 px-3 text-center">{item.quantity}</td>
                <td className="py-3 px-3 text-right">{Number(item.unit_price).toFixed(2)}</td>
                <td className="py-3 px-3 text-right font-semibold">{Number(item.total_price).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* بخش جمع نهایی و تسویه حساب */}
        <div className="flex justify-end mb-12">
          <div className="w-64 space-y-2 border-t pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Yekun Məbləğ:</span>
              <span className="font-bold">{Number(invoice.total_amount).toFixed(2)} AZN</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Ödənilən:</span>
              <span className="font-semibold text-green-600">{Number(invoice.paid_amount).toFixed(2)} AZN</span>
            </div>
            <div className="flex justify-between text-sm border-t pt-2">
              <span className="text-gray-600 font-semibold">Qalıq Borc:</span>
              <span className="font-bold text-red-600">{Number(invoice.remaining_debt).toFixed(2)} AZN</span>
            </div>
          </div>
        </div>

        {/* امضا و مهر */}
        <div className="grid grid-cols-2 gap-8 mt-20 pt-8 border-t text-center text-sm">
          <div>
            <p className="text-gray-500 mb-12">Təhvil verdi (Satıcı)</p>
            <p className="font-semibold border-t border-dashed pt-1 w-48 mx-auto">İmza</p>
          </div>
          <div>
            <p className="text-gray-500 mb-12">Təhvil aldı (Müştəri)</p>
            <p className="font-semibold border-t border-dashed pt-1 w-48 mx-auto">İmza</p>
          </div>
        </div>
      </div>
    );
  }
);

InvoicePrintTemplate.displayName = 'InvoicePrintTemplate';