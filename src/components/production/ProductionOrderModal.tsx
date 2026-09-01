"use client";

import React, { useDeferredValue, useMemo, useState } from "react";
import {
  Boxes,
  BriefcaseBusiness,
  Calculator,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  PackagePlus,
  Plus,
  ScanBarcode,
  Trash2,
  X,
} from "lucide-react";
import { assertPaymentAccountId } from "@/lib/forms/paymentValidation";
import {
  createProductionOrderAction,
  type ProductionLookups,
} from "@/lib/actions/production";
import QuickAddProductModal from "@/components/purchases/QuickAddProductModal";
import QuickAddSupplierModal from "@/components/purchases/QuickAddSupplierModal";
import QuickAddCustomerModal from "@/components/customers/QuickAddCustomerModal";
import QuickAddEmployeeModal from "@/components/employees/QuickAddEmployeeModal";
import {
  legacyFromProductionModel,
  PRODUCTION_MODEL_DEFAULT,
  PRODUCTION_MODEL_LABELS,
  type ProductionModel,
} from "@/lib/production/models";
import {
  DEFAULT_CONTRACTOR_COMMISSION,
  PRODUCTION_EXPENSE_CATEGORIES,
  type ProductionExpenseCategory,
  type ProductionOrder,
} from "@/lib/production/types";
import type { Customer, Employee, Product, Supplier } from "@/types/database.types";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";

type QuickAddTarget =
  | "finished"
  | "material"
  | "customer"
  | "ousta"
  | "subcontractor"
  | null;

type Step = "project" | "materials" | "expenses" | "summary";

interface DraftMaterial {
  key: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  unitCost: number;
  stageNo: number;
}

interface DraftExpense {
  key: string;
  category: ProductionExpenseCategory;
  description: string;
  amount: number;
  accountId: string;
}

interface DraftOutsourcing {
  key: string;
  description: string;
  supplierId: string;
  quantity: number;
  unitCost: number;
}

interface Props {
  open: boolean;
  lookups: ProductionLookups | null;
  onClose: () => void;
  onCreated: (order: ProductionOrder) => void;
}

const STEPS: { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: "project", label: "Layihə məlumatları", icon: <BriefcaseBusiness className="h-4 w-4" /> },
  { id: "materials", label: "Material və mexanizmlər", icon: <Boxes className="h-4 w-4" /> },
  { id: "expenses", label: "Yan xərclər", icon: <CircleDollarSign className="h-4 w-4" /> },
  { id: "summary", label: "Yekun və maliyyə", icon: <Calculator className="h-4 w-4" /> },
];

function key() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function customerLabel(customer: ProductionLookups["customers"][number]) {
  return customer.full_name || customer.name || customer.company_name || "";
}

function productLabel(product: Product) {
  return `${product.code || "—"} · ${product.name}`;
}

function money(value: number) {
  return `${Number(value || 0).toFixed(2)} AZN`;
}

export default function ProductionOrderModal({ open, lookups, onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>("project");
  const [productionModel, setProductionModel] = useState<ProductionModel>(PRODUCTION_MODEL_DEFAULT);
  const [projectName, setProjectName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [oustaId, setOustaId] = useState("");
  const [subcontractorId, setSubcontractorId] = useState("");
  const [subcontractorFeePercent, setSubcontractorFeePercent] = useState(DEFAULT_CONTRACTOR_COMMISSION);
  const [finishedProductId, setFinishedProductId] = useState("");
  const [rawMaterialWarehouseId, setRawMaterialWarehouseId] = useState("");
  const [furnitureWarehouseId, setFurnitureWarehouseId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [scope, setScope] = useState("");
  const [notes, setNotes] = useState("");
  const [totalPrice, setTotalPrice] = useState(0);
  const [installationFee, setInstallationFee] = useState(0);
  const [advance, setAdvance] = useState(0);
  const [advanceAccountId, setAdvanceAccountId] = useState("");
  const [materials, setMaterials] = useState<DraftMaterial[]>([]);
  const [expenses, setExpenses] = useState<DraftExpense[]>([]);
  const [outsourcing, setOutsourcing] = useState<DraftOutsourcing[]>([]);
  const [materialProductId, setMaterialProductId] = useState("");
  const [materialQty, setMaterialQty] = useState(1);
  const [materialWarehouseId, setMaterialWarehouseId] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [expenseCategory, setExpenseCategory] =
    useState<ProductionExpenseCategory>("transport");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState(0);
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [outDescription, setOutDescription] = useState("");
  const [outSupplierId, setOutSupplierId] = useState("");
  const [outQty, setOutQty] = useState(1);
  const [outCost, setOutCost] = useState(0);
  const [quickAddTarget, setQuickAddTarget] = useState<QuickAddTarget>(null);
  const [localProducts, setLocalProducts] = useState<Product[]>([]);
  const [localCustomers, setLocalCustomers] = useState<Customer[]>([]);
  const [localEmployees, setLocalEmployees] = useState<Employee[]>([]);
  const [localSuppliers, setLocalSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const deferredMaterialSearch = useDeferredValue(materialSearch);

  const customers = useMemo(() => {
    const byId = new Map<string, Customer>();
    for (const row of [...(lookups?.customers || []), ...localCustomers]) byId.set(row.id, row);
    return [...byId.values()];
  }, [localCustomers, lookups?.customers]);

  const employees = useMemo(() => {
    const byId = new Map<string, Employee>();
    for (const row of [...(lookups?.employees || []), ...localEmployees]) byId.set(row.id, row);
    return [...byId.values()];
  }, [localEmployees, lookups?.employees]);

  const suppliers = useMemo(() => {
    const byId = new Map<string, Supplier>();
    for (const row of [...(lookups?.suppliers || []), ...localSuppliers]) byId.set(row.id, row);
    return [...byId.values()];
  }, [localSuppliers, lookups?.suppliers]);

  const isSeries = productionModel === "series";
  const isSubcontractor = productionModel === "subcontractor_custom";

  const products = useMemo(() => {
    const byId = new Map<string, Product>();
    for (const product of [...(lookups?.products || []), ...localProducts]) byId.set(product.id, product);
    return [...byId.values()];
  }, [localProducts, lookups?.products]);
  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );
  const warehousesById = useMemo(
    () => new Map((lookups?.warehouses || []).map((warehouse) => [warehouse.id, warehouse])),
    [lookups?.warehouses]
  );
  const selectedMaterialProduct = productsById.get(materialProductId);
  const filteredProducts = useMemo(() => {
    const query = deferredMaterialSearch.trim().toLocaleLowerCase();
    if (!query) return products.slice(0, 100);
    return products
      .filter((product) =>
        [product.name, product.code, product.barcode, product.category]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(query))
      )
      .slice(0, 100);
  }, [deferredMaterialSearch, products]);

  const costing = useMemo(() => {
    const materialCost = materials.reduce(
      (sum, item) => sum + item.quantity * item.unitCost,
      0
    );
    const outsourcingCost = outsourcing.reduce(
      (sum, item) => sum + item.quantity * item.unitCost,
      0
    );
    const sideExpenseCost = expenses.reduce((sum, item) => sum + item.amount, 0);
    const contractorFee = isSubcontractor ? (totalPrice * subcontractorFeePercent) / 100 : 0;
    const totalCost = materialCost + outsourcingCost + sideExpenseCost + contractorFee;
    const revenue = totalPrice + installationFee;
    const profit = revenue - totalCost;
    return {
      materialCost,
      outsourcingCost,
      sideExpenseCost,
      contractorFee,
      totalCost,
      revenue,
      profit,
      margin: revenue > 0 ? (profit / revenue) * 100 : 0,
    };
  }, [
    expenses,
    installationFee,
    isSubcontractor,
    materials,
    outsourcing,
    subcontractorFeePercent,
    totalPrice,
  ]);
  const {
    materialCost,
    outsourcingCost,
    sideExpenseCost,
    contractorFee,
    totalCost,
    revenue,
    profit,
    margin,
  } = costing;

  const reset = () => {
    setStep("project");
    setProductionModel(PRODUCTION_MODEL_DEFAULT);
    setProjectName("");
    setCustomerId("");
    setOustaId("");
    setSubcontractorId("");
    setSubcontractorFeePercent(DEFAULT_CONTRACTOR_COMMISSION);
    setFinishedProductId("");
    setRawMaterialWarehouseId("");
    setFurnitureWarehouseId("");
    setWarehouseId("");
    setQuantity(1);
    setDeliveryDate("");
    setScope("");
    setNotes("");
    setTotalPrice(0);
    setInstallationFee(0);
    setAdvance(0);
    setMaterials([]);
    setExpenses([]);
    setOutsourcing([]);
    setAdvanceAccountId("");
    setError(null);
    setScanMessage(null);
  };

  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const addProduct = (product: Product, scanned = false) => {
    setMaterials((current) => {
      const existing = current.find(
        (item) =>
          item.productId === product.id &&
          item.warehouseId === (materialWarehouseId || rawMaterialWarehouseId || warehouseId || product.warehouse_id || "")
      );
      if (existing) {
        return current.map((item) =>
          item.key === existing.key
            ? { ...item, quantity: item.quantity + Math.max(1, materialQty) }
            : item
        );
      }
      return [
        ...current,
        {
          key: key(),
          productId: product.id,
          warehouseId: materialWarehouseId || rawMaterialWarehouseId || warehouseId || product.warehouse_id || "",
          quantity: Math.max(0.001, materialQty),
          unitCost: Number(product.buy_price) || 0,
          stageNo: 1,
        },
      ];
    });
    setMaterialProductId("");
    setMaterialQty(1);
    setMaterialSearch("");
    if (scanned) {
      setStep("materials");
      setScanMessage(`${product.name} əlavə edildi · stok ${Number(product.stock || 0)}`);
      window.setTimeout(() => setScanMessage(null), 3500);
    }
  };

  useBarcodeScanner(
    (barcode) => {
      const normalized = barcode.trim().toLocaleLowerCase();
      const product = products.find(
        (item) =>
          item.barcode?.trim().toLocaleLowerCase() === normalized ||
          item.code?.trim().toLocaleLowerCase() === normalized
      );
      if (!product) {
        setScanMessage(`Barkod tapılmadı: ${barcode}`);
        window.setTimeout(() => setScanMessage(null), 3500);
        return;
      }
      addProduct(product, true);
    },
    { enabled: open && !quickAddTarget }
  );

  if (!open) return null;

  const currentStep = STEPS.findIndex((item) => item.id === step);
  const canContinue =
    step !== "project" ||
    Boolean(projectName.trim()) ||
    (isSeries && Boolean(finishedProductId));

  const applyBom = (bomId: string) => {
    const bom = lookups?.boms.find((item) => item.id === bomId);
    if (!bom) return;
    setFinishedProductId(bom.finished_product_id);
    const next = bom.items.map((item) => ({
      key: key(),
      productId: item.product_id,
      warehouseId: item.warehouse_id || warehouseId,
      quantity: Number(item.quantity || 0) * Math.max(1, quantity),
      unitCost: Number(item.unit_cost || 0),
      stageNo: 1,
    }));
    setMaterials(next);
    if (!projectName.trim()) setProjectName(bom.name);
  };

  const addMaterial = () => {
    if (!selectedMaterialProduct) {
      setError("Material məhsulunu seçin");
      return;
    }
    setError(null);
    addProduct(selectedMaterialProduct);
  };

  const addExpense = () => {
    if (!expenseDescription.trim() || expenseAmount <= 0) {
      setError("Xərc təsviri və düzgün məbləğ daxil edin");
      return;
    }
    setExpenses((current) => [
      ...current,
      {
        key: key(),
        category: expenseCategory,
        description: expenseDescription.trim(),
        amount: expenseAmount,
        accountId: expenseAccountId,
      },
    ]);
    setExpenseDescription("");
    setExpenseAmount(0);
    setExpenseAccountId("");
    setError(null);
  };

  const addOutsourcing = () => {
    if (!outDescription.trim() || outQty <= 0 || outCost < 0) {
      setError("Xarici xidmət təsviri, miqdarı və qiyməti düzgün daxil edilməlidir");
      return;
    }
    setOutsourcing((current) => [
      ...current,
      {
        key: key(),
        description: outDescription.trim(),
        supplierId: outSupplierId,
        quantity: outQty,
        unitCost: outCost,
      },
    ]);
    setOutDescription("");
    setOutSupplierId("");
    setOutQty(1);
    setOutCost(0);
    setError(null);
  };

  const submit = async () => {
    const legacy = legacyFromProductionModel(productionModel);
    const finished = productsById.get(finishedProductId);
    const customer = customers.find((item) => item.id === customerId);
    const ousta = employees.find((item) => item.id === oustaId);
    const subcontractor = suppliers.find((item) => item.id === subcontractorId);
    const rawWarehouse = lookups?.warehouses.find((item) => item.id === rawMaterialWarehouseId);
    const furnitureWarehouse = lookups?.warehouses.find((item) => item.id === furnitureWarehouseId);
    const warehouse = lookups?.warehouses.find((item) => item.id === warehouseId);
    const name =
      projectName.trim() ||
      (finished ? `${finished.name} × ${Math.max(1, quantity)}` : "");
    if (!name) {
      setStep("project");
      setError("Layihə və ya hazır məhsul adı tələb olunur");
      return;
    }

    if (advance > 0 && assertPaymentAccountId(advanceAccountId)) {
      setStep("summary");
      setError(assertPaymentAccountId(advanceAccountId));
      return;
    }

    setSaving(true);
    setError(null);
    const result = await createProductionOrderAction({
      production_model: productionModel,
      type: legacy.type,
      custom_workflow: legacy.custom_workflow,
      project_name: name,
      customer_id: customerId || null,
      customer_name: customer ? customerLabel(customer) : null,
      ousta_id: oustaId || null,
      subcontractor_id: isSubcontractor ? subcontractorId || null : null,
      subcontractor_fee_percent: isSubcontractor ? subcontractorFeePercent : undefined,
      finished_product_id: finishedProductId || null,
      custom_product_id: !isSeries ? finishedProductId || null : null,
      quantity: Math.max(1, quantity),
      warehouse_id: warehouseId || furnitureWarehouseId || rawMaterialWarehouseId || null,
      warehouse_name: warehouse?.name || furnitureWarehouse?.name || rawWarehouse?.name || null,
      raw_material_warehouse_id: rawMaterialWarehouseId || warehouseId || null,
      furniture_warehouse_id: furnitureWarehouseId || warehouseId || null,
      total_project_price: totalPrice,
      installation_fee: installationFee,
      advance_payment: advance,
      advance_account_id: advanceAccountId || null,
      expected_delivery_date: deliveryDate || null,
      project_scope: scope || null,
      notes: notes || null,
      materials: materials.map((item) => ({
        product_id: item.productId,
        warehouse_id: item.warehouseId || null,
        warehouse_name: warehousesById.get(item.warehouseId)?.name || null,
        quantity: item.quantity,
        unit_cost: item.unitCost,
        stage_no: item.stageNo,
      })),
      outsourcing: outsourcing.map((item) => {
        const supplier = suppliers.find((row) => row.id === item.supplierId);
        return {
          supplier_id: item.supplierId || null,
          supplier_name: supplier?.company_name || supplier?.full_name || null,
          material_description: item.description,
          sqm_quantity: item.quantity,
          price_per_sqm: item.unitCost,
        };
      }),
      expenses: expenses.map((item) => ({
        category: item.category,
        description: item.description,
        amount: item.amount,
        account_id: item.accountId || null,
        account_name: lookups?.accounts.find((row) => row.id === item.accountId)?.name || null,
      })),
      contractor:
        isSubcontractor && subcontractor
          ? {
              contractor_id: subcontractor.id,
              contractor_name: subcontractor.company_name || subcontractor.full_name || "",
            }
          : ousta
            ? { contractor_id: ousta.id, contractor_name: ousta.full_name || "" }
            : null,
    });
    setSaving(false);
    if (!result.success || !result.data) {
      setError(result.success ? "İstehsalat sənədi yaradılmadı" : result.error);
      return;
    }
    reset();
    onCreated(result.data);
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center app-scrim p-2 md:p-5">
        <div className="app-modal flex h-[min(94vh,900px)] w-full max-w-6xl flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-app px-5 py-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-app-muted">
                İstehsalat idarəetməsi
              </p>
              <h2 className="text-lg font-bold text-app">Yeni istehsalat sifarişi</h2>
            </div>
            <button type="button" onClick={close} className="rounded-lg p-2 text-app-muted hover:bg-app-card-hover">
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="border-b border-app bg-app-surface px-4 py-3">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {STEPS.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStep(item.id)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${
                    step === item.id
                      ? "border-app-accent bg-app-accent/10 text-app-accent"
                      : index < currentStep
                        ? "border-emerald-500/30 text-emerald-500"
                        : "border-app text-app-muted"
                  }`}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-app-card-hover">
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            {(error || scanMessage) && (
              <div
                className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                  error
                    ? "border-red-400/40 bg-red-500/10 text-red-500"
                    : "border-emerald-400/40 bg-emerald-500/10 text-emerald-500"
                }`}
              >
                {error || scanMessage}
              </div>
            )}

            {step === "project" && (
              <div className="space-y-5">
                <section className="app-card p-4">
                  <h3 className="mb-3 text-sm font-bold text-app">İstehsalat modeli</h3>
                  <div className="grid gap-2 md:grid-cols-3">
                    {(
                      [
                        "series",
                        "in_house_custom",
                        "subcontractor_custom",
                      ] as ProductionModel[]
                    ).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setProductionModel(item)}
                        className={`rounded-xl border p-3 text-left text-xs font-semibold ${
                          productionModel === item
                            ? "border-app-accent bg-app-accent/10 text-app-accent"
                            : "border-app text-app-muted"
                        }`}
                      >
                        {PRODUCTION_MODEL_LABELS[item]}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="app-card grid gap-4 p-4 md:grid-cols-2">
                  <label className="text-xs font-semibold text-app md:col-span-2">
                    Layihə / sənəd adı *
                    <input className="app-input mt-1" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
                  </label>
                  <label className="text-xs font-semibold text-app">
                    Müştəri
                    <div className="mt-1 flex gap-2">
                      <select className="app-input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                        <option value="">Seçilməyib</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>
                        ))}
                      </select>
                      {!isSeries && (
                        <button type="button" className="btn-secondary shrink-0" onClick={() => setQuickAddTarget("customer")}>
                          <Plus className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </label>
                  {!isSeries && (
                    <label className="text-xs font-semibold text-app">
                      Usta / baş işçi
                      <div className="mt-1 flex gap-2">
                        <select className="app-input" value={oustaId} onChange={(e) => setOustaId(e.target.value)}>
                          <option value="">Seçilməyib</option>
                          {employees.map((employee) => (
                            <option key={employee.id} value={employee.id}>{employee.full_name}</option>
                          ))}
                        </select>
                        <button type="button" className="btn-secondary shrink-0" onClick={() => setQuickAddTarget("ousta")}>
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </label>
                  )}
                  <label className="text-xs font-semibold text-app">
                    Gözlənilən təhvil tarixi
                    <input type="date" className="app-input mt-1" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                  </label>
                  <label className="text-xs font-semibold text-app">
                    {isSeries ? "Hazır məhsul" : "Xüsusi mebel / məhsul"}
                    <div className="mt-1 flex gap-2">
                      <select className="app-input" value={finishedProductId} onChange={(e) => setFinishedProductId(e.target.value)}>
                        <option value="">{isSeries ? "Hazır məhsul seçin" : "Kataloqdan seçin"}</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>{productLabel(product)}</option>
                        ))}
                      </select>
                      <button type="button" className="btn-secondary shrink-0" onClick={() => setQuickAddTarget("finished")}>
                        <PackagePlus className="h-4 w-4" />
                      </button>
                    </div>
                  </label>
                  <label className="text-xs font-semibold text-app">
                    Miqdar
                    <input type="number" min={1} step="1" className="app-input mt-1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
                  </label>
                  {!isSeries && (
                    <label className="text-xs font-semibold text-app">
                      Xammal anbarı
                      <select className="app-input mt-1" value={rawMaterialWarehouseId} onChange={(e) => setRawMaterialWarehouseId(e.target.value)}>
                        <option value="">Anbar seçin</option>
                        {(lookups?.warehouses || []).map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {!isSeries && (
                    <label className="text-xs font-semibold text-app">
                      Xüsusi mebel anbarı
                      <select className="app-input mt-1" value={furnitureWarehouseId} onChange={(e) => setFurnitureWarehouseId(e.target.value)}>
                        <option value="">Anbar seçin</option>
                        {(lookups?.warehouses || []).map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {isSeries && (
                    <label className="text-xs font-semibold text-app">
                      Hazır məhsul anbarı
                      <select className="app-input mt-1" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                        <option value="">Anbar seçin</option>
                        {(lookups?.warehouses || []).map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {isSeries && (
                    <label className="text-xs font-semibold text-app">
                      BOM / resept şablonu
                      <select className="app-input mt-1" defaultValue="" onChange={(e) => applyBom(e.target.value)}>
                        <option value="">Resept seçin</option>
                        {(lookups?.boms || []).map((bom) => (
                          <option key={bom.id} value={bom.id}>{bom.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {isSubcontractor && (
                    <label className="text-xs font-semibold text-app">
                      Podratçı
                      <div className="mt-1 flex gap-2">
                        <select className="app-input" value={subcontractorId} onChange={(e) => setSubcontractorId(e.target.value)}>
                          <option value="">Podratçı seçin</option>
                          {suppliers.map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>
                              {supplier.company_name || supplier.full_name}
                            </option>
                          ))}
                        </select>
                        <button type="button" className="btn-secondary shrink-0" onClick={() => setQuickAddTarget("subcontractor")}>
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </label>
                  )}
                  {isSubcontractor && (
                    <label className="text-xs font-semibold text-app">
                      Podratçı faizi (%)
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        className="app-input mt-1"
                        value={subcontractorFeePercent}
                        onChange={(e) => setSubcontractorFeePercent(Number(e.target.value) || 0)}
                      />
                    </label>
                  )}
                  <label className="text-xs font-semibold text-app md:col-span-2">
                    Layihənin əhatəsi və texniki spesifikasiya
                    <textarea className="app-input mt-1 min-h-24" value={scope} onChange={(e) => setScope(e.target.value)} />
                  </label>
                </section>
              </div>
            )}

            {step === "materials" && (
              <div className="space-y-4">
                <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-amber-500">
                    <ScanBarcode className="h-5 w-5" />
                    Barkod skaneri aktivdir
                  </div>
                  <p className="mt-1 text-xs text-app-muted">
                    Skaneri istənilən vaxt oxudun. Barkod və ya məhsul kodu tapıldıqda material avtomatik əlavə ediləcək.
                  </p>
                </section>

                <section className="app-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-app">Material / aksesuar əlavə et</h3>
                    <button type="button" className="btn-secondary text-xs" onClick={() => setQuickAddTarget("material")}>
                      <Plus className="h-4 w-4" /> Yeni məhsul
                    </button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-5">
                    <label className="text-xs font-semibold text-app md:col-span-2">
                      Məhsul axtarışı
                      <input className="app-input mt-1" placeholder="Ad, kod və ya barkod..." value={materialSearch} onChange={(e) => setMaterialSearch(e.target.value)} />
                    </label>
                    <label className="text-xs font-semibold text-app md:col-span-2">
                      Məhsul
                      <select className="app-input mt-1" value={materialProductId} onChange={(e) => setMaterialProductId(e.target.value)}>
                        <option value="">Məhsul seçin</option>
                        {filteredProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {productLabel(product)} · stok {Number(product.stock || 0)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-app">
                      Miqdar
                      <input type="number" min={0.001} step="0.001" className="app-input mt-1" value={materialQty} onChange={(e) => setMaterialQty(Number(e.target.value) || 0)} />
                    </label>
                    <label className="text-xs font-semibold text-app md:col-span-2">
                      Anbar
                      <select className="app-input mt-1" value={materialWarehouseId} onChange={(e) => setMaterialWarehouseId(e.target.value)}>
                        <option value="">Əsas / məhsul anbarı</option>
                        {(lookups?.warehouses || []).map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="md:col-span-2">
                      <p className="text-xs font-semibold text-app">Cari stok və maya</p>
                      <div className="mt-1 rounded-lg border border-app px-3 py-2 text-xs">
                        {selectedMaterialProduct
                          ? `${Number(selectedMaterialProduct.stock || 0)} ${selectedMaterialProduct.unit} · ${money(selectedMaterialProduct.buy_price)}`
                          : "Məhsul seçilməyib"}
                      </div>
                    </div>
                    <button type="button" className="btn-primary self-end" onClick={addMaterial}>
                      <Plus className="h-4 w-4" /> Əlavə et
                    </button>
                  </div>
                </section>

                <section className="overflow-hidden rounded-xl border border-app">
                  <table className="min-w-full text-xs">
                    <thead className="bg-app-surface text-left text-app-muted">
                      <tr>
                        <th className="px-3 py-2">Material</th>
                        <th className="px-3 py-2">Stok</th>
                        <th className="px-3 py-2">Anbar</th>
                        <th className="px-3 py-2">Miqdar</th>
                        <th className="px-3 py-2">Maya</th>
                        <th className="px-3 py-2 text-right">Cəm</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {materials.map((item) => {
                        const product = productsById.get(item.productId);
                        const insufficient = Number(product?.stock || 0) < item.quantity;
                        return (
                          <tr key={item.key} className="border-t border-app">
                            <td className="px-3 py-2 font-semibold text-app">{product?.name}</td>
                            <td className={`px-3 py-2 ${insufficient ? "text-red-500" : "text-emerald-500"}`}>
                              {Number(product?.stock || 0)} {product?.unit}
                            </td>
                            <td className="px-3 py-2">{warehousesById.get(item.warehouseId)?.name || "—"}</td>
                            <td className="px-3 py-2">
                              <input type="number" min={0.001} step="0.001" className="app-input w-24" value={item.quantity} onChange={(e) => setMaterials((rows) => rows.map((row) => row.key === item.key ? { ...row, quantity: Number(e.target.value) || 0 } : row))} />
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" min={0} step="0.01" className="app-input w-24" value={item.unitCost} onChange={(e) => setMaterials((rows) => rows.map((row) => row.key === item.key ? { ...row, unitCost: Number(e.target.value) || 0 } : row))} />
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-bold">{money(item.quantity * item.unitCost)}</td>
                            <td>
                              <button type="button" className="p-2 text-red-500" onClick={() => setMaterials((rows) => rows.filter((row) => row.key !== item.key))}>
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {!materials.length && (
                        <tr><td colSpan={7} className="px-3 py-10 text-center text-app-muted">Material əlavə edilməyib</td></tr>
                      )}
                    </tbody>
                    <tfoot className="border-t border-app bg-app-surface font-bold">
                      <tr><td colSpan={5} className="px-3 py-3 text-right">Material maya dəyəri</td><td className="px-3 py-3 text-right font-mono">{money(materialCost)}</td><td /></tr>
                    </tfoot>
                  </table>
                </section>
              </div>
            )}

            {step === "expenses" && (
              <div className="grid gap-5 xl:grid-cols-2">
                <section className="app-card p-4">
                  <h3 className="mb-3 text-sm font-bold text-app">Əlavə Xərclər</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    <select className="app-input" value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value as ProductionExpenseCategory)}>
                      {PRODUCTION_EXPENSE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category === "transport" ? "Nəqliyyat" : category === "delivery" ? "Çatdırılma" : category === "installation" ? "Quraşdırma" : category === "tools" ? "Xüsusi alət" : "Digər"}
                        </option>
                      ))}
                    </select>
                    <input className="app-input" placeholder="Xərc təsviri" value={expenseDescription} onChange={(e) => setExpenseDescription(e.target.value)} />
                    <input type="number" min={0} step="0.01" className="app-input" placeholder="Məbləğ" value={expenseAmount || ""} onChange={(e) => setExpenseAmount(Number(e.target.value) || 0)} />
                    <select className="app-input" value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)}>
                      <option value="">Yalnız layihə mayası</option>
                      {(lookups?.accounts || []).map((account) => (
                        <option key={account.id} value={account.id}>{account.name} · {money(Number(account.balance || 0))}</option>
                      ))}
                    </select>
                    <button type="button" className="btn-primary md:col-span-2" onClick={addExpense}><Plus className="h-4 w-4" /> Xərc əlavə et</button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {expenses.map((item) => (
                      <div key={item.key} className="flex items-center justify-between rounded-lg border border-app px-3 py-2 text-xs">
                        <div><p className="font-semibold text-app">{item.description}</p><p className="text-app-muted">{item.category} · {item.accountId ? "Maliyyəyə yazılacaq" : "Layihə mayası"}</p></div>
                        <div className="flex items-center gap-2"><strong className="font-mono">{money(item.amount)}</strong><button type="button" className="text-red-500" onClick={() => setExpenses((rows) => rows.filter((row) => row.key !== item.key))}><Trash2 className="h-4 w-4" /></button></div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="app-card p-4">
                  <h3 className="mb-3 text-sm font-bold text-app">Xarici xidmət / kəsim / subpodrat</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    <input className="app-input md:col-span-2" placeholder="İş və ya material təsviri" value={outDescription} onChange={(e) => setOutDescription(e.target.value)} />
                    <select className="app-input" value={outSupplierId} onChange={(e) => setOutSupplierId(e.target.value)}>
                      <option value="">Təchizatçı seçin</option>
                      {(lookups?.suppliers || []).map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>{supplier.company_name || supplier.full_name}</option>
                      ))}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" min={0.001} step="0.001" className="app-input" placeholder="Miqdar / m²" value={outQty} onChange={(e) => setOutQty(Number(e.target.value) || 0)} />
                      <input type="number" min={0} step="0.01" className="app-input" placeholder="Vahid qiymət" value={outCost || ""} onChange={(e) => setOutCost(Number(e.target.value) || 0)} />
                    </div>
                    <button type="button" className="btn-primary md:col-span-2" onClick={addOutsourcing}><Plus className="h-4 w-4" /> Xarici xidmət əlavə et</button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {outsourcing.map((item) => (
                      <div key={item.key} className="flex items-center justify-between rounded-lg border border-app px-3 py-2 text-xs">
                        <div><p className="font-semibold text-app">{item.description}</p><p className="text-app-muted">{item.quantity} × {money(item.unitCost)}</p></div>
                        <div className="flex items-center gap-2"><strong className="font-mono">{money(item.quantity * item.unitCost)}</strong><button type="button" className="text-red-500" onClick={() => setOutsourcing((rows) => rows.filter((row) => row.key !== item.key))}><Trash2 className="h-4 w-4" /></button></div>
                      </div>
                    ))}
                  </div>
                </section>

                {isSubcontractor && (
                  <section className="app-card p-4 xl:col-span-2">
                    <h3 className="mb-3 text-sm font-bold text-app">Podratçı komissiyası</h3>
                    <div className="rounded-lg border border-app px-4 py-2 text-sm">
                      {subcontractorFeePercent}% · <strong>{money(contractorFee)}</strong>
                    </div>
                  </section>
                )}
              </div>
            )}

            {step === "summary" && (
              <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
                <section className="app-card p-4">
                  <h3 className="mb-4 text-sm font-bold text-app">Maliyyə şərtləri</h3>
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="text-xs font-semibold text-app">Layihə qiyməti<input type="number" min={0} step="0.01" className="app-input mt-1" value={totalPrice || ""} onChange={(e) => setTotalPrice(Number(e.target.value) || 0)} /></label>
                    <label className="text-xs font-semibold text-app">Quraşdırma / çatdırılma<input type="number" min={0} step="0.01" className="app-input mt-1" value={installationFee || ""} onChange={(e) => setInstallationFee(Number(e.target.value) || 0)} /></label>
                    <label className="text-xs font-semibold text-app">Ön ödəniş<input type="number" min={0} step="0.01" className="app-input mt-1" value={advance || ""} onChange={(e) => setAdvance(Number(e.target.value) || 0)} /></label>
                    {advance > 0 && (
                      <label className="text-xs font-semibold text-app md:col-span-2">
                        Avans üçün kassa/bank hesabı
                        <select
                          className="app-input mt-1"
                          value={advanceAccountId}
                          onChange={(e) => setAdvanceAccountId(e.target.value)}
                        >
                          <option value="">Hesab seçin</option>
                          {(lookups?.accounts || []).map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name} · {money(Number(account.balance || 0))}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="text-xs font-semibold text-app md:col-span-3">Qeydlər<textarea className="app-input mt-1 min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
                  </div>
                </section>
                <section className="rounded-xl border border-app-accent/30 bg-app-accent/5 p-4">
                  <h3 className="mb-4 text-sm font-bold text-app">Real vaxt rentabellik</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-app-muted">Materiallar</span><strong>{money(materialCost)}</strong></div>
                    <div className="flex justify-between"><span className="text-app-muted">Xarici xidmətlər</span><strong>{money(outsourcingCost)}</strong></div>
                    <div className="flex justify-between"><span className="text-app-muted">Yan xərclər</span><strong>{money(sideExpenseCost)}</strong></div>
                    <div className="flex justify-between"><span className="text-app-muted">Podratçı haqqı</span><strong>{money(contractorFee)}</strong></div>
                    <div className="my-3 border-t border-app" />
                    <div className="flex justify-between font-bold"><span>Ümumi maya</span><span>{money(totalCost)}</span></div>
                    <div className="flex justify-between font-bold"><span>Gəlir</span><span>{money(revenue)}</span></div>
                    <div className={`flex justify-between rounded-lg p-3 font-bold ${profit < 0 ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"}`}><span>Mənfəət</span><span>{money(profit)} · {margin.toFixed(1)}%</span></div>
                    <div className="flex justify-between text-xs"><span className="text-app-muted">Qalıq</span><strong>{money(Math.max(0, revenue - advance))}</strong></div>
                  </div>
                </section>
                <section className="app-card p-4 xl:col-span-2">
                  <h3 className="mb-3 text-sm font-bold text-app">ERP sinxronizasiya planı</h3>
                  <div className="grid gap-3 text-xs md:grid-cols-3">
                    <div className="rounded-lg border border-app p-3"><strong className="block text-app">Material rezervasiyası</strong><span className="text-app-muted">{materials.length} sətir sifarişə bağlanacaq; “İstehsala başla” zamanı anbardan çıxılacaq.</span></div>
                    <div className="rounded-lg border border-app p-3"><strong className="block text-app">Maliyyə sənədləri</strong><span className="text-app-muted">{expenses.filter((item) => item.accountId).length} xərc seçilmiş kassa/bank hesabına məxaric kimi yazılacaq.</span></div>
                    <div className="rounded-lg border border-app p-3"><strong className="block text-app">İstehsalat sənədi</strong><span className="text-app-muted">Yaradıldıqdan sonra iş kartı, müqavilə və material tələbi çap edilə bilər.</span></div>
                  </div>
                </section>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between border-t border-app bg-app-surface px-5 py-4">
            <button
              type="button"
              className="btn-secondary"
              disabled={currentStep === 0 || saving}
              onClick={() => setStep(STEPS[currentStep - 1].id)}
            >
              <ChevronLeft className="h-4 w-4" /> Geri
            </button>
            <div className="hidden text-center text-xs text-app-muted md:block">
              {materials.length} material · {expenses.length} xərc · maya {money(totalCost)}
            </div>
            {currentStep < STEPS.length - 1 ? (
              <button
                type="button"
                className="btn-primary"
                disabled={!canContinue}
                onClick={() => setStep(STEPS[currentStep + 1].id)}
              >
                Davam et <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
                {saving ? "Yaradılır..." : "Sifarişi yarat"}
              </button>
            )}
          </footer>
        </div>
      </div>

      {quickAddTarget === "finished" || quickAddTarget === "material" ? (
        <QuickAddProductModal
          onClose={() => setQuickAddTarget(null)}
          onCreated={(product) => {
            setLocalProducts((current) => [...current, product]);
            if (quickAddTarget === "finished") setFinishedProductId(product.id);
            else setMaterialProductId(product.id);
          }}
        />
      ) : null}
      {quickAddTarget === "customer" ? (
        <QuickAddCustomerModal
          onClose={() => setQuickAddTarget(null)}
          onCreated={(customer) => {
            setLocalCustomers((current) => [...current, customer]);
            setCustomerId(customer.id);
          }}
        />
      ) : null}
      {quickAddTarget === "ousta" ? (
        <QuickAddEmployeeModal
          onClose={() => setQuickAddTarget(null)}
          onCreated={(employee) => {
            setLocalEmployees((current) => [...current, employee]);
            setOustaId(employee.id);
          }}
        />
      ) : null}
      {quickAddTarget === "subcontractor" ? (
        <QuickAddSupplierModal
          onClose={() => setQuickAddTarget(null)}
          onCreated={(supplier) => {
            setLocalSuppliers((current) => [...current, supplier]);
            setSubcontractorId(supplier.id);
          }}
        />
      ) : null}
    </>
  );
}
