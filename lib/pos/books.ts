import { roundMoney, type PaymentMethod, type Tender } from './retail';

export const DEFAULT_REORDER_POINT = 10;

export const reorderLevel = (product: { reorderPoint?: number }) => {
  const point = Number(product.reorderPoint);
  return Number.isFinite(point) && point >= 0 ? point : DEFAULT_REORDER_POINT;
};

export const stockIsLow = (product: { stock: number; reorderPoint?: number }) => (
  product.stock > 0 && product.stock < reorderLevel(product)
);

export type StockWorth = {
  units: number;
  atCost: number;
  atSalePrice: number;
};

const countedUnits = (stock: number) => (Number.isFinite(stock) ? Math.max(0, stock) : 0);
const countedPrice = (price: number) => (Number.isFinite(price) ? Math.max(0, price) : 0);

export const stockWorth = (products: { stock: number; purchasePrice: number; salePrice: number }[]): StockWorth => (
  products.reduce<StockWorth>((totals, product) => {
    const units = countedUnits(product.stock);
    return {
      units: totals.units + units,
      atCost: totals.atCost + roundMoney(units * countedPrice(product.purchasePrice)),
      atSalePrice: totals.atSalePrice + roundMoney(units * countedPrice(product.salePrice)),
    };
  }, { units: 0, atCost: 0, atSalePrice: 0 })
);

export const TENDER_ACCOUNT_NAME: Record<Exclude<PaymentMethod, 'on_account'>, string> = {
  cash: 'CASH',
  mobile_money: 'Mobile money',
  card_terminal: 'Card',
  bank_transfer: 'Bank',
  other: 'Other',
};

const TENDER_ACCOUNT_NAMES = ['CASH', 'Mobile money', 'Card', 'Bank', 'Other'] as const;

export type BookAccount = {
  id: string;
  name: string;
  openingBalance: number;
  isDefault?: boolean;
};

export const withTenderAccounts = <T extends BookAccount>(
  accounts: T[],
  create: () => Omit<T, keyof BookAccount>,
): T[] => {
  const next = accounts.map((account) => ({
    ...account,
    openingBalance: Number.isFinite(account.openingBalance) ? account.openingBalance : 0,
  }));
  TENDER_ACCOUNT_NAMES.forEach((name) => {
    if (next.some((account) => account.name.trim().toLowerCase() === name.toLowerCase())) return;
    next.push({
      ...create(),
      id: crypto.randomUUID(),
      name,
      openingBalance: 0,
      isDefault: false,
    } as T);
  });
  const cash = next.find((account) => account.name.trim().toLowerCase() === 'cash');
  return next.map((account) => ({ ...account, isDefault: Boolean(cash && account.id === cash.id) }));
};

type SaleLike = {
  amount: number;
  accountId?: string;
  paymentMethod?: PaymentMethod;
  tenders?: Tender[];
};

type AccountContribution = { name: string; accountId?: string; amount: number };

export const contributionsForSale = (sale: SaleLike): AccountContribution[] => {
  if (sale.tenders && sale.tenders.length > 0) {
    return sale.tenders.flatMap((tender) => (
      tender.method === 'on_account' ? [] : [{ name: TENDER_ACCOUNT_NAME[tender.method], amount: tender.amount }]
    ));
  }
  if (sale.paymentMethod === 'on_account') return [];
  if (sale.paymentMethod && sale.paymentMethod !== 'cash') {
    return [{ name: TENDER_ACCOUNT_NAME[sale.paymentMethod], amount: sale.amount }];
  }
  return [{ name: 'CASH', accountId: sale.accountId, amount: sale.amount }];
};

type ExpenseLike = { amount: number; accountId?: string };

export type SupplierRecord = { id: string; name: string };

export type CustomerPaymentRecord = {
  id: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  method: Exclude<PaymentMethod, 'on_account'>;
  createdAt: string;
  cashSessionId?: string;
};

const PAYMENT_METHODS = new Set<CustomerPaymentRecord['method']>(['cash', 'mobile_money', 'card_terminal', 'bank_transfer', 'other']);

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

export const normalizeSuppliers = (value: unknown): SupplierRecord[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== 'string' || typeof record.name !== 'string') return [];
    const name = record.name.trim().slice(0, 80);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return [];
    seen.add(key);
    return [{ id: record.id, name }];
  });
};

export const normalizeCustomerPayments = (value: unknown): CustomerPaymentRecord[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== 'string' || typeof record.customerName !== 'string') return [];
    const amount = Number(record.amount);
    const method = record.method;
    if (!Number.isFinite(amount) || amount <= 0 || typeof method !== 'string' || !PAYMENT_METHODS.has(method as CustomerPaymentRecord['method'])) return [];
    const name = record.customerName.trim().slice(0, 100);
    if (!name) return [];
    const phone = typeof record.customerPhone === 'string' ? record.customerPhone.trim().slice(0, 40) : '';
    return [{
      id: record.id,
      customerName: name,
      ...(phone ? { customerPhone: phone } : {}),
      amount,
      method: method as CustomerPaymentRecord['method'],
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
      ...(typeof record.cashSessionId === 'string' && record.cashSessionId ? { cashSessionId: record.cashSessionId } : {}),
    }];
  });
};

export const paymentMatchesCustomer = (
  payment: { customerName: string; customerPhone?: string },
  customerName: string,
  customerPhone?: string,
) => {
  const sameName = payment.customerName.trim().toLowerCase() === customerName.trim().toLowerCase();
  const samePhone = Boolean(customerPhone?.trim() && payment.customerPhone?.trim() === customerPhone.trim());
  return sameName || samePhone;
};

export const computeAccountBalances = (
  accounts: BookAccount[],
  sales: SaleLike[],
  expenses: ExpenseLike[],
  payments: { amount: number; method: CustomerPaymentRecord['method'] }[],
) => {
  const balances = new Map<string, number>();
  accounts.forEach((account) => balances.set(account.id, account.openingBalance || 0));
  const cash = accounts.find((account) => account.isDefault) || accounts.find((account) => account.name.trim().toLowerCase() === 'cash') || accounts[0];
  const named = (name: string) => accounts.find((account) => account.name.trim().toLowerCase() === name.toLowerCase());
  const apply = (name: string, amount: number, preferredId?: string) => {
    const preferred = preferredId ? accounts.find((account) => account.id === preferredId) : undefined;
    const account = preferred || named(name) || (name === 'CASH' ? cash : undefined);
    if (!account) return;
    balances.set(account.id, (balances.get(account.id) || 0) + amount);
  };

  sales.forEach((sale) => {
    contributionsForSale(sale).forEach((part) => apply(part.name, part.amount, part.name === 'CASH' ? part.accountId : undefined));
  });
  payments.forEach((payment) => apply(TENDER_ACCOUNT_NAME[payment.method], payment.amount));
  expenses.forEach((expense) => {
    const account = (expense.accountId && accounts.some((item) => item.id === expense.accountId))
      ? accounts.find((item) => item.id === expense.accountId)
      : cash;
    if (!account) return;
    balances.set(account.id, (balances.get(account.id) || 0) - expense.amount);
  });
  return balances;
};

export const sessionCashAdjustments = (
  expenses: { amount: number; cashSessionId?: string }[],
  payments: { amount: number; method: PaymentMethod | CustomerPaymentRecord['method']; cashSessionId?: string }[],
  sessionId: string,
) => {
  const received = payments
    .filter((payment) => payment.method === 'cash' && payment.cashSessionId === sessionId)
    .reduce((sum, payment) => sum + payment.amount, 0);
  const spent = expenses
    .filter((expense) => expense.cashSessionId === sessionId)
    .reduce((sum, expense) => sum + expense.amount, 0);
  return received - spent;
};
