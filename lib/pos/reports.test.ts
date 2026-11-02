import assert from 'node:assert/strict';
import test from 'node:test';
import { businessDayKey, recentBusinessDays, reportPeriodRange, summarizePeriod, type ShopClock } from './reports';

const kampala: ShopClock = { timezoneOffsetMinutes: 180, dayStartTime: '00:00' };
const kampalaOpen: ShopClock = { timezoneOffsetMinutes: 180, dayStartTime: '06:00' };

test('a sale after midnight in Kampala stays on that shop day', () => {
  const saleAt = new Date('2026-11-02T22:30:00.000Z');
  assert.equal(businessDayKey(saleAt, kampala), '2026-11-03');
  assert.equal(businessDayKey(saleAt, { timezoneOffsetMinutes: 0, dayStartTime: '00:00' }), '2026-11-02');
});

test('a sale before the business-day start belongs to the previous day', () => {
  assert.equal(businessDayKey(new Date('2026-11-02T02:30:00.000Z'), kampalaOpen), '2026-11-01');
  assert.equal(businessDayKey(new Date('2026-11-02T03:30:00.000Z'), kampalaOpen), '2026-11-02');
});

test('the report week starts Monday in the shop calendar', () => {
  const mondayEvening = new Date('2026-11-02T19:00:00.000Z');
  const range = reportPeriodRange('weekly', 0, mondayEvening, kampala);
  assert.equal(range.start.toISOString(), '2026-11-01T21:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-11-08T21:00:00.000Z');
  const sundayNight = new Date('2026-11-01T19:00:00.000Z');
  assert.equal(sundayNight >= range.start && sundayNight < range.end, false);
});

test('today on the chart is the same business day as the Today total', () => {
  const now = new Date('2026-11-02T22:30:00.000Z');
  const days = recentBusinessDays(7, now, kampala);
  assert.deepEqual(days.slice(-2), ['2026-11-02', '2026-11-03']);
  const today = reportPeriodRange('daily', 0, now, kampala);
  const sales = [
    { id: 'early', amount: 4000, cost: 1000, taxAmount: 0, createdAt: '2026-11-02T22:30:00.000Z' },
    { id: 'yesterday', amount: 9000, cost: 0, taxAmount: 0, createdAt: '2026-11-02T18:00:00.000Z' },
  ];
  const totals = summarizePeriod(sales, [{ amount: 500, createdAt: '2026-11-02T22:40:00.000Z' }], today.start, today.end);
  assert.equal(businessDayKey(new Date(sales[0].createdAt), kampala), days[days.length - 1]);
  assert.deepEqual(totals, {
    revenue: 4000,
    taxCollected: 0,
    cost: 1000,
    expenseTotal: 500,
    grossProfit: 3000,
    netProfit: 2500,
    receiptCount: 1,
  });
});

test('a monthly service accrual already stored as an expense is not subtracted again', () => {
  const start = new Date('2026-11-01T21:00:00.000Z');
  const end = new Date('2026-11-02T21:00:00.000Z');
  const totals = summarizePeriod(
    [{ id: 'sale', transactionId: 'receipt-1', amount: 10000, cost: 4000, taxAmount: 1800, createdAt: '2026-11-02T10:00:00.000Z' }],
    [{ amount: 1000, createdAt: '2026-11-02T08:00:00.000Z' }],
    start,
    end,
  );
  assert.equal(totals.netProfit, 3200);
  assert.equal(totals.receiptCount, 1);
});
