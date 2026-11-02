export type ShopClock = {
  timezoneOffsetMinutes: number;
  dayStartTime: string;
};

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type PeriodSale = {
  id: string;
  transactionId?: string;
  amount: number;
  cost: number;
  taxAmount?: number;
  createdAt: string;
};

export type PeriodExpense = {
  amount: number;
  createdAt: string;
};

export type ReportTotals = {
  revenue: number;
  taxCollected: number;
  cost: number;
  expenseTotal: number;
  grossProfit: number;
  netProfit: number;
  receiptCount: number;
};

const offsetMs = (minutes: number) => minutes * 60 * 1000;

export const dayStartMinutes = (dayStartTime: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(dayStartTime.trim());
  if (!match) return 0;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return 0;
  return hour * 60 + minute;
};

const pad = (value: number) => String(value).padStart(2, '0');

export const formatDayKey = (year: number, monthIndex: number, day: number) => {
  const date = new Date(Date.UTC(year, monthIndex, day));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** Shop calendar day for an instant. Days roll at the business-day start, not at UTC midnight. */
export const businessDayKey = (instant: Date, clock: ShopClock) => {
  const shifted = new Date(instant.getTime() + offsetMs(clock.timezoneOffsetMinutes) - dayStartMinutes(clock.dayStartTime) * 60 * 1000);
  return formatDayKey(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
};

export const businessDayRange = (dayKey: string, clock: ShopClock) => {
  const [year, month, day] = dayKey.split('-').map(Number);
  const startMinutes = dayStartMinutes(clock.dayStartTime);
  const startUtc = Date.UTC(year, (month || 1) - 1, day || 1, Math.floor(startMinutes / 60), startMinutes % 60) - offsetMs(clock.timezoneOffsetMinutes);
  return { start: new Date(startUtc), end: new Date(startUtc + 24 * 60 * 60 * 1000) };
};

export const shiftDayKey = (dayKey: string, days: number) => {
  const [year, month, day] = dayKey.split('-').map(Number);
  return formatDayKey(year, (month || 1) - 1, (day || 1) + days);
};

const weekdayIndex = (dayKey: string) => {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1)).getUTCDay();
};

export const reportPeriodRange = (period: ReportPeriod, offset: number, now: Date, clock: ShopClock) => {
  const today = businessDayKey(now, clock);
  if (period === 'daily') return businessDayRange(shiftDayKey(today, -offset), clock);
  if (period === 'weekly') {
    const weekday = weekdayIndex(today);
    const mondayShift = weekday === 0 ? -6 : 1 - weekday;
    const startKey = shiftDayKey(today, mondayShift - offset * 7);
    return {
      start: businessDayRange(startKey, clock).start,
      end: businessDayRange(shiftDayKey(startKey, 7), clock).start,
    };
  }
  if (period === 'monthly') {
    const [year, month] = today.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1 - offset, 1));
    const end = new Date(Date.UTC(year, month - offset, 1));
    return {
      start: businessDayRange(formatDayKey(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()), clock).start,
      end: businessDayRange(formatDayKey(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()), clock).start,
    };
  }
  const year = Number(today.slice(0, 4)) - offset;
  return {
    start: businessDayRange(`${year}-01-01`, clock).start,
    end: businessDayRange(`${year + 1}-01-01`, clock).start,
  };
};

export const recentBusinessDays = (count: number, now: Date, clock: ShopClock) => {
  const today = businessDayKey(now, clock);
  return Array.from({ length: Math.max(0, count) }, (_, index) => shiftDayKey(today, -(count - 1 - index)));
};

export const instantInRange = (createdAt: string, start: Date, end: Date) => {
  const time = new Date(createdAt).getTime();
  return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
};

/** Sales the customer paid, minus tax and the cost recorded on each line, then minus expenses. */
export const summarizePeriod = (sales: PeriodSale[], expenses: PeriodExpense[], start: Date, end: Date): ReportTotals => {
  const periodSales = sales.filter((sale) => instantInRange(sale.createdAt, start, end));
  const periodExpenses = expenses.filter((expense) => instantInRange(expense.createdAt, start, end));
  const revenue = periodSales.reduce((sum, sale) => sum + sale.amount, 0);
  const taxCollected = periodSales.reduce((sum, sale) => sum + (sale.taxAmount || 0), 0);
  const cost = periodSales.reduce((sum, sale) => sum + sale.cost, 0);
  const expenseTotal = periodExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const grossProfit = revenue - taxCollected - cost;
  return {
    revenue,
    taxCollected,
    cost,
    expenseTotal,
    grossProfit,
    netProfit: grossProfit - expenseTotal,
    receiptCount: new Set(periodSales.map((sale) => sale.transactionId || sale.id)).size,
  };
};
