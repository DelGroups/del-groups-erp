/**
 * The delivery act (Təhvil-təslim aktı) of a sales invoice: which template, and every line of text, from
 * the invoice, its customer, its contract and the company profile. Pure (no React, no database), so the
 * printed page (html.ts), the Word file (docx.ts) and the tests use the same model.
 *
 * Official: the invoice is official and the customer is a company: seller and buyer companies with their
 * directors, and the contract number and date when a contract is linked (a warning when it is not).
 * Informal: an unofficial invoice or a private customer: the customer's name only, no contract line,
 * text says satıcı / alıcı (as Del's sample) and the signatures "Təhvil verən" / "Təhvil alan". A missing director or contract value prints a blank line to
 * be written by hand. The document itself is in Azerbaijani (a legal paper); the screen around it is not.
 */

export type ActTemplate = "official" | "informal";
export type ActWarning = "no_contract" | "no_seller_director" | "no_buyer_director" | "no_lines";

export interface ActInput {
  sale: { doc_no: string | null; doc_date: string | null; is_official: boolean; customer_name: string | null };
  customer: { full_name: string | null; company_name: string | null; entity_type: string | null; director_name: string | null } | null;
  contract: { contract_number: string | null; contract_date: string | null } | null;
  company: { legalName: string; directorName: string };
  lines: Array<{ barcode: string | null; name: string; unit: string | null; quantity: number }>;
  /** YYYY-MM-DD; the invoice date unless changed in the dialog. */
  actDate: string;
}

export interface ActParty {
  /** "Satıcı" / "Alıcı" or "Təhvil verən" / "Təhvil alan". */
  role: string;
  /** `"ACME" MMC`, or the customer's name. */
  name: string;
  /** Under the name in the signature block; "" when none. */
  director: string;
}

export interface DeliveryAct {
  template: ActTemplate;
  number: string;
  /** "22 may 2026-cı il tarixli № 15 saylı Müqavilənin" or null. */
  contractHeading: string | null;
  title: string;
  city: string;
  date: string;
  /** Clause 1 (the parties and what was handed over), then 2 and 3. */
  clauses: [string, string, string];
  rows: Array<{ no: number; barcode: string; name: string; unit: string; quantity: string }>;
  seller: ActParty;
  buyer: ActParty;
  warnings: ActWarning[];
}

/** A line to write by hand where a value is missing. */
export const BLANK = "____________________";
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
const LEGAL_FORMS = ["MMC", "ASC", "QSC", "AÇQ", "QAPALI", "LLC", "LTD", "İB", "IB", "FƏRDİ"];

/** The suffix of "2026-cı il": vowel harmony with the last spoken word of the number. */
export function yearSuffix(year: number): string {
  const ones: Record<number, string> = { 1: "ci", 2: "ci", 3: "cü", 4: "cü", 5: "ci", 6: "cı", 7: "ci", 8: "ci", 9: "cu" };
  const tens: Record<number, string> = { 1: "cu", 2: "ci", 3: "cu", 4: "cı", 5: "ci", 6: "cı", 7: "ci", 8: "ci", 9: "cı" };
  const y = Math.abs(Math.trunc(year));
  if (y % 10) return ones[y % 10];
  if (Math.floor(y / 10) % 10) return tens[Math.floor(y / 10) % 10];
  if (Math.floor(y / 100) % 10) return "cü"; // yüz
  return "ci"; // min
}

/** "2026-11-03" → "03 noyabr 2026-cı il"; anything else → a blank line. */
export function azDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return BLANK;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return BLANK;
  const year = Number(m[1]);
  return `${m[3]} ${month} ${year}-${yearSuffix(year)} il`;
}

/** "ACME MMC" → `"ACME" MMC`; a name without a legal form is just quoted. */
export function quoteCompany(name: string): string {
  const clean = name.replace(/["«»“”]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return BLANK;
  const words = clean.split(" ");
  const last = words[words.length - 1];
  if (words.length > 1 && LEGAL_FORMS.includes(last.toLocaleUpperCase("az"))) return `"${words.slice(0, -1).join(" ")}" ${last}`;
  return `"${clean}"`;
}

const text = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const qty = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000).replace(".", ",") : "");

export function chooseTemplate(input: Pick<ActInput, "sale" | "customer">): ActTemplate {
  const legal = input.customer?.entity_type === "legal" && !!text(input.customer.company_name);
  return input.sale.is_official && legal ? "official" : "informal";
}

export function buildDeliveryAct(input: ActInput): DeliveryAct {
  const template = chooseTemplate(input);
  const warnings: ActWarning[] = [];
  const seller = quoteCompany(input.company.legalName);
  const sellerDirector = text(input.company.directorName);
  const contractNo = text(input.contract?.contract_number);
  const hasContract = !!input.contract && (!!contractNo || !!input.contract.contract_date);
  const contractRef = hasContract ? `${azDate(input.contract?.contract_date)} tarixli № ${contractNo || BLANK} saylı Müqavilə` : null;

  const rows = input.lines
    .filter((l) => text(l.name) && Number(l.quantity) > 0)
    .map((l, i) => ({ no: i + 1, barcode: text(l.barcode), name: text(l.name), unit: text(l.unit), quantity: qty(Number(l.quantity)) }));
  if (!rows.length) warnings.push("no_lines");

  let clauses: [string, string, string];
  let sellerParty: ActParty;
  let buyerParty: ActParty;

  if (template === "official") {
    const buyer = quoteCompany(text(input.customer?.company_name));
    const buyerDirector = text(input.customer?.director_name);
    if (!hasContract) warnings.push("no_contract");
    if (!sellerDirector) warnings.push("no_seller_director");
    if (!buyerDirector) warnings.push("no_buyer_director");
    const sd = sellerDirector || BLANK;
    const bd = buyerDirector || BLANK;
    const basis = contractRef ? `${contractRef}yə əsasən ` : "";
    clauses = [
      `${seller}-nin direktoru ${sd} şəxsində (satıcı) bir tərəfdən, ${buyer}, direktoru ${bd} şəxsində (alıcı) digər tərəfdən bu aktı tərtib edirik ondan ötrü ki, ${basis}${seller}-nin direktoru ${sd} tərəfindən ${buyer}, direktoru ${bd} şəxsinə aşağıdakı mallar təhvil verilmişdir:`,
      "Alıcı yuxarıda qeyd olunan malları lazımi qaydada yoxlamış və yoxlama zamanı mallarda heç bir qüsur aşkar edilməmişdir.",
      "Tərəflərin bir-birinə qarşı qarşılıqlı tələbləri yoxdur. Aktın doğruluğunu imzalarımızla təsdiq edirik.",
    ];
    sellerParty = { role: "Satıcı", name: seller, director: sellerDirector ? `Direktor: ${sellerDirector}` : "" };
    buyerParty = { role: "Alıcı", name: buyer, director: buyerDirector ? `Direktor: ${buyerDirector}` : "" };
  } else {
    const buyerName = text(input.customer?.full_name) || text(input.sale.customer_name) || BLANK;
    clauses = [
      `Bu akt ${seller} (satıcı) ilə ${buyerName} (alıcı) arasında tərtib edilir ondan ötrü ki, aşağıdakı mallar satıcı tərəfindən alıcıya təhvil verilmişdir:`,
      "Alıcı yuxarıda qeyd olunan malları lazımi qaydada yoxlamış və yoxlama zamanı mallarda heç bir qüsur aşkar edilməmişdir.",
      "Tərəflərin bir-birinə qarşı qarşılıqlı tələbləri yoxdur. Aktın doğruluğunu imzalarımızla təsdiq edirik.",
    ];
    sellerParty = { role: "Təhvil verən", name: seller, director: sellerDirector ? `Direktor: ${sellerDirector}` : "" };
    buyerParty = { role: "Təhvil alan", name: buyerName, director: "" };
  }

  return {
    template,
    number: text(input.sale.doc_no) || BLANK,
    contractHeading: template === "official" && contractRef ? `${contractRef}nin` : null,
    title: "Təhvil-təslim aktı",
    city: "Bakı şəhəri",
    date: azDate(input.actDate || input.sale.doc_date),
    clauses,
    rows,
    seller: sellerParty,
    buyer: buyerParty,
    warnings,
  };
}

/** The file name of the act: "Tehvil-teslim-akti-SS-2026-00123". */
export function actFileName(act: Pick<DeliveryAct, "number">): string {
  const safe = act.number.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `Tehvil-teslim-akti${safe && !safe.startsWith("_") ? `-${safe}` : ""}`;
}
