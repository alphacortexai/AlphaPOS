import assert from 'node:assert/strict';
import test from 'node:test';
import { answerShopQuestion, type ShopChatSnapshot } from './assistantChat';
import { reportPeriodRange, summarizePeriod } from './reports';

const clock = { timezoneOffsetMinutes: 180, dayStartTime: '00:00' };
const now = new Date('2026-11-11T12:00:00.000Z');

const shop = (): ShopChatSnapshot => ({
  shopName: 'Kiosk',
  clock,
  branches: [
    { id: 'main', name: 'Main' },
    { id: 'other', name: 'Entebbe' },
  ],
  products: [
    { id: 'milk', name: 'Milk', branchId: 'main', stock: 14, purchasePrice: 1000, salePrice: 2000, reorderPoint: 10, category: 'Drinks' },
    { id: 'sugar', name: 'Sugar', branchId: 'main', stock: 2, purchasePrice: 1500, salePrice: 3000, reorderPoint: 10, category: 'Grocery' },
    { id: 'salt', name: 'Salt', branchId: 'main', stock: 0, purchasePrice: 500, salePrice: 1000, reorderPoint: 5, category: 'Grocery' },
    { id: 'bread', name: 'Bread', branchId: 'other', stock: 8, purchasePrice: 2000, salePrice: 4000, reorderPoint: 2, category: 'Bakery' },
  ],
  services: [
    { id: 'print', name: 'Printing', branchId: 'main', salePrice: 5000, directCost: 1000 },
    { id: 'drop', name: 'Delivery', branchId: 'main', salePrice: 3000 },
  ],
  sales: [
    { id: 's1', transactionId: 't1', type: 'product', itemName: 'Milk', productId: 'milk', qty: 2, amount: 4000, cost: 2000, taxAmount: 400, branchId: 'main', createdAt: '2026-11-11T08:00:00.000Z' },
    { id: 's2', transactionId: 't2', type: 'service', itemName: 'Printing', qty: 1, amount: 5000, cost: 1000, taxAmount: 0, branchId: 'main', createdAt: '2026-11-11T09:00:00.000Z' },
    { id: 's3', transactionId: 't3', type: 'product', itemName: 'Bread', productId: 'bread', qty: 1, amount: 4000, cost: 2000, taxAmount: 0, branchId: 'other', createdAt: '2026-11-11T10:00:00.000Z' },
    { id: 'void', transactionId: 'tv', type: 'product', itemName: 'Milk', qty: 9, amount: 90000, cost: 0, taxAmount: 0, branchId: 'main', createdAt: '2026-11-11T11:00:00.000Z', voidedAt: '2026-11-11T11:05:00.000Z' },
    { id: 'y1', transactionId: 'ty', type: 'product', itemName: 'Sugar', productId: 'sugar', qty: 1, amount: 3000, cost: 1500, taxAmount: 0, branchId: 'main', createdAt: '2026-11-10T08:00:00.000Z' },
  ],
  expenses: [
    { title: 'Rent', amount: 1000, branchId: 'main', createdAt: '2026-11-11T07:00:00.000Z' },
    { title: 'Transport', amount: 500, branchId: 'main', createdAt: '2026-11-10T07:00:00.000Z' },
  ],
});

test('sales of the day match the report total and skip voided lines', () => {
  const reply = answerShopQuestion('sales of the day', shop(), { now });
  const range = reportPeriodRange('daily', 0, now, clock);
  const totals = summarizePeriod(shop().sales, shop().expenses, range.start, range.end);
  assert.equal(totals.revenue, 13000);
  assert.equal(totals.receiptCount, 3);
  assert.match(reply.text, /Sales today \(11 Nov 2026\) are UGX 13,000, from 3 receipts/);
  assert.match(reply.text, /Products UGX 8,000/);
  assert.match(reply.text, /Services UGX 5,000/);
  assert.equal(reply.text.includes('90,000'), false);
});

test('a sale before the business-day start stays on the previous day', () => {
  const early = shop();
  early.clock = { timezoneOffsetMinutes: 180, dayStartTime: '06:00' };
  early.sales.push({ id: 'early', amount: 700, cost: 0, createdAt: '2026-11-11T02:30:00.000Z', branchId: 'main' });
  const today = answerShopQuestion('sales today', early, { now });
  const yesterday = answerShopQuestion('sales yesterday', early, { now });
  assert.equal(today.text.includes('13,700'), false);
  assert.match(today.text, /UGX 13,000/);
  assert.match(yesterday.text, /UGX 3,700/);
});

test('sales of the week and a named range use the shop calendar', () => {
  const week = answerShopQuestion('sales of the week', shop(), { now });
  assert.match(week.text, /this week \(9 Nov – 15 Nov 2026\) are UGX 16,000/);
  const range = answerShopQuestion('sales from 10 Nov to 11 Nov', shop(), { now });
  assert.match(range.text, /from 10 Nov 2026 to 11 Nov 2026 are UGX 16,000/);
  const days = answerShopQuestion('sales for the last 7 days', shop(), { now });
  assert.match(days.text, /the last 7 days \(5 Nov – 11 Nov 2026\) are UGX 16,000/);
});

test('profit is sales minus tax, cost, and expenses', () => {
  const reply = answerShopQuestion('profit made today', shop(), { now });
  assert.match(reply.text, /Profit today \(11 Nov 2026\) is UGX 6,600/);
  assert.match(reply.text, /Sales UGX 13,000, tax UGX 400, cost UGX 5,000, expenses UGX 1,000/);
  assert.match(reply.text, /Gross profit UGX 7,600/);
  const gross = answerShopQuestion('gross profit today', shop(), { now });
  assert.match(gross.text, /^Gross profit today/);
});

test('a branch limits sales and profit', () => {
  const reply = answerShopQuestion('sales today at Main', shop(), { now });
  assert.match(reply.text, /At Main, sales today .* UGX 9,000/);
  const profit = answerShopQuestion('profit today at Entebbe', shop(), { now });
  assert.match(profit.text, /At Entebbe, profit today .* UGX 2,000/);
});

test('product count, low stock, prices, and services answer from the shelf', () => {
  const count = answerShopQuestion('how many pdts we have', shop(), { now });
  assert.match(count.text, /You have 4 products on the shelf, 24 in stock/);
  assert.match(count.text, /1 product is low and 1 product is out/);
  assert.match(count.text, /Worth UGX 33,000 at cost and UGX 66,000 at selling price/);

  const low = answerShopQuestion('how many are low on stock', shop(), { now });
  assert.match(low.text, /1 product is low on stock, and 1 product is out/);
  assert.deepEqual(low.lines.map((line) => line.label), ['Sugar', 'Salt']);

  const prices = answerShopQuestion('what the prices are', shop(), { now });
  assert.match(prices.text, /Selling prices, 4 products/);
  assert.equal(prices.lines.find((line) => line.label === 'Milk')?.detail.includes('UGX 2,000'), true);
  assert.equal(prices.lines.find((line) => line.label === 'Milk')?.detail.includes('cost UGX 1,000'), true);

  const one = answerShopQuestion('what is the price of milk', shop(), { now });
  assert.match(one.text, /Milk sells for UGX 2,000 · cost UGX 1,000, with 14 in stock/);

  const services = answerShopQuestion('what services are available', shop(), { now });
  assert.match(services.text, /2 services are available/);
  assert.deepEqual(services.lines.map((line) => line.label), ['Delivery', 'Printing']);
});

test('stock and sales of a named product, then a follow-up period', () => {
  const stock = answerShopQuestion('how many milk do we have', shop(), { now });
  assert.match(stock.text, /Milk has 14 in stock/);
  const sold = answerShopQuestion('how many milk did we sell today', shop(), { now });
  assert.match(sold.text, /Milk sold 2 today \(11 Nov 2026\), for UGX 4,000/);
  const later = answerShopQuestion('what about yesterday', shop(), { now, context: { topic: 'item', period: sold.period, productId: 'milk' } });
  assert.match(later.text, /Milk did not sell yesterday/);
  const profit = answerShopQuestion('profit on milk today', shop(), { now });
  assert.match(profit.text, /Profit on Milk today \(11 Nov 2026\) is UGX 1,600/);
});

test('an unnamed period asks for the days, and an unknown question explains what to ask', () => {
  const period = answerShopQuestion('profit made in a given period', shop(), { now });
  assert.match(period.text, /Say which days/);
  const help = answerShopQuestion('can you reorder the fridge', shop(), { now });
  assert.match(help.text, /sales today/);
  assert.match(answerShopQuestion('services available', shop(), { now }).text, /2 services are available/);
});

test('category prices and out-of-stock stay on that shelf', () => {
  const drinks = answerShopQuestion('prices in drinks', shop(), { now });
  assert.match(drinks.text, /Milk sells for UGX 2,000/);
  const out = answerShopQuestion('what is out of stock at Main', shop(), { now });
  assert.match(out.text, /At Main, 1 product is out of stock/);
  assert.equal(out.lines[0]?.label, 'Salt');
});
