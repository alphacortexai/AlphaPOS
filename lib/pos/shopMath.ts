import { reorderLevel } from './books';
import { roundMoney, type PaymentMethod, type Tender } from './retail';

export type SaleBookLine = {
  id: string;
  itemName: string;
  type: string;
  qty: number;
  amount: number;
  createdAt: string;
  branchId?: string;
  productId?: string;
  transactionId?: string;
  saleKind?: 'sale' | 'return';
  voidedAt?: string;
  paymentMethod?: PaymentMethod;
  tenders?: Tender[];
  receiptNumber?: string;
  paymentReference?: string;
  moneyStatus?: 'unconfirmed' | 'confirmed';
  cashierEmail?: string;
};

export type SupplierBill = {
  id: string;
  supplierName: string;
  amount: number;
  createdAt: string;
  reference?: string;
  note?: string;
};

export type SupplierPayment = {
  id: string;
  supplierName: string;
  amount: number;
  method: Exclude<PaymentMethod, 'on_account'>;
  createdAt: string;
  reference?: string;
};

export const postedLines = <T extends { voidedAt?: string }>(lines: T[]) => lines.filter((line) => !line.voidedAt);

/** Empty shelves belong on the reorder list, as do items under the reorder point. */
export const needsReorder = (product: { stock: number; reorderPoint?: number }) => (
  product.stock <= 0 || product.stock < reorderLevel(product)
);

export const overlayStock = <T extends { id: string; stock: number }>(products: T[], stock: Record<string, number>): T[] => (
  products.map((product) => (stock[product.id] === undefined ? product : { ...product, stock: stock[product.id] }))
);

export const stockFallback = (products: { id: string; stock: number }[]) => (
  Object.fromEntries(products.map((product) => [product.id, product.stock]))
);

export const creditAllows = (owed: number, creditLimit: number | undefined, additional: number) => (
  creditLimit === undefined || roundMoney(owed + additional) <= roundMoney(creditLimit)
);

export const sellingPrice = (
  product: { salePrice: number; wholesalePrice?: number },
  priceList: 'retail' | 'wholesale' | undefined,
) => (
  priceList === 'wholesale' && typeof product.wholesalePrice === 'number' && product.wholesalePrice > 0
    ? product.wholesalePrice
    : product.salePrice
);

export const productForReturn = <T extends { id: string; name: string; branchId: string }>(
  products: T[],
  sale: { productId?: string; branchId: string; itemName: string; type: string },
) => {
  if (sale.type !== 'product') return undefined;
  if (sale.productId) return products.find((product) => product.id === sale.productId);
  return products.find((product) => product.branchId === sale.branchId && product.name === sale.itemName);
};

export const referenceRequired = (method: PaymentMethod) => method === 'mobile_money' || method === 'bank_transfer';

export const tendersNeedReference = (tenders: { method: PaymentMethod; reference?: string }[]) => (
  tenders.some((tender) => referenceRequired(tender.method) && !tender.reference?.trim())
);

export const discountNeedsManager = (role: string, discountAmount: number) => role === 'cashier' && discountAmount > 0;

export const hashPin = async (staffId: string, pin: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${staffId}:${pin.trim()}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const pinIsValid = (pin: string) => /^\d{4}$/.test(pin.trim());

export type DayClose = {
  salesTotal: number;
  expenseTotal: number;
  net: number;
  tenders: { method: PaymentMethod; amount: number }[];
  unconfirmed: { receiptNumber: string; amount: number; reference: string }[];
};

const tenderParts = (line: SaleBookLine): { method: PaymentMethod; amount: number; reference?: string }[] => {
  if (line.tenders && line.tenders.length > 0) return line.tenders.map((tender) => ({ method: tender.method, amount: tender.amount, reference: tender.reference }));
  return [{ method: line.paymentMethod || 'cash', amount: line.amount, reference: line.paymentReference }];
};

export const dayClose = (lines: SaleBookLine[], expenses: { amount: number; createdAt: string }[], dayKey: string, dayOf: (iso: string) => string): DayClose => {
  const todays = postedLines(lines).filter((line) => dayOf(line.createdAt) === dayKey && line.saleKind !== 'return');
  const returns = postedLines(lines).filter((line) => dayOf(line.createdAt) === dayKey && line.saleKind === 'return');
  const buckets = new Map<PaymentMethod, number>();
  const unconfirmed: DayClose['unconfirmed'] = [];
  [...todays, ...returns].forEach((line) => {
    tenderParts(line).forEach((part) => buckets.set(part.method, (buckets.get(part.method) || 0) + part.amount));
    if (line.moneyStatus === 'unconfirmed') {
      const reference = line.paymentReference || line.tenders?.find((tender) => tender.reference)?.reference || '';
      unconfirmed.push({ receiptNumber: line.receiptNumber || line.id.slice(0, 8), amount: line.amount, reference });
    }
  });
  const salesTotal = roundMoney([...todays, ...returns].reduce((sum, line) => sum + line.amount, 0));
  const expenseTotal = roundMoney(expenses.filter((expense) => dayOf(expense.createdAt) === dayKey).reduce((sum, expense) => sum + expense.amount, 0));
  return {
    salesTotal,
    expenseTotal,
    net: roundMoney(salesTotal - expenseTotal),
    tenders: [...buckets.entries()].map(([method, amount]) => ({ method, amount: roundMoney(amount) })).filter((row) => row.amount !== 0),
    unconfirmed,
  };
};

export const tenderTotals = (lines: SaleBookLine[]) => {
  const buckets = new Map<PaymentMethod, number>();
  postedLines(lines).forEach((line) => {
    tenderParts(line).forEach((part) => buckets.set(part.method, (buckets.get(part.method) || 0) + part.amount));
  });
  return [...buckets.entries()].map(([method, amount]) => ({ method, amount: roundMoney(amount) })).filter((row) => row.amount !== 0);
};

export const rankProducts = (lines: SaleBookLine[]) => {
  const totals = new Map<string, { name: string; qty: number; amount: number }>();
  postedLines(lines).forEach((line) => {
    if (line.type !== 'product' || line.saleKind === 'return') return;
    const key = line.productId || line.itemName;
    const current = totals.get(key) || { name: line.itemName, qty: 0, amount: 0 };
    totals.set(key, { name: line.itemName, qty: current.qty + line.qty, amount: current.amount + line.amount });
  });
  return [...totals.values()].sort((a, b) => b.amount - a.amount);
};

export const countVariance = (expected: number, counted: number) => counted - expected;

export const supplierOwed = (name: string, bills: SupplierBill[], payments: SupplierPayment[]) => {
  const key = name.trim().toLowerCase();
  const billed = bills.filter((bill) => bill.supplierName.trim().toLowerCase() === key).reduce((sum, bill) => sum + bill.amount, 0);
  const paid = payments.filter((payment) => payment.supplierName.trim().toLowerCase() === key).reduce((sum, payment) => sum + payment.amount, 0);
  return roundMoney(billed - paid);
};

export const billForReceipt = (
  supplierName: string,
  lines: { quantity: number; unitCost?: number }[],
  reference: string,
  now: string,
) => {
  const amount = roundMoney(lines.reduce((sum, line) => sum + (line.unitCost || 0) * line.quantity, 0));
  if (!supplierName.trim() || amount <= 0) return null;
  return {
    id: crypto.randomUUID(),
    supplierName: supplierName.trim(),
    amount,
    createdAt: now,
    ...(reference.trim() ? { reference: reference.trim() } : {}),
  } satisfies SupplierBill;
};

export const preferRemote = <T extends { id: string }>(embedded: T[], remote: T[]) => {
  if (remote.length === 0) return embedded;
  const map = new Map(embedded.map((item) => [item.id, item]));
  remote.forEach((item) => map.set(item.id, item));
  return [...map.values()];
};
export const shopDocumentBody = <T extends Record<string, unknown>>(payload: T) => {
  const rest = { ...payload };
  delete rest.sales;
  delete rest.expenses;
  delete rest.customerPayments;
  delete rest.supplierBills;
  delete rest.supplierPayments;
  return { ...rest, ledgerSplit: true };
};
