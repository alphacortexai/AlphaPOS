import { computeAccountBalances, paymentMatchesCustomer, sessionCashAdjustments, type BookAccount, type CustomerPaymentRecord } from './books';
import { customerAccountBalance, sessionCashTaken, type PaymentMethod, type Tender } from './retail';
import { finiteAmount, supplierOwed, type SupplierBill, type SupplierPayment } from './shopMath';

export type GrokBooks = {
  accounts: { name: string; balance: number }[];
  customers: { name: string; owed: number }[];
  suppliers: { name: string; owed: number }[];
  drawer?: { expectedCash: number };
};

const METHODS = new Set<PaymentMethod>(['cash', 'mobile_money', 'card_terminal', 'bank_transfer', 'on_account', 'other']);

const money = (value: number) => `UGX ${new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(Math.round(value))}`;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const amount = (value: unknown) => {
  const parsed = finiteAmount(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const methodOf = (value: unknown): PaymentMethod | '' => (
  typeof value === 'string' && METHODS.has(value as PaymentMethod) ? value as PaymentMethod : ''
);

const rows = (value: unknown): Record<string, unknown>[] => (
  Array.isArray(value) ? value.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  }) : []
);

const tendersOf = (value: unknown): Tender[] => rows(value).flatMap((tender) => {
  const method = methodOf(tender.method);
  if (!method) return [];
  return [{ method, amount: amount(tender.amount) }];
});

type BookSale = {
  amount: number;
  voidedAt?: string;
  accountId?: string;
  paymentMethod?: PaymentMethod;
  tenders?: Tender[];
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  cashSessionId?: string;
};

type BookExpense = { amount: number; accountId?: string; cashSessionId?: string };

type BookPayment = {
  amount: number;
  method: CustomerPaymentRecord['method'];
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  cashSessionId?: string;
};

const optional = (value: unknown) => {
  const next = text(value);
  return next || undefined;
};

const salesOf = (value: unknown): BookSale[] => rows(value).map((sale) => {
  const method = methodOf(sale.paymentMethod);
  const tenders = tendersOf(sale.tenders);
  return {
    amount: amount(sale.amount),
    ...(text(sale.voidedAt) ? { voidedAt: text(sale.voidedAt) } : {}),
    ...(optional(sale.accountId) ? { accountId: optional(sale.accountId) } : {}),
    ...(method ? { paymentMethod: method } : {}),
    ...(tenders.length > 0 ? { tenders } : {}),
    ...(optional(sale.customerId) ? { customerId: optional(sale.customerId) } : {}),
    ...(optional(sale.customerName) ? { customerName: optional(sale.customerName) } : {}),
    ...(optional(sale.customerPhone) ? { customerPhone: optional(sale.customerPhone) } : {}),
    ...(optional(sale.cashSessionId) ? { cashSessionId: optional(sale.cashSessionId) } : {}),
  };
});

const expensesOf = (value: unknown): BookExpense[] => rows(value).map((expense) => ({
  amount: amount(expense.amount),
  ...(optional(expense.accountId) ? { accountId: optional(expense.accountId) } : {}),
  ...(optional(expense.cashSessionId) ? { cashSessionId: optional(expense.cashSessionId) } : {}),
}));

const paymentsOf = (value: unknown): BookPayment[] => rows(value).flatMap((payment) => {
  const method = methodOf(payment.method);
  if (!method || method === 'on_account') return [];
  return [{
    amount: amount(payment.amount),
    method,
    customerName: text(payment.customerName),
    ...(optional(payment.customerId) ? { customerId: optional(payment.customerId) } : {}),
    ...(optional(payment.customerPhone) ? { customerPhone: optional(payment.customerPhone) } : {}),
    ...(optional(payment.cashSessionId) ? { cashSessionId: optional(payment.cashSessionId) } : {}),
  }];
});

const accountsOf = (value: unknown): BookAccount[] => rows(value).flatMap((account) => {
  const id = text(account.id);
  const name = text(account.name);
  if (!id || !name) return [];
  return [{
    id,
    name,
    openingBalance: amount(account.openingBalance),
    ...(account.isDefault === true ? { isDefault: true } : {}),
  }];
});

const peopleOf = (value: unknown) => rows(value).flatMap((person) => {
  const name = text(person.name);
  if (!name) return [];
  return [{
    id: optional(person.id),
    name,
    phone: optional(person.phone),
  }];
});

const billsOf = (value: unknown): SupplierBill[] => rows(value).flatMap((bill) => {
  const name = text(bill.supplierName);
  if (!name) return [];
  return [{
    id: text(bill.id) || name,
    supplierName: name,
    amount: amount(bill.amount),
    createdAt: text(bill.createdAt),
  }];
});

const supplierPaymentsOf = (value: unknown): SupplierPayment[] => rows(value).flatMap((payment) => {
  const name = text(payment.supplierName);
  const method = methodOf(payment.method);
  if (!name || !method || method === 'on_account') return [];
  return [{
    id: text(payment.id) || name,
    supplierName: name,
    amount: amount(payment.amount),
    method,
    createdAt: text(payment.createdAt),
  }];
});

const customerOwed = (
  person: { id?: string; name: string; phone?: string },
  sales: Parameters<typeof customerAccountBalance>[0],
  payments: BookPayment[],
) => {
  const charged = customerAccountBalance(sales, person.name, person.phone, person.id);
  const paid = payments
    .filter((payment) => (person.id && payment.customerId === person.id) || (!payment.customerId && paymentMatchesCustomer(payment, person.name, person.phone)))
    .reduce((sum, payment) => sum + payment.amount, 0);
  return Math.round((charged - paid) * 100) / 100;
};

export const shopBooks = (input: {
  accounts?: unknown;
  sales?: unknown;
  expenses?: unknown;
  payments?: unknown;
  customers?: unknown;
  suppliers?: unknown;
  supplierBills?: unknown;
  supplierPayments?: unknown;
  cashSessions?: unknown;
}): GrokBooks => {
  const accounts = accountsOf(input.accounts);
  const sales = salesOf(input.sales);
  const expenses = expensesOf(input.expenses);
  const payments = paymentsOf(input.payments);
  const balances = computeAccountBalances(accounts, sales, expenses, payments);
  const tillSales = sales.map((sale, index) => ({
    id: `line-${index}`,
    itemName: '',
    type: 'product',
    qty: 1,
    amount: sale.amount,
    createdAt: '',
    ...(sale.paymentMethod ? { paymentMethod: sale.paymentMethod } : {}),
    ...(sale.tenders ? { tenders: sale.tenders } : {}),
    ...(sale.cashSessionId ? { cashSessionId: sale.cashSessionId } : {}),
    ...(sale.voidedAt ? { voidedAt: sale.voidedAt } : {}),
    ...(sale.customerId ? { customerId: sale.customerId } : {}),
    ...(sale.customerName ? { customerName: sale.customerName } : {}),
    ...(sale.customerPhone ? { customerPhone: sale.customerPhone } : {}),
  }));
  const customers = new Map<string, { id?: string; name: string; phone?: string }>();
  peopleOf(input.customers).forEach((person) => customers.set(person.id || person.name.toLowerCase(), person));
  sales.forEach((sale) => {
    const name = sale.customerName || '';
    const key = sale.customerId || name.toLowerCase();
    if (!key) return;
    const known = [...customers.values()].some((person) => (
      (sale.customerId && person.id === sale.customerId) || (name && person.name.toLowerCase() === name.toLowerCase())
    ));
    if (known) return;
    customers.set(key, { id: sale.customerId, name: name || 'Customer', phone: sale.customerPhone });
  });
  const customerRows = [...customers.values()]
    .map((person) => ({ name: person.name, owed: customerOwed(person, tillSales, payments) }))
    .filter((person) => person.owed !== 0)
    .sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name));
  const supplierNames = new Map<string, string>();
  const rememberSupplier = (name: string) => {
    const key = name.trim().toLowerCase();
    if (key && !supplierNames.has(key)) supplierNames.set(key, name.trim());
  };
  peopleOf(input.suppliers).forEach((supplier) => rememberSupplier(supplier.name));
  const bills = billsOf(input.supplierBills);
  const supplierPayments = supplierPaymentsOf(input.supplierPayments);
  bills.forEach((bill) => rememberSupplier(bill.supplierName));
  supplierPayments.forEach((payment) => rememberSupplier(payment.supplierName));
  const supplierRows = [...supplierNames.values()]
    .map((name) => ({ name, owed: supplierOwed(name, bills, supplierPayments) }))
    .filter((supplier) => supplier.owed !== 0)
    .sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name));
  const open = rows(input.cashSessions).find((session) => session.status === 'open');
  const sessionId = text(open?.id);
  const drawer = open && sessionId
    ? {
      expectedCash: Math.round((amount(open.openingFloat) + sessionCashTaken(tillSales, sessionId) + sessionCashAdjustments(expenses, payments, sessionId)) * 100) / 100,
    }
    : undefined;
  return {
    accounts: accounts.map((account) => ({ name: account.name, balance: Math.round((balances.get(account.id) || 0) * 100) / 100 })),
    customers: customerRows,
    suppliers: supplierRows,
    ...(drawer ? { drawer } : {}),
  };
};

const named = (rowsToShow: { name: string; owed: number }[], query: string) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return rowsToShow;
  return rowsToShow.filter((row) => row.name.toLowerCase().includes(needle));
};

const listLines = (title: string, empty: string, lines: { name: string; amount: number }[]) => {
  if (!lines.length) return empty;
  const shown = lines.slice(0, 25);
  const extra = lines.length - shown.length;
  const body = shown.map((line) => `${line.name}: ${money(line.amount)}`).join('\n');
  return `${title}\n${body}${extra > 0 ? `\n${extra} more are not listed.` : ''}`;
};

/** A balances question that also names a day must not be answered as sales for that day. */
export const booksQuestion = (question: string): { kind: string } | null => {
  const text = question.toLowerCase();
  const aboutBooks = /\bbalances?\b|\bfloat\b|\bdrawer\b|\bmobile money\b|\bwho owes\b|\bowed\b|\bowes?\b|\bon account\b|\baccounts?\b/.test(text);
  if (!aboutBooks) return null;
  const aboutSales = /\b(sold|sell|sales?|revenue|takings|turnover)\b/.test(text);
  if (aboutSales && !/\bbalances?\b|\bfloat\b|\bdrawer\b|\bowed\b|\bowes?\b|\bon account\b/.test(text)) return null;
  const customers = /\bcustomers?\b|\bwho owes\b|\bon account\b|\bowes?\b/.test(text);
  const suppliers = /\bsuppliers?\b/.test(text);
  const accounts = /\bbalances?\b|\bfloat\b|\bdrawer\b|\bmobile money\b|\bcash\b|\bbank\b|\baccounts?\b|\bcard\b/.test(text);
  if (accounts && !customers && !suppliers) return { kind: 'accounts' };
  if (customers && !accounts && !suppliers) return { kind: 'customers' };
  if (suppliers && !accounts && !customers) return { kind: 'suppliers' };
  return { kind: 'all' };
};

export const formatShopBalances = (books: GrokBooks, kind: string, name = '') => {
  const asked = kind.trim().toLowerCase();
  const wantAccounts = !asked || asked === 'all' || asked === 'accounts' || asked === 'account';
  const wantCustomers = !asked || asked === 'all' || asked === 'customers' || asked === 'customer';
  const wantSuppliers = !asked || asked === 'all' || asked === 'suppliers' || asked === 'supplier';
  const parts: string[] = [];
  if (wantAccounts) {
    const accounts = named(books.accounts.map((account) => ({ name: account.name, owed: account.balance })), name);
    parts.push(listLines('Account balances', name ? `No account matches ${name}.` : 'No accounts are set up.', accounts.map((account) => ({ name: account.name, amount: account.owed }))));
    if (!name && books.drawer) parts.push(`The drawer is open. Expected cash in the drawer is ${money(books.drawer.expectedCash)}.`);
  }
  if (wantCustomers) {
    const customers = named(books.customers, name);
    parts.push(listLines('Customers who owe the shop', name ? `No customer balance matches ${name}.` : 'No customer owes the shop.', customers.map((customer) => ({ name: customer.name, amount: customer.owed }))));
  }
  if (wantSuppliers) {
    const suppliers = named(books.suppliers, name);
    parts.push(listLines('Owed to suppliers', name ? `No supplier balance matches ${name}.` : 'The shop does not owe a supplier.', suppliers.map((supplier) => ({ name: supplier.name, amount: supplier.owed }))));
  }
  if (!parts.length) return 'Ask about accounts, customers, or suppliers.';
  return parts.join('\n\n');
};
