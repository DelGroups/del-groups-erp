"use client";

import React, { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  recordProductionCustomerPaymentAction,
  updateProductionLogisticsAction,
  updateProductionOrderAction,
  type ProductionLookups,
} from "@/lib/actions/production";
import ProductionInProgressPhase from "@/components/production/ProductionInProgressPhase";
import {
  calcProductionCosting,
  remainingBalanceFromOrder,
  type ProductionOrder,
  type ProductionStatus,
} from "@/lib/production/types";

interface Props {
  open: boolean;
  order: ProductionOrder;
  lookups: ProductionLookups | null;
  onClose: () => void;
  onUpdated: (order: ProductionOrder) => void;
  onCompleted: (order: ProductionOrder) => void;
}

const PHASE_TITLES: Record<ProductionStatus, string> = {
  Draft: "Qaralama — layihə məlumatları",
  "In-Progress": "İstehsalda — material və xərclər",
  Ready: "Çatdırılma və quraşdırma",
  Delivered: "Təhvil verildi — maliyyə yekunu",
};

export default function ProductionWorkflowModal({
  open,
  order,
  lookups,
  onClose,
  onUpdated,
  onCompleted,
}: Props) {
  const phase = order.status;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectName, setProjectName] = useState(order.project_name);
  const [customerId, setCustomerId] = useState(order.customer_id || "");
  const [notes, setNotes] = useState(order.notes || order.project_scope || "");
  const [totalPrice, setTotalPrice] = useState(order.total_project_price);

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

  const costing = useMemo(() => calcProductionCosting(order), [order]);
  const remaining = useMemo(() => remainingBalanceFromOrder(order), [order]);

  useEffect(() => {
    if (!open) return;
    setProjectName(order.project_name);
    setCustomerId(order.customer_id || "");
    setNotes(order.notes || order.project_scope || "");
    setTotalPrice(order.total_project_price);
    setDeliveryDate(order.expected_delivery_date || "");
    setShippingDate(order.shipping_date || "");
    setInstallStartDate(order.installation_start_date || "");
    setInstallerId(order.installer_id || order.ousta_id || "");
    setShippingCost(order.shipping_cost || 0);
    setInstallationCost(order.installation_cost || 0);
    setShippingPaidByCustomer(order.shipping_paid_by_customer === true);
    setInstallationPaidByCustomer(order.installation_paid_by_customer === true);
    setInstallAddress(order.installation_address || "");
    setInstallFloor(order.installation_floor || "");
    setHasElevator(order.has_elevator === true);
    setInstallNotes(order.installation_difficulty_notes || "");
    setPaymentAccountId(order.advance_account_id || "");
    setError(null);
  }, [open, order]);

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
      notes: notes.trim() || null,
      project_scope: notes.trim() || null,
    });
    setSaving(false);
    if (!result.success || !result.data) {
      setError(result.error || "Saxlanmadı");
      return;
    }
    onCompleted(result.data);
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
    onCompleted(result.data);
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
    onCompleted(result.data);
  };

  const modalWidth = phase === "In-Progress" ? "max-w-5xl" : "max-w-3xl";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
      <div className={`app-modal flex max-h-[90vh] w-full ${modalWidth} flex-col overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          <div>
            <h3 className="font-bold text-app">{order.order_no}</h3>
            <p className="text-xs text-app-muted">{PHASE_TITLES[phase]}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-app-card-hover">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error ? <p className="mb-3 rounded-lg alert-danger px-3 py-2 text-sm">{error}</p> : null}

          {phase === "Draft" ? (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-app-muted">Layihə adı</span>
                <input
                  className="input-field mt-1 w-full"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">Müştəri</span>
                <select
                  className="input-field mt-1 w-full"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">—</option>
                  {(lookups?.customers || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name || c.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">Layihə qiyməti</span>
                <input
                  type="number"
                  className="input-field mt-1 w-full"
                  value={totalPrice}
                  onChange={(e) => setTotalPrice(Number(e.target.value))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">Qeydlər</span>
                <textarea
                  className="input-field mt-1 w-full"
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveDraft()}>
                Saxla
              </button>
            </div>
          ) : null}

          {phase === "In-Progress" ? (
            <ProductionInProgressPhase
              order={order}
              lookups={lookups}
              saving={saving}
              setSaving={setSaving}
              setError={setError}
              onUpdated={onUpdated}
            />
          ) : null}

          {phase === "Ready" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="text-app-muted">Çatdırılma tarixi</span>
                <input type="date" className="input-field mt-1 w-full" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="text-app-muted">Göndərmə tarixi</span>
                <input type="date" className="input-field mt-1 w-full" value={shippingDate} onChange={(e) => setShippingDate(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="text-app-muted">Quraşdırma tarixi</span>
                <input type="date" className="input-field mt-1 w-full" value={installStartDate} onChange={(e) => setInstallStartDate(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="text-app-muted">Məsul usta</span>
                <select className="input-field mt-1 w-full" value={installerId} onChange={(e) => setInstallerId(e.target.value)}>
                  <option value="">—</option>
                  {(lookups?.employees || []).map((e) => (
                    <option key={e.id} value={e.id}>{e.full_name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-app-muted">Çatdırılma xərci</span>
                <input type="number" className="input-field mt-1 w-full" value={shippingCost} onChange={(e) => setShippingCost(Number(e.target.value))} />
              </label>
              <label className="text-sm">
                <span className="text-app-muted">Quraşdırma xərci</span>
                <input type="number" className="input-field mt-1 w-full" value={installationCost} onChange={(e) => setInstallationCost(Number(e.target.value))} />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={shippingPaidByCustomer} onChange={(e) => setShippingPaidByCustomer(e.target.checked)} />
                Çatdırılma müştəri ödəyir (əks halda şirkət ödəyir)
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={installationPaidByCustomer} onChange={(e) => setInstallationPaidByCustomer(e.target.checked)} />
                Quraşdırma müştəri ödəyir (əks halda şirkət ödəyir)
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="text-app-muted">Quraşdırma ünvanı</span>
                <input className="input-field mt-1 w-full" value={installAddress} onChange={(e) => setInstallAddress(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="text-app-muted">Mərtəbə</span>
                <input className="input-field mt-1 w-full" value={installFloor} onChange={(e) => setInstallFloor(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={hasElevator} onChange={(e) => setHasElevator(e.target.checked)} />
                Yük lifti var
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="text-app-muted">Quraşdırma çətinliyi / qeydlər</span>
                <textarea className="input-field mt-1 w-full" rows={3} value={installNotes} onChange={(e) => setInstallNotes(e.target.value)} />
              </label>
              <button type="button" className="btn-primary sm:col-span-2" disabled={saving} onClick={() => void saveLogistics()}>
                Logistika məlumatlarını saxla
              </button>
            </div>
          ) : null}

          {phase === "Delivered" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-app bg-app-card-hover p-3 text-sm">
                <p>Ümumi maya: <strong>{costing.totalCost.toFixed(2)} AZN</strong></p>
                <p>Layihə qiyməti: <strong>{costing.revenue.toFixed(2)} AZN</strong></p>
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
                <input
                  type="number"
                  className="input-field"
                  placeholder="Məbləğ"
                  value={paymentAmount || ""}
                  onChange={(e) => setPaymentAmount(Number(e.target.value))}
                />
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
