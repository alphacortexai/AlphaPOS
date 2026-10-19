export type SalesEmailCadence = 'off' | 'daily' | 'weekly' | 'monthly';

export type SalesEmailSettings = {
  cadence: SalesEmailCadence;
  recipients: string[];
  lastSentKey: string;
};

export type SalesDigest = {
  shopName: string;
  periodLabel: string;
  periodKey: string;
  cadence: Exclude<SalesEmailCadence, 'off'>;
  revenue: number;
  expenses: number;
  tax: number;
  receipts: number;
  topItems: { name: string; qty: number; revenue: number }[];
};

export const defaultSalesEmailSettings: SalesEmailSettings = {
  cadence: 'off',
  recipients: [],
  lastSentKey: '',
};

const inflightSalesEmails = new Set<string>();
const blockedSalesEmails = new Set<string>();

export const claimSalesEmailSend = (key: string) => {
  if (inflightSalesEmails.has(key) || blockedSalesEmails.has(key)) return false;
  inflightSalesEmails.add(key);
  return true;
};

export const finishSalesEmailSend = (key: string, result: 'sent' | 'blocked' | 'failed') => {
  if (result === 'failed') inflightSalesEmails.delete(key);
  if (result === 'blocked') {
    inflightSalesEmails.delete(key);
    blockedSalesEmails.add(key);
  }
};

export const normalizeSalesEmailSettings = (value: unknown): SalesEmailSettings => {
  const record = value && typeof value === 'object' ? value as Partial<SalesEmailSettings> : {};
  const cadence = record.cadence === 'daily' || record.cadence === 'weekly' || record.cadence === 'monthly' ? record.cadence : 'off';
  const recipients = Array.isArray(record.recipients)
    ? record.recipients.map((email) => String(email || '').trim().toLowerCase()).filter((email) => email.includes('@')).slice(0, 5)
    : [];
  return {
    cadence,
    recipients,
    lastSentKey: typeof record.lastSentKey === 'string' ? record.lastSentKey.slice(0, 40) : '',
  };
};

const shopDate = (now: Date, offsetMinutes: number) => new Date(now.getTime() + offsetMinutes * 60 * 1000);

export const previousSalesPeriod = (cadence: Exclude<SalesEmailCadence, 'off'>, now: Date, offsetMinutes: number) => {
  const shifted = shopDate(now, offsetMinutes);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const offsetMs = offsetMinutes * 60 * 1000;

  if (cadence === 'daily') {
    const startShop = Date.UTC(year, month, day - 1);
    const endShop = Date.UTC(year, month, day);
    const key = new Date(startShop).toISOString().slice(0, 10);
    return {
      key,
      label: new Date(startShop).toLocaleDateString('en-UG', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }),
      start: new Date(startShop - offsetMs),
      end: new Date(endShop - offsetMs),
    };
  }

  if (cadence === 'weekly') {
    const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
    const thisWeekStart = Date.UTC(year, month, day - weekday);
    const startShop = thisWeekStart - 7 * 24 * 60 * 60 * 1000;
    const keyDate = new Date(startShop).toISOString().slice(0, 10);
    return {
      key: `week:${keyDate}`,
      label: `Week of ${new Date(startShop).toLocaleDateString('en-UG', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`,
      start: new Date(startShop - offsetMs),
      end: new Date(thisWeekStart - offsetMs),
    };
  }

  const startShop = Date.UTC(year, month - 1, 1);
  const endShop = Date.UTC(year, month, 1);
  return {
    key: new Date(startShop).toISOString().slice(0, 7),
    label: new Date(startShop).toLocaleDateString('en-UG', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    start: new Date(startShop - offsetMs),
    end: new Date(endShop - offsetMs),
  };
};

type DigestSale = { id: string; transactionId?: string; itemName: string; qty: number; amount: number; taxAmount?: number; createdAt: string };
type DigestExpense = { amount: number; createdAt: string };

export const buildSalesDigest = (
  shopName: string,
  cadence: Exclude<SalesEmailCadence, 'off'>,
  period: { key: string; label: string; start: Date; end: Date },
  sales: DigestSale[],
  expenses: DigestExpense[],
): SalesDigest => {
  const inPeriod = (createdAt: string) => {
    const time = new Date(createdAt).getTime();
    return time >= period.start.getTime() && time < period.end.getTime();
  };
  const periodSales = sales.filter((sale) => inPeriod(sale.createdAt));
  const periodExpenses = expenses.filter((expense) => inPeriod(expense.createdAt));
  const revenue = periodSales.reduce((sum, sale) => sum + sale.amount, 0);
  const tax = periodSales.reduce((sum, sale) => sum + (sale.taxAmount || 0), 0);
  const expenseTotal = periodExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const receipts = new Set(periodSales.map((sale) => sale.transactionId || sale.id)).size;
  const items = new Map<string, { name: string; qty: number; revenue: number }>();
  periodSales.forEach((sale) => {
    const current = items.get(sale.itemName) || { name: sale.itemName, qty: 0, revenue: 0 };
    current.qty += sale.qty;
    current.revenue += sale.amount;
    items.set(sale.itemName, current);
  });
  const topItems = [...items.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  return {
    shopName: shopName.trim() || 'Shop',
    periodLabel: period.label,
    periodKey: period.key,
    cadence,
    revenue,
    expenses: expenseTotal,
    tax,
    receipts,
    topItems,
  };
};
