import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAccountBalances, mergeHeardExpenses, postedExpense, staffAttribution, staffBookTotals, stockWorth } from './books';

test('adds cost and selling price for units on hand', () => {
  const worth = stockWorth([
    { stock: 4, purchasePrice: 500, salePrice: 800 },
    { stock: 2, purchasePrice: 1000, salePrice: 1500 },
  ]);
  assert.deepEqual(worth, { units: 6, atCost: 4000, atSalePrice: 6200 });
});

test('ignores empty or invalid stock', () => {
  const worth = stockWorth([
    { stock: 0, purchasePrice: 500, salePrice: 800 },
    { stock: -3, purchasePrice: 500, salePrice: 800 },
    { stock: Number.NaN, purchasePrice: 500, salePrice: 800 },
  ]);
  assert.deepEqual(worth, { units: 0, atCost: 0, atSalePrice: 0 });
});

test('editing an expense keeps the day it was recorded', () => {
  const saved = postedExpense(
    { id: 'rent', title: 'Rent', amount: 1000, createdAt: '2026-11-01T08:00:00.000Z', createdByUid: 'owner' },
    { id: 'rent', title: 'Shop rent', amount: 1500, createdAt: '2026-11-10T08:00:00.000Z', updatedAt: '2026-11-10T08:00:00.000Z' },
  );
  assert.equal(saved.createdAt, '2026-11-01T08:00:00.000Z');
  assert.equal(saved.createdByUid, 'owner');
  assert.equal(saved.title, 'Shop rent');
  assert.equal(saved.amount, 1500);
  assert.equal(saved.updatedAt, '2026-11-10T08:00:00.000Z');
});

test('an expense recorded by someone else shows up beside the ones already on screen', () => {
  const now = Date.parse('2026-11-10T08:00:20.000Z');
  const opened = mergeHeardExpenses(
    [{ id: 'rent', createdAt: '2026-11-01T08:00:00.000Z' }],
    [],
    now,
    false,
  );
  assert.equal(opened.heardRemote, false);
  assert.deepEqual(opened.rows.map((row) => row.id), ['rent']);

  const withStaff = mergeHeardExpenses(
    opened.rows,
    [
      { id: 'rent', createdAt: '2026-11-01T08:00:00.000Z' },
      { id: 'fuel', createdAt: '2026-11-10T08:00:00.000Z' },
    ],
    now,
    opened.heardRemote,
  );
  assert.deepEqual(withStaff.rows.map((row) => row.id), ['fuel', 'rent']);

  const pending = mergeHeardExpenses(
    [...withStaff.rows, { id: 'tea', createdAt: '2026-11-10T08:00:10.000Z' }],
    withStaff.rows,
    now,
    true,
  );
  assert.deepEqual(pending.rows.map((row) => row.id), ['tea', 'fuel', 'rent']);

  const removed = mergeHeardExpenses(
    [{ id: 'old', createdAt: '2026-10-01T08:00:00.000Z' }, { id: 'rent', createdAt: '2026-11-01T08:00:00.000Z' }],
    [{ id: 'rent', createdAt: '2026-11-01T08:00:00.000Z' }],
    now,
    true,
  );
  assert.deepEqual(removed.rows.map((row) => row.id), ['rent']);
});

test('a new expense keeps the time it was entered', () => {
  const saved = postedExpense(undefined, { id: 'tea', title: 'Tea', amount: 2000, createdAt: '2026-11-10T08:00:00.000Z' });
  assert.equal(saved.createdAt, '2026-11-10T08:00:00.000Z');
  assert.equal(saved.title, 'Tea');
});

test('a sale names the staff member, and keeps the email when the name is unknown', () => {
  const people = [{ name: 'Amina', email: 'amina@shop.test', role: 'cashier' }];
  const known = staffAttribution('Amina@shop.test', people, undefined, { cashier: 'Cashier' });
  assert.equal(known.primary, 'Amina');
  assert.equal(known.detail, 'Cashier · Amina@shop.test');
  const owner = staffAttribution('owner@shop.test', [], { email: 'owner@shop.test', name: 'Grace' });
  assert.equal(owner.primary, 'Grace');
  assert.equal(owner.detail, 'Owner · owner@shop.test');
  assert.equal(staffAttribution('walkin@shop.test', people).primary, 'walkin@shop.test');
  assert.equal(staffAttribution('unknown', people).primary, 'Not recorded');
});

test('staff totals count a receipt once and keep who entered the expense', () => {
  const rows = staffBookTotals(
    [
      { id: 'a', transactionId: 't1', amount: 1000, cashierEmail: 'amina@shop.test' },
      { id: 'b', transactionId: 't1', amount: 500, cashierEmail: 'amina@shop.test' },
      { id: 'c', transactionId: 't2', amount: 2000, createdByEmail: 'owner@shop.test', voidedAt: '2026-11-10T09:00:00.000Z' },
      { id: 'd', amount: -300, cashierEmail: 'amina@shop.test' },
    ],
    [{ amount: 400, createdByEmail: 'amina@shop.test' }],
  );
  const amina = rows.find((row) => row.email === 'amina@shop.test');
  assert.equal(amina?.sales, 1200);
  assert.equal(amina?.receipts, 2);
  assert.equal(amina?.expenses, 400);
  assert.equal(rows.some((row) => row.email === 'owner@shop.test'), false);
});

test('a void takes the money back out, and a receipt is counted once', () => {
  const accounts = [
    { id: 'cash', name: 'CASH', openingBalance: 1000, isDefault: true },
    { id: 'momo', name: 'Mobile money', openingBalance: 0 },
  ];
  const balances = computeAccountBalances(accounts, [
    { amount: 4000, transactionId: 'r1', saleKind: 'sale', tenders: [{ method: 'cash', amount: 4000 }] },
    { amount: 4000, transactionId: 'r1', saleKind: 'sale', tenders: [{ method: 'cash', amount: 4000 }] },
    { amount: 2500, transactionId: 'r2', saleKind: 'sale', paymentMethod: 'mobile_money', tenders: [{ method: 'mobile_money', amount: 2500 }], voidedAt: '2026-11-15T10:00:00.000Z' },
    { amount: -1500, transactionId: 'c1', saleKind: 'return', tenders: [{ method: 'cash', amount: -1500 }] },
    { amount: -500, transactionId: 'c1', saleKind: 'return', tenders: [{ method: 'cash', amount: -500 }] },
  ], [], []);
  assert.equal(balances.get('cash'), 1000 + 4000 - 1500 - 500);
  assert.equal(balances.get('momo'), 0);
});

test('a sale with no payment method lands in cash', () => {
  const accounts = [{ id: 'cash', name: 'CASH', openingBalance: 0, isDefault: true }];
  const balances = computeAccountBalances(accounts, [{ amount: 3000, accountId: 'cash' }], [], []);
  assert.equal(balances.get('cash'), 3000);
});

test('treats a missing price as zero', () => {
  const worth = stockWorth([
    { stock: 3, purchasePrice: Number.NaN, salePrice: 200 },
  ]);
  assert.deepEqual(worth, { units: 3, atCost: 0, atSalePrice: 600 });
});
