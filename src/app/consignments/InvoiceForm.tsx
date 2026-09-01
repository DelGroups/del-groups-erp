"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  Plus,
  Trash2,
  Save,
  X,
  Search,
  CreditCard,
  Truck,
  Building,
  UserCheck,
  UserPlus,
} from "lucide-react";
import ResponsiblePersonField from "@/components/documents/ResponsiblePersonField";
import { useResponsiblePerson } from "@/hooks/useResponsiblePerson";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { useI18n } from "@/i18n/I18nProvider";

interface InvoiceFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface ProductRow {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  warehouse_id: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  total: number;
  extra_info: string;
}

interface PaymentRow {
  id: string;
  account_id: string;
  method: string;
  amount: number;
}

export default function UniversalInvoiceForm({
  isOpen,
  onClose,
  onSuccess,
}: InvoiceFormProps) {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [docNo] = useState("SS-2026-77154");
  const [docDate, setDocDate] = useState(new Date().toISOString().split("T")[0]);

  const [customers, setCustomers] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [productsList, setProductsList] = useState<any[]>([]);

  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [selectedSellerId, setSelectedSellerId] = useState("");
  const [defaultWarehouseId, setDefaultWarehouseId] = useState("");

  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryType, setDeliveryType] = useState<"paid" | "free">("free");
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [notes, setNotes] = useState("");

  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    full_name: "",
    phone: "",
    address: "",
    voen: "",
  });

  const [items, setItems] = useState<ProductRow[]>([
    {
      id: "1",
      product_id: "",
      product_code: "",
      product_name: "",
      warehouse_id: "",
      quantity: 1,
      unit: "Ədəd",
      unit_price: 0,
      discount_percent: 0,
      total: 0,
      extra_info: "",
    },
  ]);

  const [payments, setPayments] = useState<PaymentRow[]>([
    { id: "1", account_id: "", method: "Nağd Kassa", amount: 0 },
  ]);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchInitialData();
    }
  }, [isOpen]);

  const fetchInitialData = async () => {
    const { data: cust } = await supabase.from("customers").select("*");
    if (cust) setCustomers(cust);

    const { data: emp } = await supabase.from("employees").select("*");
    if (emp) setEmployees(emp);

    const { data: wh } = await supabase.from("warehouses").select("*");
    if (wh) {
      setWarehouses(wh);
      if (wh.length > 0) setDefaultWarehouseId(wh[0].id);
    }

    const { data: acc } = await supabase.from("accounts").select("*");
    if (acc) {
      setAccounts(acc);
      if (acc.length > 0) {
        setPayments([{ id: "1", account_id: String((acc[0] as { id?: string }).id ?? ""), method: String((acc[0] as { name?: string }).name ?? ""), amount: 0 }]);
      }
    }

    const { data: prod } = await supabase.from("products").select("*");
    if (prod) setProductsList(prod);
  };

  const handleCustomerChange = (id: string) => {
    setSelectedCustomerId(id);
    const cust = customers.find((c) => c.id === id);
    setSelectedCustomer(cust || null);
    if (cust && cust.address) setDeliveryAddress(cust.address);
  };

  const handleSaveQuickCustomer = async () => {
    if (!newCustomerData.full_name) {
      showError("Zəhmət olmasa müştəri adını daxil edin!");
      return;
    }

    const { data, error } = await supabase
      .from("customers")
      .insert([{ full_name: newCustomerData.full_name, name: newCustomerData.full_name, phone: newCustomerData.phone, address: newCustomerData.address, voen: newCustomerData.voen }])
      .select().single();

    if (!error && data) {
      setCustomers((prev) => [...prev, data]);
      handleCustomerChange(data.id);
      setShowAddCustomer(false);
      setNewCustomerData({ full_name: "", phone: "", address: "", voen: "" });
    }
  };

  const handleItemChange = (id: string, field: keyof ProductRow, value: any) => {
    setItems((prev) =>
      prev.map((row) => {
        if (row.id === id) {
          const updated = { ...row, [field]: value };
          const qty = Number(updated.quantity) || 0;
          const price = Number(updated.unit_price) || 0;
          const disc = Number(updated.discount_percent) || 0;
          updated.total = (qty * price) - (qty * price * (disc / 100));
          return updated;
        }
        return row;
      })
    );
  };

  const addRow = () => {
    setItems((prev) => [
      ...prev,
      { id: Date.now().toString(), product_id: "", product_code: "", product_name: "", warehouse_id: defaultWarehouseId, quantity: 1, unit: "Ədəd", unit_price: 0, discount_percent: 0, total: 0, extra_info: "" }
    ]);
  };

  const removeRow = (id: string) => {
    if (items.length > 1) setItems((prev) => prev.filter((r) => r.id !== id));
  };

  const addPaymentRow = () => {
    setPayments((prev) => [...prev, { id: Date.now().toString(), account_id: accounts[0]?.id || "", method: accounts[0]?.name || "Nəğd", amount: 0 }]);
  };

  const removePaymentRow = (id: string) => {
    if (payments.length > 1) setPayments((prev) => prev.filter((p) => p.id !== id));
  };

  const subTotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const totalDiscount = items.reduce((sum, item) => sum + (item.quantity * item.unit_price * (item.discount_percent / 100)), 0);
  const deliveryCost = deliveryType === "paid" ? Number(deliveryFee) || 0 : 0;
  const grandTotal = subTotal - totalDiscount + deliveryCost;
  const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const { locked: sellerLocked, lockedEmployeeId } = useResponsiblePerson(employees);
  const effectiveSellerId = sellerLocked ? lockedEmployeeId : selectedSellerId;

  const handleSellerChange = (employeeId: string) => {
    setSelectedSellerId(employeeId);
  };

  const handleSubmit = async () => {
    if (!selectedCustomerId) {
      showError("Zəhmət olmasa müştəri seçin!");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("post_sale", {
        p_customer_id: selectedCustomerId,
        p_warehouse_id: defaultWarehouseId,
        p_seller_id: effectiveSellerId || null,
        p_items: items,
        p_payments: payments,
        p_paid_amount: totalPaid,
        p_delivery_address: deliveryAddress,
        p_delivery_fee: deliveryCost,
        p_notes: notes,
      });

      if (error) throw error;

      showSuccess("Faktura uğurla yadda saxlanıldı!");
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      showError(formatRpcError(err.message, t));
    }
    setSaving(false);
  };

  if (!isOpen) return null;

  return (
    <>
    <div className="fixed inset-0 app-scrim z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-app-card-hover rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto border border-app p-6 space-y-4">
        
        {/* Header Modal */}
        <div className="flex justify-between items-center bg-app-card p-3 rounded-xl shadow-sm border border-app">
          <div className="flex items-center gap-4 text-xs font-semibold">
            <span className="text-sm font-bold text-app">Yeni Satış Fakturası Tərtibi</span>
            <span className="text-app-accent">({docNo})</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-app-muted hover:text-app-muted">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Seller & Customer Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-app-card p-4 rounded-xl shadow-sm border border-app text-xs space-y-2">
            <h3 className="font-bold text-app flex items-center gap-1.5 border-b pb-2">
              <Building className="w-4 h-4 text-app-accent" /> SATIŞI EDƏN (SATIŞ MENECERİ)
            </h3>
            <ResponsiblePersonField
              employees={employees}
              value={effectiveSellerId}
              onChange={handleSellerChange}
            />
          </div>

          <div className="bg-app-card p-4 rounded-xl shadow-sm border border-app text-xs space-y-2">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-app flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-app-accent" /> MÜŞTƏRİ MƏLUMATLARI
              </h3>
              <button type="button" onClick={() => setShowAddCustomer(!showAddCustomer)} className="text-app-accent font-bold flex items-center gap-1 text-[11px]">
                <UserPlus className="w-3.5 h-3.5" /> + Yeni Müştəri
              </button>
            </div>

            {showAddCustomer && (
              <div className="bg-[color:var(--app-accent-soft)]/80 p-2.5 rounded-lg border border-[color:var(--app-accent-ring)] space-y-2">
                <input type="text" placeholder="Ad / Şirkət *" value={newCustomerData.full_name} onChange={(e) => setNewCustomerData({ ...newCustomerData, full_name: e.target.value })} className="w-full p-1.5 border rounded text-xs" />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowAddCustomer(false)} className="px-2 py-1 text-app-muted bg-app-card border rounded">Ləğv et</button>
                  <button type="button" onClick={handleSaveQuickCustomer} className="px-3 py-1 bg-[image:var(--app-gradient)] text-white rounded font-bold">Yadda Saxla</button>
                </div>
              </div>
            )}

            <select value={selectedCustomerId} onChange={(e) => handleCustomerChange(e.target.value)} className="w-full p-2 border rounded-lg bg-app-card-hover font-semibold">
              <option value="">-- Müştərini Seçin --</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name || c.name}</option>)}
            </select>
          </div>
        </div>

        {/* Product Table */}
        <div className="bg-app-card rounded-xl shadow-sm border border-app overflow-hidden">
          <div className="app-toolbar px-4 py-2.5 flex justify-between items-center text-xs font-bold">
            <span>FAKTURA QALIBI VƏ MƏHSUL SİYAHISI</span>
            <button onClick={addRow} className="bg-[image:var(--app-gradient)] hover:brightness-110 text-white px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Sətir Əlavə Et
            </button>
          </div>

          <table className="w-full text-left text-xs">
            <thead className="bg-app-card-hover text-app font-bold uppercase border-b">
              <tr>
                <th className="p-2.5 w-8">№</th>
                <th className="p-2.5">MƏHSULUN ADI</th>
                <th className="p-2.5 w-32">ANBAR</th>
                <th className="p-2.5 w-20">MİQDAR</th>
                <th className="p-2.5 w-24">QİYMƏT</th>
                <th className="p-2.5 w-20">ENDİRİM %</th>
                <th className="p-2.5 w-32">MƏLUMAT</th>
                <th className="p-2.5 w-24 text-right">CƏMİ</th>
                <th className="p-2.5 w-10">SİL</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((row, idx) => (
                <tr key={row.id}>
                  <td className="p-2.5 font-mono text-app-muted">{idx + 1}</td>
                  <td className="p-2.5">
                    <select value={row.product_id} onChange={(e) => {
                      const prod = productsList.find((p) => p.id === e.target.value);
                      if (prod) {
                        handleItemChange(row.id, "product_id", prod.id);
                        handleItemChange(row.id, "unit_price", prod.sell_price || 0);
                      }
                    }} className="w-full p-1 border rounded">
                      <option value="">-- Seçin --</option>
                      {productsList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td className="p-2.5">
                    <select value={row.warehouse_id || defaultWarehouseId} onChange={(e) => handleItemChange(row.id, "warehouse_id", e.target.value)} className="w-full p-1 border rounded">
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </td>
                  <td className="p-2.5"><input type="number" value={row.quantity} onChange={(e) => handleItemChange(row.id, "quantity", e.target.value)} className="w-full p-1 border rounded text-center" /></td>
                  <td className="p-2.5"><input type="number" value={row.unit_price} onChange={(e) => handleItemChange(row.id, "unit_price", e.target.value)} className="w-full p-1 border rounded" /></td>
                  <td className="p-2.5"><input type="number" value={row.discount_percent} onChange={(e) => handleItemChange(row.id, "discount_percent", e.target.value)} className="w-full p-1 border rounded text-amber-600" /></td>
                  <td className="p-2.5"><input type="text" placeholder="Qeyd..." value={row.extra_info} onChange={(e) => handleItemChange(row.id, "extra_info", e.target.value)} className="w-full p-1 border rounded" /></td>
                  <td className="p-2.5 text-right font-bold">{row.total.toFixed(2)} AZN</td>
                  <td className="p-2.5 text-center"><button onClick={() => removeRow(row.id)} className="text-app-muted hover:text-rose-600"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer Actions & Totals */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="bg-app-card p-4 rounded-xl shadow-sm border border-app text-xs space-y-2">
            <h4 className="font-bold text-app flex items-center gap-1.5 border-b pb-2"><CreditCard className="w-4 h-4 text-app-accent" /> ÖDƏNİŞ (ÇOXLU ÖDƏNİŞ)</h4>
            {payments.map((p) => (
              <div key={p.id} className="flex gap-2">
                <select value={p.account_id} onChange={(e) => setPayments(payments.map(x => x.id === p.id ? { ...x, account_id: e.target.value } : x))} className="w-1/2 p-1 border rounded">
                  {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                </select>
                <input type="number" placeholder="Məbləğ" value={p.amount} onChange={(e) => setPayments(payments.map(x => x.id === p.id ? { ...x, amount: parseFloat(e.target.value) || 0 } : x))} className="w-1/2 p-1 border rounded text-right font-bold" />
              </div>
            ))}
          </div>

          <div className="app-toolbar p-4 rounded-xl shadow-sm text-xs space-y-3 flex flex-col justify-between">
            <div className="flex justify-between items-center text-sm font-bold border-b border-white/20 pb-2">
              <span>YEKUN MƏBLƏĞ:</span>
              <span className="text-lg text-emerald-400 font-mono">{grandTotal.toFixed(2)} AZN</span>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 hover:bg-white/20">Ləğv et</button>
              <button type="button" onClick={handleSubmit} disabled={saving} className="px-5 py-2 bg-[image:var(--app-gradient)] hover:brightness-110 text-white font-bold rounded-lg flex items-center gap-1">
                <Save className="w-4 h-4" /> {saving ? "Yadda saxlanılır..." : "Təsdiqlə və Yadda Saxla"}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
    <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}