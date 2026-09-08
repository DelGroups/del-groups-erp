"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  addProductionExpenseAction,
  addProductionMaterialAction,
  addProductionOutsourcingAction,
  listPurchaseRequestsAction,
  recordProductionCustomerPaymentAction,
  updateProductionLogisticsAction,
  updateProductionOrderAction,
  type ProductionLookups,
} from "@/lib/actions/production";
import {
  PRODUCTION_EXPENSE_CATEGORIES,
  calcProductionCosting,
  remainingBalanceFromOrder,
  type ProductionExpenseCategory,
  type ProductionOrder,
  type ProductionStatus,
  type PurchaseRequest,
} from "@/lib/production/types";

type WorkflowTab = "materials" | "services" | "payments";

interface Props {
  open: boolean;
  order: ProductionOrder;
  lookups: ProductionLookups | null;
  focusStatus?: ProductionStatus | "payment";
  onClose: () => void;
  onSaved: (order: ProductionOrder) => void;
}

export default function ProductionWorkflowModal({
  open,
  order,
  lookups,
  focusStatus,
  onClose,
  onSaved,
}: Props) {
  const [tab, setTab] = useState<WorkflowTab>("materials");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);

  const [projectName, setProjectName] = useState(order.project_name);
  const [customerId, setCustomerId] = useState(order.customer_id || "");
  const [totalPrice, setTotalPrice] = useState(order.total_project_price);
  const [installationFee, setInstallationFee] = useState(order.installation_fee);

  const [materialProductId, setMaterialProductId] = useState("");
  const [materialWarehouseId, setMaterialWarehouseId] = useState("");
  const [materialQty, setMaterialQty] = useState(1);

  const [expenseCategory, setExpenseCategory] = useState<ProductionExpenseCategory>("other");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState(0);
  const [expenseAccountId, setExpenseAccountId] = useState("");

  const [outsourcingDesc, setOutsourcingDesc] = useState("");
  const [outsourcingQty, setOutsourcingQty] = useState(1);
  const [outsourcingPrice, setOutsourcingPrice] = useState(0);

  const [deliveryDate, setDeliveryDate] = useState(order.expected_delivery_date || "");
  const [shippingDate, setShippingDate] = useState(order.shipping_date || "");
  const [installStartDate, setInstallStartDate] = useState(order.installation_start_date || "");
  const [installerId, setInstallerId] = useState(order.installer_id || order.ousta_id || "");
  const [shippingCost, setShippingCost] = useState(order.shipping_cost || 0);
  const [installationCost, setInstallationCost] = useState(order.installation_cost || 0);
  const [shippingPaidByCustomer, setShippingPaidByCustomer] = useState(
    order.shipping_paid_by_customer === true
  );
  const [installationPaidByCustomer, setInstallationPaidByCustomer] = useState(
    order.installation_paid_by_customer === true
  );
  const [installAddress, setInstallAddress] = useState(order.installation_address || "");
  const [installFloor, setInstallFloor] = useState(order.installation_floor || "");
  const [hasElevator, setHasElevator] = useState(order.has_elevator === true);
  const [installNotes, setInstallNotes] = useState(order.installation_difficulty_notes || "");

  const [paymentAccountId, setPaymentAccountId] = useState(order.advance_account_id || "");
  const [paymentAmount, setPaymentAmount] = useState(0);

  const costing = calcProductionCosting(order);
  const remaining = remainingBalanceFromOrder(order);

  useEffect(() => {
    if (!open) return;
    void listPurchaseRequestsAction(order.id).then((result) => {
      if (result.success && result.data) setPurchaseRequests(result.data);
    });
  }, [open, order.id]);

  if (!open) return null;

  const saveDraft = async () => {
    setSaving(true);
    setError(null);
    const customer = lookups?.customers.find((row) => row.id === customerId);
    const result = await updateProductionOrderAction(order.id, {
      project_name: projectName.trim(),
      customer_id: customerId || null,
      customer_name: customer ? customer.full_name || customer.name || null : order.customer_name,
      total_project_price: totalPrice,
      installation_fee: installationFee,
    });
    setSaving(false);
    if (!result.success || !result.data) {
      setError(result.error || "Saxlanmadı");
      return;
    }
    onSaved(result.data);
    onClose();
  };

  const addMaterial = async () => {
    if (!materialProductId) {
      setError("Məhsul seçin");
      return;
    }
    setSaving(true);
    setError(null);
    const product = lookups?.products.find((row) => row.id === materialProductId);
    const warehouse = lookups?.warehouses.find((row) => row.id === materialWarehouseId);
    const result = await addProductionMaterialAction(order.id, {
      product_id: materialProductId,
      warehouse_id: materialWarehouseId || product?.warehouse_id || "",
      warehouse_name: warehouse?.name || null,
      quantity: materialQty,
      issue_now: true,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error || "Material əlavə edilmədi");
      return;
    }
    const pr = await listPurchaseRequestsAction(order.id);
    if (pr.success && pr.data) setPurchaseRequests(pr.data);
    if (result.data) onSaved(result.data);
  };

  const addExpense = async () => {
    setSaving(true);
    setError(null);
    const result = await addProductionExpenseAction(order.id, {
      category: expenseCategory,
      description: expenseDescription,
      amount: expenseAmount,
      account_id: expenseAccountId || null,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error || "Xərc əlavə edilmədi");
      return;
    }
    if (result.data) onSaved(result.data);
  };

  const addOutsourcing = async () => {
    setSaving(true);
    setError(null);
    const result = await addProductionOutsourcingAction(order.id, {
      material_description: outsourcingDesc,
      sqm_quantity: outsourcingQty,
      price_per_sqm: outsourcingPrice,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error || "Xidmət əlavə edilmədi");
      return;
    }
    if (result.data) onSaved(result.data);
  };

  const saveLogistics = async () => {
    setSaving(true);
    setError(null);
    const result = await updateProductionLogisticsAction(order.id, {
      expected_delivery_date: deliveryDate || null,
      shipping_date: shippingDate || null,
      installation_start_date: installStartDate || null,
      installer_id: installerId || null,
      shipping_cost: shippingCost,
      installation_cost: installationCost,
      shipping_paid_by_customer: shippingPaidByCustomer,
      installation_paid_by_customer: installationPaidByCustomer,
      installation_address: installAddress,
      installation_floor: installFloor,
      has_elevator: hasElevator,
      installation_difficulty_notes: installNotes,
    });
    setSaving(false);
    if (!result.success || !result.data) {
      setError(result.error || "Logistika saxlanmadı");
      return;
    }
    onSaved(result.data);
    onClose();
  };

  const savePayment = async () => {
    if (!paymentAccountId || paymentAmount <= 0) {
      setError("Hesab və məbləğ tələb olunur");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await recordProductionCustomerPaymentAction(order.id, {
      accountId: paymentAccountId,
      amount: paymentAmount,
    });
    setSaving(false);
    if (!result.success || !result.data) {
      setError(result.error || "Ödəniş qeydə alınmadı");
      return;
    }
    onSaved(result.data);
    onClose();
  };

  const showDraft = order.status === "Draft" || focusStatus === "Draft";
  const showProduction = order.status === "In-Progress" || focusStatus === "In-Progress";
  const showLogistics = order.status === "Ready" || focusStatus === "Ready";
  const showSettlement =
    order.status === "Delivered" || focusStatus === "payment" || focusStatus === "Delivered";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
      <div className="app-modal flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          <div>
            <h3 className="font-bold text-app">{order.order_no}</h3>
            <p className="text-xs text-app-muted">{order.project_name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-app-card-hover">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error ? <p className="mb-3 rounded-lg alert-danger px-3 py-2 text-sm">{error}</p> : null}

          {showDraft ? (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-app-muted">Layihə adı</span>
                <input className="input-field mt-1 w-full" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">Müştəri</span>
                <select className="input-field mt-1 w-full" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">—</option>
                  {(lookups?.customers || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name || c.name}</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-app-muted">Layihə büdcəsi</span>
                  <input type="number" className="input-field mt-1 w-full" value={totalPrice} onChange={(e) => setTotalPrice(Number(e.target.value))} />
                </label>
                <label className="block text-sm">
                  <span className="text-app-muted">Quraşdırma</span>
                  <input type="number" className="input-field mt-1 w-full" value={installationFee} onChange={(e) => setInstallationFee(Number(e.target.value))} />
                </label>
              </div>
              <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveDraft()}>
                Saxla
              </button>
            </div>
          ) : null}

          {showProduction ? (
            <div>
              <div className="mb-3 flex gap-2">
                {(["materials", "services", "payments"] as WorkflowTab[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`rounded px-3 py-1 text-xs font-semibold ${tab === key ? "bg-app-accent text-white" : "bg-app-card-hover text-app"}`}
                    onClick={() => setTab(key)}
                  >
                    {key === "materials" ? "Materiallar" : key === "services" ? "Xidmət / Xərc" : "Ödənişlər"}
                  </button>
                ))}
              </div>

              {tab === "materials" ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <select className="input-field" value={materialProductId} onChange={(e) => setMaterialProductId(e.target.value)}>
                      <option value="">Məhsul</option>
                      {(lookups?.products || []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <select className="input-field" value={materialWarehouseId} onChange={(e) => setMaterialWarehouseId(e.target.value)}>
                      <option value="">Anbar</option>
                      {(lookups?.warehouses || []).map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                    <input type="number" className="input-field" value={materialQty} onChange={(e) => setMaterialQty(Number(e.target.value))} />
                  </div>
                  <button type="button" className="btn-primary" disabled={saving} onClick={() => void addMaterial()}>
                    Material əlavə et
                  </button>
                  {purchaseRequests.length > 0 ? (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                      <p className="font-semibold text-amber-200">Satınalma tələbləri</p>
                      <ul className="mt-2 space-y-1 text-xs">
                        {purchaseRequests.map((row) => (
                          <li key={row.id}>
                            {row.request_no}: {row.product_name} — {row.quantity} {row.unit} ({row.status})
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === "services" ? (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="input-field" placeholder="Xarici xidmət təsviri" value={outsourcingDesc} onChange={(e) => setOutsourcingDesc(e.target.value)} />
                    <input type="number" className="input-field" placeholder="m²" value={outsourcingQty} onChange={(e) => setOutsourcingQty(Number(e.target.value))} />
                    <input type="number" className="input-field" placeholder="Qiymət / m²" value={outsourcingPrice} onChange={(e) => setOutsourcingPrice(Number(e.target.value))} />
                    <button type="button" className="btn-secondary" disabled={saving} onClick={() => void addOutsourcing()}>
                      Xarici xidmət əlavə et
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select className="input-field" value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value as ProductionExpenseCategory)}>
                      {PRODUCTION_EXPENSE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                    <input className="input-field" placeholder="Xərc təsviri" value={expenseDescription} onChange={(e) => setExpenseDescription(e.target.value)} />
                    <input type="number" className="input-field" placeholder="Məbləğ" value={expenseAmount} onChange={(e) => setExpenseAmount(Number(e.target.value))} />
                    <select className="input-field" value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)}>
                      <option value="">Hesab (ixtiyari)</option>
                      {(lookups?.accounts || []).map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                    <button type="button" className="btn-primary" disabled={saving} onClick={() => void addExpense()}>
                      Xərc əlavə et
                    </button>
                  </div>
                </div>
              ) : null}

              {tab === "payments" ? (
                <p className="text-sm text-app-muted">
                  Material və xidmət ödənişlərini &quot;Xidmət / Xərc&quot; bölməsində kassa hesabı ilə qeyd edin.
                </p>
              ) : null}
            </div>
          ) : null}

          {showLogistics ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm"><span className="text-app-muted">Təhvil tarixi</span><input type="date" className="input-field mt-1 w-full" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></label>
              <label className="text-sm"><span className="text-app-muted">Çatdırılma tarixi</span><input type="date" className="input-field mt-1 w-full" value={shippingDate} onChange={(e) => setShippingDate(e.target.value)} /></label>
              <label className="text-sm"><span className="text-app-muted">Quraşdırma başlanğıcı</span><input type="date" className="input-field mt-1 w-full" value={installStartDate} onChange={(e) => setInstallStartDate(e.target.value)} /></label>
              <label className="text-sm">
                <span className="text-app-muted">Usta</span>
                <select className="input-field mt-1 w-full" value={installerId} onChange={(e) => setInstallerId(e.target.value)}>
                  <option value="">—</option>
                  {(lookups?.employees || []).map((e) => (
                    <option key={e.id} value={e.id}>{e.full_name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm"><span className="text-app-muted">Çatdırılma xərci</span><input type="number" className="input-field mt-1 w-full" value={shippingCost} onChange={(e) => setShippingCost(Number(e.target.value))} /></label>
              <label className="text-sm"><span className="text-app-muted">Quraşdırma xərci</span><input type="number" className="input-field mt-1 w-full" value={installationCost} onChange={(e) => setInstallationCost(Number(e.target.value))} /></label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={shippingPaidByCustomer} onChange={(e) => setShippingPaidByCustomer(e.target.checked)} />
                Çatdırılma müştəri ödəyir
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={installationPaidByCustomer} onChange={(e) => setInstallationPaidByCustomer(e.target.checked)} />
                Quraşdırma müştəri ödəyir
              </label>
              <label className="text-sm sm:col-span-2"><span className="text-app-muted">Quraşdırma ünvanı</span><input className="input-field mt-1 w-full" value={installAddress} onChange={(e) => setInstallAddress(e.target.value)} /></label>
              <label className="text-sm"><span className="text-app-muted">Mərtəbə</span><input className="input-field mt-1 w-full" value={installFloor} onChange={(e) => setInstallFloor(e.target.value)} /></label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={hasElevator} onChange={(e) => setHasElevator(e.target.checked)} />
                Lift var
              </label>
              <label className="text-sm sm:col-span-2"><span className="text-app-muted">Quraşdırma qeydləri</span><textarea className="input-field mt-1 w-full" rows={3} value={installNotes} onChange={(e) => setInstallNotes(e.target.value)} /></label>
              <button type="button" className="btn-primary sm:col-span-2" disabled={saving} onClick={() => void saveLogistics()}>
                Logistika məlumatlarını saxla
              </button>
            </div>
          ) : null}

          {showSettlement ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-app bg-app-card-hover p-3 text-sm">
                <p>Ümumi maya: <strong>{costing.totalCost.toFixed(2)} AZN</strong></p>
                <p>Gəlir: <strong>{costing.revenue.toFixed(2)} AZN</strong></p>
                <p>Ödənilən: <strong>{order.advance_payment.toFixed(2)} AZN</strong></p>
                <p>Qalıq: <strong className="text-rose-400">{remaining.toFixed(2)} AZN</strong></p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <select className="input-field" value={paymentAccountId} onChange={(e) => setPaymentAccountId(e.target.value)}>
                  <option value="">Hesab</option>
                  {(lookups?.accounts || []).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <input type="number" className="input-field" placeholder="Məbləğ" value={paymentAmount || ""} onChange={(e) => setPaymentAmount(Number(e.target.value))} />
              </div>
              <button type="button" className="btn-primary" disabled={saving} onClick={() => void savePayment()}>
                Müştəri ödənişi qeyd et
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
